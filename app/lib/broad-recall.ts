import { z } from "zod";
import { sourceClassSchema } from "./source-class.ts";

const boundedText = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum);

export const recallLaneSchema = z.enum(["broad-recall", "applicability", "context"]);
export type RecallLane = z.infer<typeof recallLaneSchema>;

export const recallSourceTypeSchema = z.enum([
  "systematic-review",
  "peer-reviewed-study",
  "preprint",
  "official-guidance",
  "government-record",
  "dataset",
  "professional-analysis",
  "investigative-reporting",
  "organization-page",
  "first-person-report",
  "other",
]);

export const recallClaimSchema = z.object({
  id: boundedText(2, 80),
  statement: boundedText(8, 620),
  population: boundedText(2, 320),
  exposure: boundedText(2, 320),
  comparator: boundedText(2, 320),
  outcome: boundedText(2, 260),
  timeHorizon: boundedText(2, 160),
  decisionLeverage: boundedText(8, 420),
  applicabilityFields: z.array(boundedText(2, 160)).max(12),
});

export const shareableApplicabilityProfileSchema = z.object({
  populationTerms: z.array(boundedText(1, 120)).max(12).default([]),
  settingTerms: z.array(boundedText(1, 120)).max(12).default([]),
  actionTerms: z.array(boundedText(1, 160)).max(12).default([]),
  outcomeTerms: z.array(boundedText(1, 120)).max(12).default([]),
  constraints: z.array(boundedText(1, 220)).max(12).default([]),
  knownUnknowns: z.array(boundedText(1, 220)).max(12).default([]),
}).strict();

export const recallRequestSchema = z.object({
  question: boundedText(8, 5_000),
  compiledQuestion: boundedText(8, 5_000).optional(),
  claims: z.array(recallClaimSchema).min(1).max(7),
  applicabilityProfile: shareableApplicabilityProfileSchema.default({
    populationTerms: [],
    settingTerms: [],
    actionTerms: [],
    outcomeTerms: [],
    constraints: [],
    knownUnknowns: [],
  }),
  promptOverrides: z.unknown().optional(),
  refresh: z.boolean().optional().default(false),
}).strict();

export type RecallRequest = z.infer<typeof recallRequestSchema>;

/**
 * This is the model's deliberately modest contract. Tool traces are not
 * model-authored: the local companion attaches them from Claude CLI events.
 */
export const recallLeadDraftSchema = z.object({
  claimIds: z.array(boundedText(2, 80)).min(1).max(7),
  source: z.object({
    url: z.string().url().max(2_000),
    title: boundedText(3, 500),
    type: recallSourceTypeSchema,
  }).strict(),
  whyRelevant: boundedText(8, 720),
  disconfirming: z.boolean(),
  limitation: boundedText(3, 480),
  reportedQuery: boundedText(3, 600),
  status: z.literal("lead-only"),
}).strict();

export const recallLaneDraftSchema = z.object({
  searchSummary: boundedText(8, 720),
  unsearchedBoundaries: z.array(boundedText(3, 420)).max(10),
  leads: z.array(recallLeadDraftSchema).min(1).max(12),
}).strict();

export const recallToolTraceEventSchema = z.object({
  id: boundedText(2, 180),
  toolUseId: boundedText(1, 180),
  lane: recallLaneSchema,
  tool: z.enum(["WebSearch", "WebFetch"]),
  state: z.enum(["requested", "completed", "failed"]),
  query: z.string().max(1_000).nullable(),
  url: z.string().max(2_000).nullable(),
  observedAt: z.string().datetime(),
  provenance: z.literal("claude-cli-stream"),
}).strict();

export type RecallToolTraceEvent = z.infer<typeof recallToolTraceEventSchema>;

export const recallLeadSchema = recallLeadDraftSchema.omit({ reportedQuery: true }).extend({
  id: boundedText(6, 120),
  lane: recallLaneSchema,
  sourceClass: sourceClassSchema.optional(),
  discovery: z.object({
    reportedQuery: boundedText(3, 600),
    queryObserved: z.boolean(),
    sourceFetchObserved: z.boolean(),
    toolEventIds: z.array(boundedText(2, 180)).max(40),
    observability: z.enum(["cli-observed", "model-reported-only"]),
  }).strict(),
});

export const recallLaneResultSchema = z.object({
  lane: recallLaneSchema,
  searchSummary: boundedText(8, 720),
  unsearchedBoundaries: z.array(boundedText(3, 420)).max(10),
  leadIds: z.array(boundedText(6, 120)).min(1).max(12),
}).strict();

export const recallResponseSchema = z.object({
  schemaVersion: z.literal("0.1.0"),
  status: z.literal("lead-only"),
  question: boundedText(8, 5_000),
  compiledQuestion: boundedText(8, 5_000),
  generatedAt: z.string().datetime(),
  model: boundedText(1, 120),
  // Hosted discovery is parallel and may return a useful partial result when
  // one provider lane times out. The UI reports the lanes that actually ran.
  lanes: z.array(recallLaneResultSchema).min(1).max(12),
  leads: z.array(recallLeadSchema).min(2).max(24),
  toolTrace: z.array(recallToolTraceEventSchema).max(240),
  observability: z.object({
    mode: z.enum(["cli-tool-events", "model-reported-only"]),
    capturedToolEvents: z.number().int().min(0),
    boundary: boundedText(12, 720),
  }).strict(),
  cache: z.object({
    status: z.enum(["hit", "miss", "bypass"]),
    key: boundedText(16, 128),
    createdAt: z.string().datetime(),
  }).strict(),
}).strict();

export type RecallResponse = z.infer<typeof recallResponseSchema>;

function normalizeForMatch(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function stableTextHash(value: string) {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

export function normalizeRecallLane(
  lane: RecallLane,
  draftValue: unknown,
  toolTrace: RecallToolTraceEvent[],
) {
  const draft = recallLaneDraftSchema.parse(draftValue);
  const seenIds = new Map<string, number>();
  const leads = draft.leads.map((lead) => {
    const { reportedQuery, ...leadWithoutReportedQuery } = lead;
    const matchingTrace = toolTrace.filter((event) => {
      if (event.lane !== lane) return false;
      const queryMatches = event.tool === "WebSearch"
        && normalizeForMatch(event.query) === normalizeForMatch(reportedQuery);
      const urlMatches = event.tool === "WebFetch"
        && normalizeForMatch(event.url) === normalizeForMatch(lead.source.url);
      return queryMatches || urlMatches;
    });
    const baseId = `lead-${stableTextHash(`${lane}\n${lead.source.url}\n${lead.claimIds.slice().sort().join(",")}`)}`;
    const occurrence = (seenIds.get(baseId) ?? 0) + 1;
    seenIds.set(baseId, occurrence);
    const id = occurrence === 1 ? baseId : `${baseId}-${occurrence}`;
    const queryObserved = matchingTrace.some((event) => event.tool === "WebSearch" && event.state === "requested");
    const sourceFetchObserved = matchingTrace.some((event) => event.tool === "WebFetch" && event.state === "requested");
    return recallLeadSchema.parse({
      ...leadWithoutReportedQuery,
      id,
      lane,
      discovery: {
        reportedQuery,
        queryObserved,
        sourceFetchObserved,
        toolEventIds: Array.from(new Set(matchingTrace.map((event) => event.id))).slice(0, 40),
        observability: queryObserved || sourceFetchObserved ? "cli-observed" : "model-reported-only",
      },
    });
  });
  return {
    lane: recallLaneResultSchema.parse({
      lane,
      searchSummary: draft.searchSummary,
      unsearchedBoundaries: draft.unsearchedBoundaries,
      leadIds: leads.map((lead) => lead.id),
    }),
    leads,
  };
}
