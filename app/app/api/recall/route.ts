import { z } from "zod";
// @ts-ignore The Cloudflare runtime module is provided by the Workers build; its ambient types are absent from this tsc project (same pre-existing condition as every other API route).
import { env } from "cloudflare:workers";
import { lyraConfigured, runLyraStage, isBackendUnreachable, backendUnreachableResponse } from "../../../lib/lyra-stage";
import { parseStructuredWithRepair, repairInstruction } from "../../../lib/structured-output";
import {
  recallResponseSchema,
  shareableApplicabilityProfileSchema,
  type RecallLane,
} from "../../../lib/broad-recall";
import { sourceClassSchema, sourceClassPromptList, type SourceClass } from "../../../lib/source-class";
import {
  addResearchUsage,
  emptyResearchUsage,
  normalizeModelId,
  normalizeResearchEffortStep,
  researchBudgetProfiles,
  researchRunCapUsd,
  usageFromOpenRouter,
  type ResearchBudgetProfile,
  type ResearchUsage,
} from "../../../lib/research-budget";

const hostedRecallClaimSchema = z.object({
  id: z.string().trim().min(2).max(80),
  statement: z.string().trim().min(8).max(620),
  decisionLeverage: z.string().trim().min(8).max(420),
  retrieval: z.object({
    searchQuery: z.string().trim().min(8).max(800),
  }).optional(),
}).passthrough();

const hostedRecallRequestSchema = z.object({
  question: z.string().trim().min(8).max(5_000),
  compiledQuestion: z.string().trim().min(8).max(5_000).optional(),
  claims: z.array(hostedRecallClaimSchema).min(1).max(7),
  applicabilityProfile: shareableApplicabilityProfileSchema.optional(),
  promptOverrides: z.unknown().optional(),
  refresh: z.boolean().optional().default(false),
  effort: z.string().optional(),
  models: z.object({ search: z.string().optional() }).optional(),
  budgetRemainingUsd: z.number().min(0).optional(),
});

type HostedRecallRequest = z.infer<typeof hostedRecallRequestSchema>;
type HostedRecallClaim = z.infer<typeof hostedRecallClaimSchema>;

type RecallEnvironment = {
  OPENROUTER_API_KEY?: string;
  EPISTACK_OPENROUTER_RECALL_MODEL?: string;
  EPISTACK_OPENROUTER_MODEL?: string;
};

type SearchProvider = "Astra" | "OpenRouter";

type OpenRouterMessage = {
  content?: string | Array<{ type?: string; text?: string }>;
  annotations?: Array<{ type?: string; url_citation?: { url?: string; title?: string } }>;
};

function recallEnvironment() {
  return env as unknown as RecallEnvironment;
}

function openRouterRecallModel() {
  const current = recallEnvironment();
  return current.EPISTACK_OPENROUTER_RECALL_MODEL || current.EPISTACK_OPENROUTER_MODEL || "openai/gpt-4o-mini";
}

function openRouterRecallConfigured() {
  return Boolean(recallEnvironment().OPENROUTER_API_KEY);
}

function openRouterMessageText(message: OpenRouterMessage) {
  if (typeof message.content === "string") return message.content;
  return (message.content || []).map((part) => part.text || "").join("\n");
}

type RecallCallOptions = {
  model: string;
  profile: ResearchBudgetProfile;
};

async function openRouterChat(input: string, instructions: string, useWebSearch: boolean, options: RecallCallOptions) {
  const apiKey = recallEnvironment().OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter fallback is not configured.");
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
        model: options.model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: input },
        ],
        // Uncapped, the model decides how often to search: up to 30 searches in one request.
        ...(useWebSearch ? { tools: [{ type: "openrouter:web_search", parameters: options.profile.webSearch }] } : {}),
        temperature: 0,
        max_tokens: useWebSearch ? options.profile.searchMaxTokens : 2_000,
      }),
      signal: AbortSignal.timeout(useWebSearch ? 90_000 : 30_000),
    });
  } catch {
    throw new Error("OpenRouter fallback could not be reached.");
  }
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json() as { error?: { message?: string } };
      detail = payload.error?.message || "";
    } catch {
      // Keep the fallback error bounded when the provider sends no JSON.
    }
    throw new Error(`OpenRouter fallback returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : "."}`);
  }
  const payload = await response.json() as { choices?: Array<{ message?: OpenRouterMessage }>; usage?: unknown };
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error("OpenRouter fallback returned no message.");
  const text = openRouterMessageText(message);
  const citations = (message.annotations || [])
    .map((annotation) => annotation.url_citation)
    .filter((citation): citation is { url: string; title?: string } => Boolean(citation?.url))
    .map((citation) => `[${citation.title || new URL(citation.url).host}](${citation.url})`)
    .join("\n");
  return { text: [text, citations].filter(Boolean).join("\n\n"), model: options.model, usage: usageFromOpenRouter(payload.usage) };
}

async function openRouterJson(input: string, instructions: string, model: string) {
  const apiKey = recallEnvironment().OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter fallback is not configured.");
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
        reasoning: { effort: "none" },
        temperature: 0,
        max_tokens: 4_000,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("OpenRouter fallback could not be reached.");
  }
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json() as { error?: { message?: string } };
      detail = payload.error?.message || "";
    } catch {
      // Keep provider failures bounded and free of response-body surprises.
    }
    throw new Error(`OpenRouter fallback returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : "."}`);
  }
  const payload = await response.json() as { choices?: Array<{ message?: OpenRouterMessage }>; usage?: unknown };
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error("OpenRouter fallback returned no message.");
  return { text: openRouterMessageText(message), model, usage: usageFromOpenRouter(payload.usage) };
}

const emptyApplicabilityProfile = shareableApplicabilityProfileSchema.parse({});

function shortHash(value: string) {
  let primary = 2_166_136_261;
  let secondary = 3_339_675_911;
  for (let index = 0; index < value.length; index += 1) {
    primary ^= value.charCodeAt(index);
    primary = Math.imul(primary, 16_777_619);
    secondary ^= value.charCodeAt(index);
    secondary = Math.imul(secondary, 2_654_435_761);
  }
  return `${(primary >>> 0).toString(16).padStart(8, "0")}${(secondary >>> 0).toString(16).padStart(8, "0")}`;
}

function bounded(value: string, minimum: number, maximum: number) {
  const trimmed = value.trim().slice(0, maximum);
  return trimmed.length >= minimum ? trimmed : `${trimmed}${"·".repeat(minimum - trimmed.length)}`;
}

function reportedQueryFor(claims: HostedRecallClaim[]) {
  const query = claims.map((claim) => claim.retrieval?.searchQuery).find((candidate) => candidate && candidate.trim());
  return bounded(query || claims[0].statement, 3, 600);
}

function claimBlock(claims: HostedRecallClaim[]) {
  return claims.map((claim) => {
    const query = claim.retrieval?.searchQuery?.trim();
    return [
      `- id: ${claim.id}`,
      `  statement: ${claim.statement}`,
      `  decision leverage: ${claim.decisionLeverage}`,
      query ? `  search query: ${query}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n");
}

function buildLanePrompt(
  lane: RecallLane,
  input: HostedRecallRequest,
  profile: typeof emptyApplicabilityProfile,
  claims: HostedRecallClaim[],
) {
  const lines = [
    `You are the ${lane} lead-discovery lane of an evidence-investigation system.`,
    "",
    "Search the web and return a short Markdown report. Every source you cite must appear as a Markdown link: [title](https://...)",
    "Return between 2 and 12 distinct, directly relevant sources.",
    "Do not invent a source, URL, title, or query. Do not include names, addresses, employers, contact details, or other local-only facts.",
    "",
    `LANE: ${lane}`,
    `ORIGINAL QUESTION: ${input.question}`,
    `HUMAN-COMPILED QUESTION: ${input.compiledQuestion || input.question}`,
    "",
    "SCOPED CLAIMS (shareable, privacy-minimized):",
    claimBlock(claims),
  ];
  if (lane === "applicability") {
    lines.push(
      "",
      "SHAREABLE APPLICABILITY PROFILE:",
      JSON.stringify({
        populationTerms: profile.populationTerms,
        settingTerms: profile.settingTerms,
        actionTerms: profile.actionTerms,
        outcomeTerms: profile.outcomeTerms,
        constraints: profile.constraints,
        knownUnknowns: profile.knownUnknowns,
      }),
      "",
      "Focus on whether the evidence transports to this shareable population, setting, feasible action, comparator, and constraints.",
    );
  } else if (lane === "context") {
    lines.push(
      "",
      "Search for first-person reports, forums, and journalism that reveal symptoms, usability problems, failure modes, or hypotheses.",
      "These are CONTEXT SIGNALS ONLY. They can never be evidence that an intervention causes an effect. Prefer well-sourced reporting and clear primary accounts.",
    );
  } else {
    lines.push(
      "",
      "Search widely for direct evidence, systematic reviews, guidelines, trial registries, official statistics, preprints, and boundary cases.",
      "Prefer primary evidence, but include authoritative non-study sources (guidelines, registries, statistics) where they are the right kind of source.",
    );
  }
  return lines.join("\n");
}

function normalizeUrl(raw: string) {
  let value = raw.trim().replace(/[)\]}>,.;:!?'"]+$/g, "");
  while (value.endsWith(")") && (value.match(/\(/g)?.length ?? 0) < (value.match(/\)/g)?.length ?? 0)) {
    value = value.slice(0, -1);
  }
  return value;
}

function extractLinks(markdown: string) {
  const found: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();
  const push = (rawUrl: string, rawTitle: string) => {
    const url = normalizeUrl(rawUrl);
    if (!/^https?:\/\//i.test(url)) return;
    try {
      new URL(url);
    } catch {
      return;
    }
    if (url.length > 2_000 || seen.has(url)) return;
    seen.add(url);
    const title = rawTitle.trim().slice(0, 500);
    found.push({ url, title: title.length >= 3 ? title : url.slice(0, 500) });
  };
  const markdownLink = /\[([^\]]*)\]\(\s*(https?:\/\/[^\s)]+)\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = markdownLink.exec(markdown))) push(match[2], match[1]);
  const bare = /(?<![(\w])https?:\/\/[^\s<>()\[\]"']+/gi;
  while ((match = bare.exec(markdown))) push(match[0], "");
  return found;
}

type Lead = {
  id: string;
  lane: RecallLane;
  claimIds: string[];
  source: { url: string; title: string; type: "other" };
  sourceClass?: SourceClass;
  whyRelevant: string;
  disconfirming: boolean;
  limitation: string;
  status: "lead-only";
  discovery: {
    reportedQuery: string;
    queryObserved: boolean;
    sourceFetchObserved: boolean;
    toolEventIds: string[];
    observability: "model-reported-only";
  };
};

function buildLeads(lane: RecallLane, links: Array<{ url: string; title: string }>, claimIds: string[], provider: SearchProvider) {
  const reportedQuery = bounded(claimIds.length ? `scoped lane ${lane}` : "scoped lane", 3, 600);
  return links.slice(0, 12).map((link) => ({
    id: `lead-${lane}-${shortHash(link.url).slice(0, 10)}`,
    lane,
    claimIds: claimIds.length ? claimIds : ["claim"],
    source: { url: link.url, title: link.title, type: "other" as const },
    whyRelevant: `Discovered by the hosted ${lane} ${provider} web-search lane.`,
    disconfirming: false,
    limitation: `Model-reported discovery from ${provider}'s cited web-search synthesis; the underlying page was not fetched or verified.`,
    status: "lead-only" as const,
    discovery: {
      reportedQuery,
      queryObserved: false,
      sourceFetchObserved: false,
      toolEventIds: [],
      observability: "model-reported-only" as const,
    },
  })) as Lead[];
}

const classificationItemSchema = z.object({
  url: z.string().min(8).max(2_000),
  sourceClass: sourceClassSchema,
});
// Strict schema for the prompt (guides the model); loose schema for parsing so a
// single malformed entry cannot discard the whole batch.
const classificationPromptSchema = z.object({
  classifications: z.array(classificationItemSchema).max(120),
});
const classificationEnvelopeSchema = z.object({
  classifications: z.array(z.unknown()).max(400),
});

function canonicalUrl(raw: string) {
  try {
    const url = new URL(normalizeUrl(raw));
    return `${url.host.toLowerCase()}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return normalizeUrl(raw).toLowerCase();
  }
}

async function classifyLeads(leads: Lead[], model: string): Promise<ResearchUsage> {
  let usage = emptyResearchUsage;
  const unique = new Map<string, string>();
  for (const lead of leads) unique.set(lead.source.url, lead.source.title);
  if (!unique.size) return usage;
  const list = [...unique.entries()].map(([url, title]) => ({ url, title }));
  const instructions = [
    "You classify web sources by their source class. For each item return its exact url and one sourceClass.",
    "Classes:",
    sourceClassPromptList,
    "Rules: a peer-reviewed randomized or observational human study is primary-study; a meta-analysis or systematic review is systematic-review; a professional-society or public-health recommendation is guideline; a formal spec (ISO, NIST, etc.) is standard; a trials registry entry is trial-registry; a government or international dataset/report is official-statistics; an unreviewed manuscript server is preprint; news and expert commentary is reporting; a forum post or first-person account is anecdote.",
    "Return only JSON matching this schema. No markdown fences.",
    JSON.stringify(z.toJSONSchema(classificationPromptSchema)),
  ].join("\n");
  const classifyWithOpenRouter = async (input: string, prompt: string) => {
    const result = await openRouterJson(input, prompt, model);
    usage = addResearchUsage(usage, result.usage);
    return result.text;
  };
  let raw: string;
  if (lyraConfigured()) {
    try {
      raw = await runLyraStage({ model: "lyra-chatgpt-pro", effort: "instant", instructions, input: JSON.stringify(list) });
    } catch (error) {
      if (!isBackendUnreachable(error) || !openRouterRecallConfigured()) throw error;
      raw = await classifyWithOpenRouter(JSON.stringify(list), instructions);
    }
  } else {
    raw = await classifyWithOpenRouter(JSON.stringify(list), instructions);
  }
  let envelope: z.infer<typeof classificationEnvelopeSchema>;
  try {
    envelope = await parseStructuredWithRepair({
      text: raw,
      schema: classificationEnvelopeSchema,
      repair: async ({ raw: previous, issues }) => classifyWithOpenRouter(
        JSON.stringify(list),
        instructions + repairInstruction(classificationEnvelopeSchema, issues)
          + `\nPREVIOUS ATTEMPT:\n${previous.slice(0, 12_000)}`,
      ),
    });
  } catch {
    // Classification is an enhancement. If a provider cannot classify this
    // batch, the leads remain visible with their explicit `other` class.
    envelope = classificationEnvelopeSchema.parse({ classifications: [] });
  }
  const classifications = envelope.classifications.flatMap((candidate) => {
    const parsed = classificationItemSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
  const byCanonical = new Map<string, SourceClass>();
  const byTitle = new Map<string, SourceClass>();
  for (const entry of classifications) {
    byCanonical.set(canonicalUrl(entry.url), entry.sourceClass);
    byTitle.set(entry.url.trim().toLowerCase(), entry.sourceClass);
  }
  const byLeadTitle = new Map(list.map((item) => [item.title.trim().toLowerCase(), item.url]));
  for (const lead of leads) {
    lead.sourceClass = byCanonical.get(canonicalUrl(lead.source.url))
      ?? byCanonical.get(canonicalUrl(byLeadTitle.get(lead.source.title.trim().toLowerCase()) ?? ""))
      ?? byTitle.get(lead.source.title.trim().toLowerCase());
  }
  return usage;
}

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!lyraConfigured() && !openRouterRecallConfigured()) {
    return json({ error: "Hosted lead discovery is not configured yet.", code: "hosted-not-configured" }, 503);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }
  const parsed = hostedRecallRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ error: issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid lead-discovery request." }, 400);
  }
  const input = parsed.data;
  if (input.budgetRemainingUsd !== undefined && input.budgetRemainingUsd <= 0) {
    return json({ error: `This run has reached its $${researchRunCapUsd} cap. Start a new run to search again.`, code: "run-budget-exhausted" }, 409);
  }
  if (input.models?.search && !normalizeModelId(input.models.search)) {
    return json({ error: "Use an OpenRouter model id in provider/model form for the search model." }, 400);
  }
  const profile = input.applicabilityProfile ?? emptyApplicabilityProfile;
  const compiledQuestion = input.compiledQuestion || input.question;
  const effort = normalizeResearchEffortStep(input.effort);
  const budget = researchBudgetProfiles[effort];
  const searchModel = normalizeModelId(input.models?.search) || openRouterRecallModel();
  const cacheKey = `recall-${shortHash(JSON.stringify({
    question: input.question,
    compiledQuestion,
    claims: input.claims,
    applicabilityProfile: profile,
    effort,
    searchModel,
  }))}`;

  type SearchLaneResult = {
    leads: Lead[];
    provider: SearchProvider;
    model: string;
    usage: ResearchUsage;
  };

  async function searchLane(lane: RecallLane, claims: HostedRecallClaim[]) {
    const lanePrompt = buildLanePrompt(lane, input, profile, claims);
    if (lyraConfigured()) {
      try {
        const markdown = await runLyraStage({ model: "lyra-web-search", input: lanePrompt });
        return { leads: buildLeads(lane, extractLinks(markdown), claims.map((claim) => claim.id), "Astra"), provider: "Astra" as const, model: "Astra · web search", usage: emptyResearchUsage } satisfies SearchLaneResult;
      } catch (error) {
        if (!isBackendUnreachable(error) || !openRouterRecallConfigured()) throw error;
      }
    }
    const fallback = await openRouterChat(lanePrompt, "You are a careful web-research lead generator. Return a short Markdown report with every source as a Markdown link. Keep all results lead-only: discovery is not evidence, and do not claim that a source has been acquired or verified.", true, { model: searchModel, profile: budget });
    return {
      leads: buildLeads(lane, extractLinks(fallback.text), claims.map((claim) => claim.id), "OpenRouter"),
      provider: "OpenRouter",
      model: `OpenRouter · ${fallback.model} (Astra fallback · web search)`,
      usage: fallback.usage,
    } satisfies SearchLaneResult;
  }

  try {
    const tasks: Array<Promise<SearchLaneResult>> = [
      // One broad-recall agent per claim: more scoped agents, not one broad sweep.
      ...input.claims.map((claim) => searchLane("broad-recall", [claim])),
      searchLane("applicability", input.claims),
      searchLane("context", input.claims),
    ];
    const settled = await Promise.allSettled(tasks);
    const successful = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    let leads = successful.flatMap((result) => result.leads);

    if (!leads.length && settled.length > 0 && settled.every((result) => result.status === "rejected" && isBackendUnreachable(result.reason))) {
      return backendUnreachableResponse();
    }

    // Dedupe across lanes by URL, preferring the first non-context lane.
    const byUrl = new Map<string, Lead>();
    const laneRank: Record<RecallLane, number> = { "broad-recall": 0, applicability: 1, context: 2 };
    for (const lead of leads) {
      const existing = byUrl.get(lead.source.url);
      if (!existing || laneRank[lead.lane] < laneRank[existing.lane]) byUrl.set(lead.source.url, lead);
    }
    leads = [...byUrl.values()];

    if (!leads.length) {
      return json({ error: "Hosted lead discovery returned no usable source links." }, 502);
    }

    let classificationUsage = emptyResearchUsage;
    try {
      classificationUsage = await classifyLeads(leads, searchModel);
    } catch (error) {
      // Classification is an enhancement; unclassified leads stay valid — but
      // never hide the failure: a silent miss leaves every lead "other".
      console.error("[recall] classification failed:", error instanceof Error ? error.message : error);
    }

    const laneOrder: RecallLane[] = ["broad-recall", "applicability", "context"];
    const providers = new Set(successful.map((result) => result.provider));
    const model = successful.length === 1
      ? successful[0].model
      : providers.size > 1
        ? "Astra + OpenRouter · web search fallback"
        : successful[0]?.model || "Astra · web search";
    const providerLabel = providers.size > 1 ? "Astra + OpenRouter" : successful[0]?.provider || "Astra";
    const laneResults = laneOrder.map((lane) => {
      const laneLeads = leads.filter((lead) => lead.lane === lane);
      return {
        lane,
        searchSummary: lane === "broad-recall"
          ? `Hosted ${providerLabel} broad-recall returned ${laneLeads.length} candidate source${laneLeads.length === 1 ? "" : "s"} across ${input.claims.length} claim lane${input.claims.length === 1 ? "" : "s"}.`
          : lane === "context"
            ? `Hosted ${providerLabel} context lane returned ${laneLeads.length} signal${laneLeads.length === 1 ? "" : "s"} (context only; cannot promote to evidence).`
            : `Hosted ${providerLabel} applicability lane returned ${laneLeads.length} candidate source${laneLeads.length === 1 ? "" : "s"}.`,
        unsearchedBoundaries: [] as string[],
        leadIds: (laneLeads.length ? laneLeads : leads.filter((lead) => lead.lane === "broad-recall")).map((lead) => lead.id).slice(0, 12),
      };
    });
    const presentLaneResults = laneResults.filter((lane) => lane.leadIds.length > 0);

    const response = recallResponseSchema.parse({
      schemaVersion: "0.1.0",
      status: "lead-only",
      question: input.question,
      compiledQuestion,
      generatedAt: new Date().toISOString(),
      model,
      lanes: presentLaneResults.slice(0, 12),
      leads: leads.slice(0, 24),
      toolTrace: [],
      observability: {
        mode: "model-reported-only",
        capturedToolEvents: 0,
        boundary: "Web search returns cited synthesis, not a verifiable WebSearch/WebFetch trace; leads are model-reported discovery only. Acquisition, extraction, and promotion remain separate gates.",
      },
      cache: {
        status: input.refresh ? "bypass" : "miss",
        key: cacheKey,
        createdAt: new Date().toISOString(),
      },
    });
    const usage = successful.reduce((total, result) => addResearchUsage(total, result.usage), classificationUsage);
    return json({ ...response, effort, usage });
  } catch (error) {
    if (isBackendUnreachable(error)) return backendUnreachableResponse();
    return json({ error: error instanceof Error ? error.message : "Hosted lead discovery failed." }, 502);
  }
}
