import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { env } from "cloudflare:workers";
import {
  deepDiveInstructions,
  deepDiveOutputSchema,
  deepDiveSchema,
  type DeepDiveSource,
} from "../../../lib/deep-dive";
import { openRouterFailureFromThrown } from "../../../lib/openrouter-errors";

const defaultOpenRouterModel = "anthropic/claude-opus-4.8";
const openRouterBaseURL = "https://openrouter.ai/api/v1";

type DeepDiveRequest = {
  record?: Partial<Omit<DeepDiveSource, "abstract">>;
  openRouterApiKey?: unknown;
  openRouterModel?: unknown;
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
  const runtimeEnvironment = env as unknown as DeepDiveEnvironment;
  const openRouterApiKey = suppliedKey || runtimeEnvironment.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  const openRouterModel = suppliedModel || runtimeEnvironment.EPISTACK_OPENROUTER_MODEL || process.env.EPISTACK_OPENROUTER_MODEL || defaultOpenRouterModel;
  if (!openRouterApiKey) {
    return Response.json({ error: "Add a bring-your-own model key in Settings before extracting a new source." }, { status: 401 });
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
    const { output } = await generateText({
      model: openRouter(openRouterModel),
      output: Output.object({
        name: "abstract_result_extraction",
        description: "Proposed study, analysis, result, and claim-relation records extracted from one PubMed abstract.",
        schema: deepDiveOutputSchema,
      }),
      system: deepDiveInstructions,
      prompt: `CITATION\n${source.title}\n${source.authors}\n${source.journal} · ${source.published}\nPMID ${source.pmid}${source.doi ? ` · DOI ${source.doi}` : ""}\n\nABSTRACT\n${source.abstract}`,
      maxOutputTokens: 8000,
      temperature: 0.1,
    });
    const parsed = deepDiveSchema.safeParse(output);
    if (!parsed.success) {
      return Response.json({ error: "The model returned an incomplete result extraction. Retry or choose another frontier model." }, { status: 502 });
    }
    return Response.json({ source, candidate: parsed.data, model: openRouterModel, verificationStatus: "abstract-only" });
  } catch (error) {
    const providerFailure = openRouterFailureFromThrown(error);
    if (providerFailure.code !== "provider_error") {
      return Response.json({ error: providerFailure.message, code: providerFailure.code }, { status: providerFailure.status });
    }
    const detail = error instanceof Error ? error.message : "Unknown deep-dive error";
    return Response.json({ error: "The source could not be extracted from PubMed and the selected model.", detail }, { status: 502 });
  }
}
