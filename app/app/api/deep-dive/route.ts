import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { env } from "cloudflare:workers";
import {
  deepDiveOutputSchema,
  deepDiveSchema,
  type DeepDiveResponse,
  type DeepDiveSource,
} from "../../../lib/deep-dive";
import {
  promptOverridesSignature,
  renderAgentPrompt,
  resolveAgentPrompt,
  sanitizeAgentPromptOverrides,
  type AgentPromptOverrides,
} from "../../../lib/agent-prompts";
import { operationCacheKey, readOperationCache, writeOperationCache } from "../../../db/cache";
import { openRouterFailureFromThrown } from "../../../lib/openrouter-errors";
import { researchClaimFrameSchema, type ResearchClaimFrame } from "../../../lib/research-brief";

const defaultOpenRouterModel = "anthropic/claude-opus-4.8";
const openRouterBaseURL = "https://openrouter.ai/api/v1";
const deepDiveCacheContract = "abstract-result-extraction-v3";
const deepDiveCacheTtlMs = 30 * 24 * 60 * 60 * 1000;
type CachedDeepDive = Omit<DeepDiveResponse, "cache">;

type DeepDiveRequest = {
  record?: Partial<Omit<DeepDiveSource, "abstract">>;
  openRouterApiKey?: unknown;
  openRouterModel?: unknown;
  promptOverrides?: unknown;
  claimFrames?: unknown;
  applicabilityProfile?: unknown;
  refresh?: unknown;
};

type DeepDiveEnvironment = {
  OPENROUTER_API_KEY?: string;
  EPISTACK_OPENROUTER_MODEL?: string;
};

function decodeXml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAbstract(xml: string) {
  const sections = [...xml.matchAll(/<AbstractText(?:\s+[^>]*)?>([\s\S]*?)<\/AbstractText>/gi)]
    .map((match) => decodeXml(match[1]))
    .filter(Boolean);
  return sections.join(" ");
}

export async function POST(request: Request) {
  let body: DeepDiveRequest;
  try {
    body = await request.json() as DeepDiveRequest;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const record = body.record;
  const pmid = typeof record?.pmid === "string" ? record.pmid.trim() : "";
  if (!/^\d{5,12}$/.test(pmid)) {
    return Response.json({ error: "A valid PubMed identifier is required." }, { status: 400 });
  }

  const suppliedKey = typeof body.openRouterApiKey === "string" ? body.openRouterApiKey.trim() : "";
  const suppliedModel = typeof body.openRouterModel === "string" ? body.openRouterModel.trim() : "";
  if (body.promptOverrides && JSON.stringify(body.promptOverrides).length > 120_000) {
    return Response.json({ error: "Prompt overrides are too large." }, { status: 400 });
  }
  const promptOverrides: AgentPromptOverrides = sanitizeAgentPromptOverrides(body.promptOverrides);
  const parsedClaimFrames = researchClaimFrameSchema.array().min(1).max(7).safeParse(body.claimFrames);
  if (!parsedClaimFrames.success) {
    return Response.json({ error: "The extraction request is missing the compiled claim frames. Return to Contextualize and compile a research brief first." }, { status: 400 });
  }
  const applicabilityProfile = body.applicabilityProfile && typeof body.applicabilityProfile === "object"
    ? body.applicabilityProfile
    : { summary: "No structured applicability profile supplied." };
  const runtimeEnvironment = env as unknown as DeepDiveEnvironment;
  const openRouterModel = suppliedModel || runtimeEnvironment.EPISTACK_OPENROUTER_MODEL || process.env.EPISTACK_OPENROUTER_MODEL || defaultOpenRouterModel;
  const refresh = body.refresh === true;
  const cacheKey = await operationCacheKey("abstract-result-extraction", deepDiveCacheContract, {
    pmid,
    model: openRouterModel,
    claimFrames: parsedClaimFrames.data,
    applicabilityProfile,
    promptConfig: promptOverridesSignature(promptOverrides),
  });
  if (!refresh) {
    const cached = await readOperationCache<CachedDeepDive>(cacheKey);
    if (cached) {
      return Response.json({
        ...cached.payload,
        cache: { status: "hit", layer: "d1", createdAt: cached.createdAt, expiresAt: cached.expiresAt },
      } satisfies DeepDiveResponse);
    }
  }

  const openRouterApiKey = suppliedKey || runtimeEnvironment.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!openRouterApiKey) {
    return Response.json({ error: "No reusable extraction is cached for this source and model. Add a bring-your-own model key in Settings to create one." }, { status: 401 });
  }

  try {
    const abstractResponse = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`, {
      headers: { "User-Agent": "Epistack Evidence Lab/0.1 (result extraction)" },
    });
    if (!abstractResponse.ok) throw new Error(`PubMed abstract fetch returned ${abstractResponse.status}`);
    const abstract = extractAbstract(await abstractResponse.text());
    if (abstract.length < 80) {
      return Response.json({ error: "PubMed did not return an abstract with enough detail for result extraction." }, { status: 422 });
    }

    const source: DeepDiveSource = {
      pmid,
      title: typeof record?.title === "string" ? record.title : "Untitled PubMed record",
      authors: typeof record?.authors === "string" ? record.authors : "Authors not returned",
      journal: typeof record?.journal === "string" ? record.journal : "Journal not returned",
      published: typeof record?.published === "string" ? record.published : "Date not returned",
      doi: typeof record?.doi === "string" ? record.doi : null,
      url: typeof record?.url === "string" ? record.url : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      abstract,
    };
    const openRouter = createOpenAI({
      apiKey: openRouterApiKey,
      baseURL: openRouterBaseURL,
      headers: {
        "HTTP-Referer": request.headers.get("origin") || "https://epistack-evidence-lab.avalokai.chatgpt.site",
        "X-OpenRouter-Title": "Epistack Evidence Lab",
        "X-OpenRouter-Metadata": "enabled",
      },
    });
    const extractionAgent = resolveAgentPrompt("abstract-extractor", promptOverrides);
    const claimFramesText = formatClaimFrames(parsedClaimFrames.data);
    const { output } = await generateText({
      model: openRouter(openRouterModel),
      output: Output.object({
        name: "abstract_result_extraction",
        description: "Proposed study, analysis, result, and claim-relation records extracted from one PubMed abstract.",
        schema: deepDiveOutputSchema,
      }),
      system: extractionAgent.instructions,
      prompt: renderAgentPrompt(extractionAgent.taskTemplate, {
        claimFrames: claimFramesText,
        applicabilityProfile: JSON.stringify(applicabilityProfile, null, 2).slice(0, 20_000),
        title: source.title,
        authors: source.authors,
        journal: source.journal,
        published: source.published,
        pmid: source.pmid,
        doiLine: source.doi ? ` · DOI ${source.doi}` : "",
        abstract: source.abstract,
      }),
      maxOutputTokens: extractionAgent.maxOutputTokens,
      temperature: extractionAgent.temperature,
    });
    const parsed = deepDiveSchema.safeParse(output);
    if (!parsed.success) {
      return Response.json({ error: "The model returned an incomplete result extraction. Retry or choose another frontier model." }, { status: 502 });
    }
    const payload: CachedDeepDive = {
      source,
      candidate: parsed.data,
      model: openRouterModel,
      verificationStatus: "abstract-only",
    };
    const stored = await writeOperationCache(
      cacheKey,
      "abstract-result-extraction",
      deepDiveCacheContract,
      payload,
      deepDiveCacheTtlMs,
    );
    return Response.json({
      ...payload,
      cache: {
        status: refresh ? "bypass" : "miss",
        layer: "d1",
        createdAt: stored?.createdAt ?? null,
        expiresAt: stored?.expiresAt ?? null,
      },
    } satisfies DeepDiveResponse);
  } catch (error) {
    const providerFailure = openRouterFailureFromThrown(error);
    if (providerFailure.code !== "provider_error") {
      return Response.json({ error: providerFailure.message, code: providerFailure.code }, { status: providerFailure.status });
    }
    const detail = error instanceof Error ? error.message : "Unknown deep-dive error";
    return Response.json({ error: "The source could not be extracted from PubMed and the selected model.", detail }, { status: 502 });
  }
}

function formatClaimFrames(claimFrames: ResearchClaimFrame[]) {
  return claimFrames.map((frame) => [
    frame.id,
    frame.statement,
    `Population: ${frame.population}`,
    `Exposure: ${frame.exposure}`,
    `Comparator: ${frame.comparator}`,
    `Outcome: ${frame.outcome}`,
    `Time horizon: ${frame.timeHorizon}`,
    `Applicability fields: ${frame.applicabilityFields.join(", ")}`,
  ].join("\n")).join("\n\n");
}
