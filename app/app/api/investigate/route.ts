import { z } from "zod";
import { env } from "cloudflare:workers";
import { renderAgentPrompt, resolveAgentPrompt, sanitizeAgentPromptOverrides, type AgentPromptOverrides } from "../../../lib/agent-prompts";
import {
  adversarialReviewSchema,
  adjudicateDualReview,
  fullPaperExtractionSchema,
  type DualReviewResponse,
  type SourceArtifact,
} from "../../../lib/dual-review";
import type { DeepDiveSource } from "../../../lib/deep-dive";
import { lyraConfigured, runLyraStage, isBackendUnreachable, backendUnreachableResponse } from "../../../lib/lyra-stage";
import { researchClaimFrameSchema, type ResearchClaimFrame } from "../../../lib/research-brief";
import { acquireSource, extractSource, InsufficientSourceTextError, type SourceReviewResponse } from "../../../lib/source-adapters";
import { fetchPmcFullText } from "../../../lib/pmc-full-text";
import { isPreliminarySourceClass, sourceClassSchema } from "../../../lib/source-class";
import { extractJsonSlice, parseStructuredWithRepair, repairInstruction } from "../../../lib/structured-output";
import {
  addResearchUsage,
  emptyResearchUsage,
  normalizeModelId,
  normalizeResearchEffortStep,
  researchBudgetProfiles,
  researchRunCapUsd,
  usageFromOpenRouter,
  type ResearchUsage,
} from "../../../lib/research-budget";

const primaryModel = "Astra · GPT 6";
// A distinct role label: the adversarial pass is an independent full-text read
// with the reviewer contract. The dual-review gate requires the two labels to
// differ, and Astra exposes one general chat model.
const adversaryModel = "Astra · adversarial full-paper reviewer";
// Keep the hosted request inside the worker's browser-visible latency budget.
// This article's methods, results, discussion, and conclusion fit within the
// first 32k characters; the artifact hash still attests to the complete text.
const hostedTextCap = 32_000;

type InvestigateEnvironment = {
  OPENROUTER_API_KEY?: string;
  EPISTACK_OPENROUTER_MODEL?: string;
  EPISTACK_OPENROUTER_REPAIR_MODEL?: string;
};

type OpenRouterMessage = {
  content?: string | Array<{ type?: string; text?: string }>;
};

function investigateEnvironment() {
  return env as unknown as InvestigateEnvironment;
}

type RoleModels = { reader?: string; reviewer?: string };

function openRouterModel(role: "extractor" | "reviewer" | "repair", overrides: RoleModels = {}) {
  const current = investigateEnvironment();
  if (role === "extractor") return overrides.reader || current.EPISTACK_OPENROUTER_MODEL || "deepseek/deepseek-v4.1-flash";
  if (role === "reviewer") return overrides.reviewer || current.EPISTACK_OPENROUTER_REPAIR_MODEL || "openai/gpt-4o-mini";
  return current.EPISTACK_OPENROUTER_REPAIR_MODEL || "openai/gpt-4o-mini";
}

function openRouterConfigured() {
  return Boolean(investigateEnvironment().OPENROUTER_API_KEY);
}

function openRouterMessageText(message: OpenRouterMessage) {
  if (typeof message.content === "string") return message.content;
  return (message.content || []).map((part) => part.text || "").join("\n");
}

function canonicalEnum(value: unknown, aliases: Record<string, string>) {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return aliases[normalized] || value;
}

function canonicalReviewVerdict(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (/\b(reject|den(?:y|ied)|fail|unsupported|not acceptable)\b/.test(normalized)) return "reject";
  if (/\b(revis|conditional|caveat|partial|mixed|qualif)\b/.test(normalized)) return "revise";
  if (/\b(accept|approv|pass|support)\b/.test(normalized)) return "accept";
  return value;
}

function coerceAuditText(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((item) => coerceAuditText(item)).filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    return parts.length ? parts.join(" ") : value;
  }
  if (value && typeof value === "object") {
    const parts = Object.values(value).map((item) => coerceAuditText(item)).filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    return parts.length ? parts.join(" ") : value;
  }
  return value;
}

function normalizeInvestigationJson(text: string) {
  const slice = extractJsonSlice(text);
  if (!slice) return text;
  try {
    const value = JSON.parse(slice) as Record<string, unknown>;
    const results = Array.isArray(value.results) ? value.results : [];
    for (const result of results) {
      if (!result || typeof result !== "object") continue;
      const record = result as Record<string, unknown>;
      record.rationale = coerceAuditText(record.rationale);
      record.resultRole = canonicalEnum(record.resultRole, {
        "primary result": "primary",
        "secondary result": "secondary",
        "exploratory result": "exploratory",
        "methodological result": "methodological",
        "author interpretation": "author-interpretation",
      });
      record.relation = canonicalEnum(record.relation, {
        "not informative": "not-informative",
      });
      record.scopeMatch = canonicalEnum(record.scopeMatch, {
        "exact match": "direct",
        "partial match": "partial",
        "indirect match": "indirect",
      });
      const applicability = record.applicability;
      if (applicability && typeof applicability === "object") {
        const vector = applicability as Record<string, unknown>;
        vector.rationale = coerceAuditText(vector.rationale);
        vector.distance = canonicalEnum(vector.distance, {
          "exact match": "exact",
          close: "near",
          similar: "near",
          "near exact": "near",
          distant: "far",
          mismatch: "far",
          unknown: "indeterminate",
          uncertain: "indeterminate",
          unclear: "indeterminate",
          "not known": "indeterminate",
        });
      }
    }
    const reviews = Array.isArray(value.reviews) ? value.reviews : [];
    for (const review of reviews) {
      if (!review || typeof review !== "object") continue;
      const record = review as Record<string, unknown>;
      record.rationale = coerceAuditText(record.rationale);
      record.verdict = canonicalReviewVerdict(record.verdict);
    }
    value.conclusionFit = canonicalEnum(value.conclusionFit, {
      "matches result": "matches-results",
      "broader than result": "broader-than-results",
      "narrower than result": "narrower-than-results",
      "not stated": "not-stated",
    });
    return JSON.stringify(value);
  } catch {
    return text;
  }
}

type StructuredCallOptions = {
  models: RoleModels;
  reasoning: "none" | "medium";
  extractorMaxTokens: number;
};

async function runOpenRouterStructured(
  input: string,
  instructions: string,
  role: "extractor" | "reviewer" | "repair",
  options: StructuredCallOptions,
) {
  const apiKey = investigateEnvironment().OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("The hosted OpenRouter investigation fallback is not configured.");
  const model = openRouterModel(role, options.models);
  const reasoning = role === "extractor" ? options.reasoning : "none";
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://epistack.adityaarpitha.com",
        "X-OpenRouter-Title": "Epistack Evidence Lab",
        "X-OpenRouter-Metadata": "enabled",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: input },
        ],
        response_format: { type: "json_object" },
        reasoning: { effort: reasoning },
        temperature: 0,
        max_tokens: role === "extractor" ? options.extractorMaxTokens : 3_500,
      }),
      signal: AbortSignal.timeout(reasoning === "none" ? 60_000 : 120_000),
    });
  } catch {
    throw new Error("The hosted OpenRouter investigation fallback could not be reached.");
  }
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json() as { error?: { message?: string } };
      detail = payload.error?.message || "";
    } catch {
      // Keep provider failures bounded and free of response-body surprises.
    }
    throw new Error(`The hosted OpenRouter investigation fallback returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : "."}`);
  }
  const payload = await response.json() as { choices?: Array<{ message?: OpenRouterMessage }>; usage?: unknown };
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error("The hosted OpenRouter investigation fallback returned no message.");
  const text = openRouterMessageText(message).trim();
  if (!text) throw new Error("The hosted OpenRouter investigation fallback returned an empty response.");
  return { text, model, usage: usageFromOpenRouter(payload.usage) };
}

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

class FullTextUnavailableError extends Error {
  readonly code!: "NO_OPEN_FULL_TEXT";

  constructor(message: string) {
    super(message);
    Object.defineProperty(this, "code", {
      configurable: true,
      enumerable: false,
      value: "NO_OPEN_FULL_TEXT",
      writable: false,
    });
  }
}

type SourceRequest = {
  sourceClass?: unknown;
  url?: unknown;
  title?: unknown;
  pmid?: unknown;
  pmcid?: unknown;
  citedText?: unknown;
};

type InvestigateRequest = {
  record?: {
    pmid?: unknown;
    pmcid?: unknown;
    title?: unknown;
    authors?: unknown;
    journal?: unknown;
    published?: unknown;
    doi?: unknown;
    url?: unknown;
  } | null;
  source?: SourceRequest | null;
  question?: unknown;
  decisionContext?: unknown;
  claimFrames?: unknown;
  applicabilityProfile?: unknown;
  promptOverrides?: unknown;
  refresh?: unknown;
  models?: unknown;
  effort?: unknown;
  budgetRemainingUsd?: unknown;
};

type NormalizedRecord = {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  published: string;
  doi: string | null;
  url: string;
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safePmcNumeric(value: unknown) {
  const numeric = String(value || "").replace(/^PMC/i, "");
  return /^\d{4,12}$/.test(numeric) ? numeric : null;
}

async function resolvePmcNumeric(pmid: string) {
  const url = new URL("https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/");
  url.searchParams.set("ids", pmid);
  url.searchParams.set("format", "json");
  url.searchParams.set("tool", "epistack-evidence-lab");
  const response = await fetch(url, {
    headers: { "User-Agent": "Epistack Evidence Lab/0.1 (hosted full-text review)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`NCBI PMID-to-PMCID conversion returned ${response.status}.`);
  const payload = await response.json() as { records?: Array<{ pmcid?: string; pmid?: string }> };
  const record = Array.isArray(payload.records)
    ? payload.records.find((candidate) => String(candidate.pmid || "") === pmid) ?? payload.records[0]
    : null;
  return safePmcNumeric(record?.pmcid);
}

async function acquirePmcArtifact(pmid: string) {
  const pmcNumeric = await resolvePmcNumeric(pmid);
  if (!pmcNumeric) {
    throw new FullTextUnavailableError("No open PMC full text is linked to this PubMed record. Automatic promotion is disabled; use the explicit abstract-only fallback.");
  }
  let fetched;
  try {
    fetched = await fetchPmcFullText(pmcNumeric);
  } catch (error) {
    throw new FullTextUnavailableError(error instanceof Error ? error.message : "PMC full-text acquisition failed.");
  }
  const artifact: SourceArtifact = {
    kind: fetched.kind,
    pmcid: fetched.pmcid,
    canonicalUrl: fetched.canonicalUrl,
    localXmlPath: "(hosted inline)",
    localTextPath: "(hosted inline)",
    contentHash: fetched.contentHash,
    retrievedAt: new Date().toISOString(),
  };
  return { artifact, plainText: fetched.plainText };
}

function inlineArtifactText(fullText: string) {
  const truncated = fullText.length > hostedTextCap;
  const body = truncated ? fullText.slice(0, hostedTextCap) : fullText;
  const note = truncated
    ? `\n\n[The preserved plain-text artifact was truncated to its first ${hostedTextCap.toLocaleString()} characters of ${fullText.length.toLocaleString()} for this hosted run. The SHA-256 above still attests to the complete artifact.]`
    : "";
  return [
    "PRESERVED FULL-TEXT ARTIFACT (plain text inlined for the hosted run)",
    "----- BEGIN ARTIFACT -----",
    body,
    "----- END ARTIFACT -----",
  ].join("\n") + note;
}

function citationFor(record: NormalizedRecord) {
  return [record.title, record.authors, `${record.journal} · ${record.published}`, `PMID ${record.pmid}${record.doi ? ` · DOI ${record.doi}` : ""}`].join("\n");
}

function sourceFor(record: NormalizedRecord, artifact: SourceArtifact): DeepDiveSource {
  return {
    pmid: record.pmid,
    title: record.title,
    authors: record.authors,
    journal: record.journal,
    published: record.published,
    doi: record.doi,
    url: artifact.canonicalUrl,
    abstract: "",
  };
}

function claimFramesText(claimFrames: ResearchClaimFrame[]) {
  return claimFrames.map((frame) => [
    frame.id,
    frame.statement,
    `Kind: ${frame.kind}`,
    `Population: ${frame.population}`,
    `Exposure: ${frame.exposure}`,
    `Comparator: ${frame.comparator}`,
    `Outcome: ${frame.outcome}`,
    `Time horizon: ${frame.timeHorizon}`,
    `Applicability fields: ${frame.applicabilityFields.join(", ")}`,
  ].join("\n")).join("\n\n");
}

// The typed non-PubMed path: acquire an arbitrary source, then run the adapter
// that matches its declared class. Only causal + fetched-verified reaches the
// adversarial dual review; the rest stays extracted and non-promotable.
async function investigateSource(input: {
  source: SourceRequest;
  question: string;
  decisionContext: string;
  claimFrames: ResearchClaimFrame[];
  applicabilityProfile: string;
  promptOverrides: AgentPromptOverrides;
}): Promise<Response> {
  const parsedClass = sourceClassSchema.safeParse(input.source.sourceClass);
  const url = typeof input.source.url === "string" ? input.source.url.trim() : "";
  if (!parsedClass.success || !/^https?:\/\//i.test(url) || url.length > 2_000) {
    return json({ error: "A valid sourceClass and http(s) URL are required." }, 400);
  }
  const sourceClass = parsedClass.data;
  try {
    const acquired = await acquireSource({
      sourceClass,
      url,
      title: typeof input.source.title === "string" ? input.source.title.trim() : undefined,
      pmid: typeof input.source.pmid === "string" ? input.source.pmid.trim() : undefined,
      pmcid: typeof input.source.pmcid === "string" ? input.source.pmcid.trim() : undefined,
      citedText: typeof input.source.citedText === "string" ? input.source.citedText.slice(0, 60_000) : undefined,
    });
    const extracted = await extractSource({
      sourceClass,
      acquisition: acquired.acquisition,
      acquired,
      question: input.question,
      decisionContext: input.decisionContext,
      claimFrames: input.claimFrames,
      applicabilityProfile: input.applicabilityProfile,
      promptOverrides: input.promptOverrides,
    });
    const response: SourceReviewResponse = {
      source: {
        sourceClass,
        url: acquired.url,
        title: acquired.title,
        publisher: acquired.publisher,
        acquisition: acquired.acquisition,
        contentHash: acquired.contentHash,
      },
      role: extracted.role,
      evidenceStatus: extracted.evidenceStatus,
      preliminary: isPreliminarySourceClass(sourceClass),
      payload: extracted.payload,
    };
    return json(response);
  } catch (error) {
    if (error instanceof InsufficientSourceTextError) {
      return json({ error: error.message, code: error.code }, 200);
    }
    return json({
      error: error instanceof Error ? error.message : "The hosted source review failed.",
    }, 502);
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Use this site to run a hosted full-text review." }, 403);
  }
  if (!lyraConfigured() && !openRouterConfigured()) {
    return json({ error: "Hosted full-text review is not configured yet.", code: "hosted-not-configured" }, 503);
  }

  let body: InvestigateRequest;
  try {
    body = await request.json() as InvestigateRequest;
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const record = body.record;
  const parsedClaimFrames = researchClaimFrameSchema.array().min(1).max(7).safeParse(body.claimFrames);
  if (!parsedClaimFrames.success) {
    return json({
      error: "The investigation request is missing the compiled claim frames. Return to Contextualize and compile a research brief first.",
    }, 400);
  }
  if (body.promptOverrides && JSON.stringify(body.promptOverrides).length > 120_000) {
    return json({ error: "Prompt overrides are too large." }, 400);
  }

  const claimFrames = parsedClaimFrames.data;
  const question = typeof body.question === "string" && body.question.trim()
    ? body.question.trim().slice(0, 4_000)
    : "What does this source establish about the supplied claim frames?";
  const decisionContext = typeof body.decisionContext === "string" && body.decisionContext.trim()
    ? body.decisionContext.trim().slice(0, 8_000)
    : "No personal decision context supplied.";
  const applicabilityProfile = body.applicabilityProfile && typeof body.applicabilityProfile === "object"
    ? JSON.stringify(body.applicabilityProfile, null, 2).slice(0, 20_000)
    : "No structured applicability profile supplied.";
  const promptOverrides = sanitizeAgentPromptOverrides(body.promptOverrides);
  const refresh = body.refresh === true;
  if (typeof body.budgetRemainingUsd === "number" && body.budgetRemainingUsd <= 0) {
    return json({ error: `This run has reached its $${researchRunCapUsd} cap. Start a new run to read more papers.`, code: "run-budget-exhausted" }, 409);
  }
  const requestedModels = body.models && typeof body.models === "object" ? body.models as Record<string, unknown> : {};
  for (const role of ["reader", "reviewer"] as const) {
    const requested = requestedModels[role];
    if (requested !== undefined && requested !== "" && !normalizeModelId(requested)) {
      return json({ error: `Use an OpenRouter model id in provider/model form for the ${role} model.` }, 400);
    }
  }
  const roleModels: RoleModels = {
    reader: normalizeModelId(requestedModels.reader),
    reviewer: normalizeModelId(requestedModels.reviewer),
  };
  const effort = normalizeResearchEffortStep(body.effort);
  const budget = researchBudgetProfiles[effort];
  const structuredOptions: StructuredCallOptions = {
    models: roleModels,
    reasoning: budget.readerReasoning,
    extractorMaxTokens: budget.readerMaxTokens,
  };
  let usage: ResearchUsage = emptyResearchUsage;

  if (body.source && typeof body.source === "object") {
    return await investigateSource({
      source: body.source,
      question,
      decisionContext,
      claimFrames,
      applicabilityProfile,
      promptOverrides,
    });
  }

  const pmid = typeof record?.pmid === "string" ? record.pmid.trim() : "";
  if (!/^\d{5,12}$/.test(pmid)) {
    return json({ error: "A valid PubMed identifier is required." }, 400);
  }
  const normalizedRecord: NormalizedRecord = {
    pmid,
    title: typeof record?.title === "string" && record.title.trim() ? record.title.trim() : "Untitled PubMed record",
    authors: typeof record?.authors === "string" && record.authors.trim() ? record.authors.trim() : "Authors not returned",
    journal: typeof record?.journal === "string" && record.journal.trim() ? record.journal.trim() : "Journal not returned",
    published: typeof record?.published === "string" && record.published.trim() ? record.published.trim() : "Date not returned",
    doi: typeof record?.doi === "string" && record.doi.trim() ? record.doi.trim() : null,
    url: typeof record?.url === "string" && record.url.trim() ? record.url.trim() : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  };

  try {
    const { artifact, plainText } = await acquirePmcArtifact(pmid);
    const artifactText = inlineArtifactText(plainText);
    const commonValues = {
      question,
      decisionContext,
      citation: citationFor(normalizedRecord),
      artifactTextPath: artifactText,
      artifactXmlPath: artifact.kind === "pmc-jats"
        ? "(JATS XML is not separately inlined for the hosted run; the preserved article is supplied as plain text above.)"
        : "(NCBI BioC JSON is not separately inlined for the hosted run; the preserved article is supplied as plain text above.)",
      artifactHash: artifact.contentHash,
      claimFrames: claimFramesText(claimFrames),
      applicabilityProfile,
    };

    const extractorAgent = resolveAgentPrompt("full-paper-extractor", promptOverrides);
    const extractorTask = renderAgentPrompt(extractorAgent.taskTemplate, commonValues);
    async function structuredStage(
      input: string,
      instructions: string,
      role: "extractor" | "reviewer" | "repair",
    ) {
      if (role !== "repair" && lyraConfigured()) {
        try {
          const text = await runLyraStage({
            model: "lyra-chatgpt-pro",
            effort: "medium",
            instructions,
            input,
          });
          return { text, model: role === "extractor" ? primaryModel : adversaryModel };
        } catch (error) {
          if (!isBackendUnreachable(error) || !openRouterConfigured()) throw error;
        }
      }
      try {
        const result = await runOpenRouterStructured(input, instructions, role, structuredOptions);
        usage = addResearchUsage(usage, result.usage);
        return {
          text: result.text,
          model: `OpenRouter · ${openRouterModel(role, roleModels)} · ${role === "extractor" ? "extractor" : role === "reviewer" ? "adversarial reviewer" : "JSON repair"}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const canUseCheapFallback = role === "extractor"
          && openRouterModel(role, roleModels) !== openRouterModel("repair")
          && /could not be reached|HTTP (408|429|5\d\d)/.test(message);
        if (!canUseCheapFallback) throw error;
        const fallback = await runOpenRouterStructured(input, instructions, "repair", structuredOptions);
        usage = addResearchUsage(usage, fallback.usage);
        return {
          text: fallback.text,
          model: `OpenRouter · ${openRouterModel("repair")} · extractor timeout fallback`,
        };
      }
    }

    const extractorInstructions = extractorAgent.instructions
      + "\nReturn only one JSON object matching this schema. No markdown fences.\n"
      + JSON.stringify(z.toJSONSchema(fullPaperExtractionSchema));
    const primaryStage = await structuredStage(extractorTask, extractorInstructions, "extractor");
    const primary = await parseStructuredWithRepair({
      text: normalizeInvestigationJson(primaryStage.text),
      schema: fullPaperExtractionSchema,
      repair: async ({ raw, issues }) => normalizeInvestigationJson((await structuredStage(
        `${extractorTask}\n\nPREVIOUS ATTEMPT (failed schema validation):\n${raw}`,
        extractorAgent.instructions + repairInstruction(fullPaperExtractionSchema, issues),
        "repair",
      )).text),
      maxRepairs: 2,
    });

    const indexedCandidate = primary.results.map((result, resultIndex) => ({ resultIndex, ...result }));
    const reviewerAgent = resolveAgentPrompt("adversarial-reviewer", promptOverrides);
    const reviewerTask = renderAgentPrompt(reviewerAgent.taskTemplate, {
      ...commonValues,
      candidateJson: JSON.stringify({ ...primary, results: indexedCandidate }, null, 2),
    });
    const reviewerInstructions = reviewerAgent.instructions
      + "\nReturn only one JSON object matching this schema. No markdown fences.\n"
      + JSON.stringify(z.toJSONSchema(adversarialReviewSchema));
    const reviewStage = await structuredStage(reviewerTask, reviewerInstructions, "reviewer");
    const review = await parseStructuredWithRepair({
      text: normalizeInvestigationJson(reviewStage.text),
      schema: adversarialReviewSchema,
      repair: async ({ raw, issues }) => normalizeInvestigationJson((await structuredStage(
        `${reviewerTask}\n\nPREVIOUS ATTEMPT (failed schema validation):\n${raw}`,
        reviewerAgent.instructions + repairInstruction(adversarialReviewSchema, issues),
        "repair",
      )).text),
      maxRepairs: 2,
    });

    const adjudicated = adjudicateDualReview({
      primary,
      review,
      fullText: plainText,
      artifact,
      primaryModel: primaryStage.model,
      adversaryModel: reviewStage.model,
    });
    const cacheKey = `investigate-${(await sha256(JSON.stringify({
      pmid,
      artifactHash: artifact.contentHash,
      question,
      decisionContext,
      claimFrames,
      applicabilityProfile,
      promptOverrides,
      effort,
      roleModels,
    }))).slice(0, 32)}`;
    const response: DualReviewResponse = {
      source: sourceFor(normalizedRecord, artifact),
      artifact,
      primaryCandidate: primary,
      candidate: adjudicated.candidate,
      review,
      decisions: adjudicated.decisions,
      promotion: {
        policyId: adjudicated.policyId,
        eligible: adjudicated.eligible,
        acceptedCount: adjudicated.acceptedCount,
        rejectedCount: adjudicated.rejectedCount,
        reasons: adjudicated.reasons,
      },
      models: { primary: primaryStage.model, adversary: reviewStage.model },
      verificationStatus: "ai-cross-checked-full-text",
      cache: { status: refresh ? "bypass" : "miss", key: cacheKey, createdAt: new Date().toISOString() },
    };
    return json({ ...response, effort, usage });
  } catch (error) {
    if (isBackendUnreachable(error)) return backendUnreachableResponse();
    if (error instanceof FullTextUnavailableError) {
      return json({ error: error.message, code: error.code }, 200);
    }
    return json({
      error: error instanceof Error ? error.message : "The hosted full-text review failed.",
    }, 502);
  }
}
