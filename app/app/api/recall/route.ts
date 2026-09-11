import { z } from "zod";
import { lyraConfigured, runLyraStage } from "../../../lib/lyra-stage";
import {
  recallResponseSchema,
  shareableApplicabilityProfileSchema,
  type RecallLane,
} from "../../../lib/broad-recall";

const lanes: RecallLane[] = ["broad-recall", "applicability"];

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

function buildLanePrompt(lane: RecallLane, input: HostedRecallRequest, profile: typeof emptyApplicabilityProfile) {
  const claimBlock = input.claims.map((claim) => {
    const query = claim.retrieval?.searchQuery?.trim();
    return [
      `- id: ${claim.id}`,
      `  statement: ${claim.statement}`,
      `  decision leverage: ${claim.decisionLeverage}`,
      query ? `  search query: ${query}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n");
  const lines = [
    `You are the ${lane} lead-discovery lane of an evidence-investigation system.`,
    "",
    "Search the web and return a short Markdown report. Every source you cite must appear as a Markdown link: [title](https://...)",
    "Return between 2 and 12 distinct, directly relevant sources. Prefer primary sources, authoritative records, and evidence that could weaken, reverse, or bound a claim.",
    "Do not invent a source, URL, title, or query. Do not include names, addresses, employers, contact details, or other local-only facts.",
    "",
    `LANE: ${lane}`,
    `ORIGINAL QUESTION: ${input.question}`,
    `HUMAN-COMPILED QUESTION: ${input.compiledQuestion || input.question}`,
    "",
    "SCOPED CLAIMS (shareable, privacy-minimized):",
    claimBlock,
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
  } else {
    lines.push(
      "",
      "Search widely: direct evidence, negative results, failed replications, corrections, rebuttals, and boundary cases. Do not personalize the search.",
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

function buildLeads(lane: RecallLane, links: Array<{ url: string; title: string }>, claims: HostedRecallClaim[]) {
  const firstClaimId = claims[0].id;
  const reportedQuery = reportedQueryFor(claims);
  return links.slice(0, 12).map((link) => ({
    id: `lead-${lane}-${shortHash(link.url).slice(0, 10)}`,
    lane,
    claimIds: [firstClaimId],
    source: { url: link.url, title: link.title, type: "other" as const },
    whyRelevant: `Discovered by the hosted ${lane} Lyra web-search lane for claim ${firstClaimId}.`,
    disconfirming: false,
    limitation: "Model-reported discovery from Lyra's cited web-search synthesis; the underlying page was not fetched or verified.",
    status: "lead-only" as const,
    discovery: {
      reportedQuery,
      queryObserved: false,
      sourceFetchObserved: false,
      toolEventIds: [],
      observability: "model-reported-only" as const,
    },
  }));
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
  try {
    const laneResults = await Promise.all(lanes.map(async (lane) => {
      const markdown = await runLyraStage({
        model: "lyra-web-search",
        input: buildLanePrompt(lane, input, profile),
      });
      const leads = buildLeads(lane, extractLinks(markdown), input.claims);
      if (!leads.length) throw new Error(`The ${lane} hosted web-search lane returned no usable source links.`);
      return {
        laneResult: {
          lane,
          searchSummary: `Hosted Lyra web search returned ${leads.length} candidate source${leads.length === 1 ? "" : "s"} for the ${lane} lane.`,
          unsearchedBoundaries: [] as string[],
          leadIds: leads.map((lead) => lead.id),
        },
        leads,
      };
    }));
    const response = recallResponseSchema.parse({
      schemaVersion: "0.1.0",
      status: "lead-only",
      question: input.question,
      compiledQuestion,
      generatedAt: new Date().toISOString(),
      model: "Lyra · lyra-web-search",
      lanes: laneResults.map((entry) => entry.laneResult),
      leads: laneResults.flatMap((entry) => entry.leads),
      toolTrace: [],
      observability: {
        mode: "model-reported-only",
        capturedToolEvents: 0,
        boundary: "Lyra web search returns cited synthesis, not a verifiable WebSearch/WebFetch trace; leads are model-reported discovery only.",
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
