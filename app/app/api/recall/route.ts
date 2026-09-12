import { z } from "zod";
import { lyraConfigured, runLyraStage } from "../../../lib/lyra-stage";
import {
  recallResponseSchema,
  shareableApplicabilityProfileSchema,
  type RecallLane,
} from "../../../lib/broad-recall";
import { sourceClassSchema, sourceClassPromptList, type SourceClass } from "../../../lib/source-class";

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
});

type HostedRecallRequest = z.infer<typeof hostedRecallRequestSchema>;
type HostedRecallClaim = z.infer<typeof hostedRecallClaimSchema>;

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

function stripFences(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
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

function buildLeads(lane: RecallLane, links: Array<{ url: string; title: string }>, claimIds: string[]) {
  const reportedQuery = bounded(claimIds.length ? `scoped lane ${lane}` : "scoped lane", 3, 600);
  return links.slice(0, 12).map((link) => ({
    id: `lead-${lane}-${shortHash(link.url).slice(0, 10)}`,
    lane,
    claimIds: claimIds.length ? claimIds : ["claim"],
    source: { url: link.url, title: link.title, type: "other" as const },
    whyRelevant: `Discovered by the hosted ${lane} Astra web-search lane.`,
    disconfirming: false,
    limitation: "Model-reported discovery from Astra's cited web-search synthesis; the underlying page was not fetched or verified.",
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

async function classifyLeads(leads: Lead[]) {
  const unique = new Map<string, string>();
  for (const lead of leads) unique.set(lead.source.url, lead.source.title);
  if (!unique.size) return;
  const list = [...unique.entries()].map(([url, title]) => ({ url, title }));
  const instructions = [
    "You classify web sources by their source class. For each item return its exact url and one sourceClass.",
    "Classes:",
    sourceClassPromptList,
    "Rules: a peer-reviewed randomized or observational human study is primary-study; a meta-analysis or systematic review is systematic-review; a professional-society or public-health recommendation is guideline; a formal spec (ISO, NIST, etc.) is standard; a trials registry entry is trial-registry; a government or international dataset/report is official-statistics; an unreviewed manuscript server is preprint; news and expert commentary is reporting; a forum post or first-person account is anecdote.",
    "Return only JSON matching this schema. No markdown fences.",
    JSON.stringify(z.toJSONSchema(classificationPromptSchema)),
  ].join("\n");
  const raw = await runLyraStage({ model: "lyra-chatgpt-pro", effort: "instant", instructions, input: JSON.stringify(list) });
  const envelope = classificationEnvelopeSchema.parse(JSON.parse(stripFences(raw)));
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
}

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!lyraConfigured()) {
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
  const profile = input.applicabilityProfile ?? emptyApplicabilityProfile;
  const compiledQuestion = input.compiledQuestion || input.question;
  const cacheKey = `recall-${shortHash(JSON.stringify({
    question: input.question,
    compiledQuestion,
    claims: input.claims,
    applicabilityProfile: profile,
  }))}`;

  async function searchLane(lane: RecallLane, claims: HostedRecallClaim[]) {
    const markdown = await runLyraStage({
      model: "lyra-web-search",
      input: buildLanePrompt(lane, input, profile, claims),
    });
    return buildLeads(lane, extractLinks(markdown), claims.map((claim) => claim.id));
  }

  try {
    const tasks: Array<Promise<Lead[]>> = [
      // One broad-recall agent per claim: more scoped agents, not one broad sweep.
      ...input.claims.map((claim) => searchLane("broad-recall", [claim])),
      searchLane("applicability", input.claims),
      searchLane("context", input.claims),
    ];
    const settled = await Promise.allSettled(tasks);
    let leads = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

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

    try {
      await classifyLeads(leads);
    } catch (error) {
      // Classification is an enhancement; unclassified leads stay valid — but
      // never hide the failure: a silent miss leaves every lead "other".
      console.error("[recall] classification failed:", error instanceof Error ? error.message : error);
    }

    const laneOrder: RecallLane[] = ["broad-recall", "applicability", "context"];
    const laneResults = laneOrder.map((lane) => {
      const laneLeads = leads.filter((lead) => lead.lane === lane);
      return {
        lane,
        searchSummary: lane === "broad-recall"
          ? `Hosted Astra broad-recall returned ${laneLeads.length} candidate source${laneLeads.length === 1 ? "" : "s"} across ${input.claims.length} claim lane${input.claims.length === 1 ? "" : "s"}.`
          : lane === "context"
            ? `Hosted Astra context lane returned ${laneLeads.length} signal${laneLeads.length === 1 ? "" : "s"} (context only; cannot promote to evidence).`
            : `Hosted Astra applicability lane returned ${laneLeads.length} candidate source${laneLeads.length === 1 ? "" : "s"}.`,
        unsearchedBoundaries: [] as string[],
        leadIds: (laneLeads.length ? laneLeads : leads.filter((lead) => lead.lane === "broad-recall")).map((lead) => lead.id),
      };
    });
    const presentLaneResults = laneResults.filter((lane) => lane.leadIds.length > 0);

    const response = recallResponseSchema.parse({
      schemaVersion: "0.1.0",
      status: "lead-only",
      question: input.question,
      compiledQuestion,
      generatedAt: new Date().toISOString(),
      model: "Astra · web search",
      lanes: presentLaneResults.slice(0, 12),
      leads: leads.slice(0, 24),
      toolTrace: [],
      observability: {
        mode: "model-reported-only",
        capturedToolEvents: 0,
        boundary: "Astra web search returns cited synthesis, not a verifiable WebSearch/WebFetch trace; leads are model-reported discovery only.",
      },
      cache: {
        status: input.refresh ? "bypass" : "miss",
        key: cacheKey,
        createdAt: new Date().toISOString(),
      },
    });
    return json(response);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Hosted lead discovery failed." }, 502);
  }
}
