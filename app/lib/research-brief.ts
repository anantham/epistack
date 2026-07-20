import { z } from "zod";
import type { DecompositionCluster, InterpretationAxis } from "./decomposition";

export const researchBriefStorageKey = "epistack:research-brief:v1";

export const dimensionRoleSchema = z.enum([
  "decision-active",
  "applicability-only",
  "monitored-unknown",
  "parked",
]);

export type DimensionRole = z.infer<typeof dimensionRoleSchema>;

const boundedText = (minimum: number, maximum: number) => z.string().min(minimum).max(maximum);

export const researchClaimFrameSchema = z.object({
  id: boundedText(2, 80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  shortLabel: boundedText(3, 100),
  statement: boundedText(12, 620),
  kind: z.enum(["effectiveness", "harm", "comparator", "mechanism", "implementation", "heterogeneity"]),
  population: boundedText(2, 320),
  exposure: boundedText(2, 320),
  comparator: boundedText(2, 320),
  outcome: boundedText(2, 260),
  timeHorizon: boundedText(2, 160),
  modality: z.enum(["causal", "associational", "descriptive"]),
  priority: z.number().int().min(1).max(5),
  budgetShare: z.number().int().min(1).max(100),
  decisionLeverage: boundedText(8, 420),
  axisIds: z.array(boundedText(1, 80)).min(1).max(10),
  queryUsesAxisIds: z.array(boundedText(1, 80)).max(10),
  applicabilityUsesAxisIds: z.array(boundedText(1, 80)).max(10),
  retrieval: z.object({
    searchQuery: boundedText(8, 800),
    inclusionRule: boundedText(8, 520),
    exclusionSignals: z.array(boundedText(2, 180)).min(1).max(8),
    relaxationOrder: z.array(boundedText(3, 260)).min(1).max(6),
  }),
  applicabilityFields: z.array(boundedText(2, 160)).min(1).max(12),
});

export type ResearchClaimFrame = z.infer<typeof researchClaimFrameSchema>;

export const dimensionAssignmentSchema = z.object({
  axisId: boundedText(1, 80),
  label: boundedText(2, 120),
  selectedBranchId: boundedText(1, 80).nullable(),
  selectedValue: boundedText(1, 320).nullable(),
  role: dimensionRoleSchema,
  rationale: boundedText(8, 420),
  searchConcepts: z.array(boundedText(1, 160)).max(12),
  requiredEvidenceFields: z.array(boundedText(1, 160)).max(12),
  mismatchRisks: z.array(boundedText(2, 320)).max(10),
});

export const researchBriefDraftSchema = z.object({
  stakeholderProfile: z.object({
    summary: boundedText(12, 720),
    objectives: z.array(boundedText(2, 220)).min(1).max(8),
    hardConstraints: z.array(boundedText(2, 220)).max(8),
    preferences: z.array(boundedText(2, 220)).max(8),
    localOnlyFacts: z.array(boundedText(2, 220)).max(12),
  }),
  actionSpace: z.object({
    decision: boundedText(8, 420),
    currentAction: boundedText(2, 260),
    options: z.array(z.object({
      id: boundedText(2, 80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      label: boundedText(2, 120),
      description: boundedText(4, 360),
      feasibility: z.enum(["available-now", "plausible", "currently-unavailable"]),
    })).min(2).max(8),
    decisionHorizon: boundedText(2, 180),
    measurementPlan: z.array(boundedText(4, 260)).max(8),
  }),
  claims: z.array(researchClaimFrameSchema).min(3).max(7),
  parkedDimensions: z.array(z.object({
    axisId: boundedText(1, 80),
    reason: boundedText(8, 360),
    reactivationTrigger: boundedText(8, 360),
  })).max(12),
  gapTriggers: z.array(z.object({
    question: boundedText(8, 320),
    expectedDecisionValue: z.enum(["high", "medium", "low"]),
    rationale: boundedText(8, 360),
    launchWhen: boundedText(8, 360),
  })).max(8),
});

export const researchBriefSchema = researchBriefDraftSchema.extend({
  schemaVersion: z.literal("0.2.0"),
  briefId: boundedText(8, 96),
  caseId: boundedText(1, 120),
  originalQuestion: boundedText(8, 5_000),
  compiledQuestion: boundedText(8, 5_000),
  decisionContext: z.string().max(8_000),
  dimensionAssignments: z.array(dimensionAssignmentSchema).min(1).max(12),
  privacy: z.object({
    localContextPolicy: boundedText(8, 420),
    outboundQueryPolicy: boundedText(8, 420),
  }),
  generatedAt: z.string().datetime(),
  compiledBy: boundedText(2, 160),
});

export type ResearchBrief = z.infer<typeof researchBriefSchema>;
export type ResearchBriefDraft = z.infer<typeof researchBriefDraftSchema>;

export type ResearchBriefCompilerInput = {
  caseId: string;
  originalQuestion: string;
  compiledQuestion: string;
  decisionContext: string;
  axes: InterpretationAxis[];
  clusters: DecompositionCluster[];
  knownUnknowns: string[];
  dimensionRoles: Record<string, DimensionRole>;
  prior: number;
};

const applicabilityPattern = /(population|people|person|who|where|setting|geograph|jurisdiction|demograph|age|sex|source|access|preference)/i;
const monitoredPattern = /(unknown|uncertain|predict|modifier|heterogen|boundary|mechanism|production|provenance|certif|feed|housing)/i;

export function defaultDimensionRole(axis: Pick<InterpretationAxis, "id" | "label" | "question" | "branches">): DimensionRole {
  const selected = axis.branches.find((branch) => branch.status === "kept");
  if (!selected) return axis.branches.every((branch) => branch.status === "parked") ? "parked" : "monitored-unknown";
  const description = `${axis.id} ${axis.label} ${axis.question}`;
  if (applicabilityPattern.test(description)) return "applicability-only";
  if (selected.relevance === "low" || monitoredPattern.test(description) && selected.relevance !== "high") return "monitored-unknown";
  return "decision-active";
}

export function completeDimensionRoles(axes: InterpretationAxis[], saved: Record<string, DimensionRole> = {}) {
  return Object.fromEntries(axes.map((axis) => [
    axis.id,
    dimensionRoleSchema.safeParse(saved[axis.id]).success ? saved[axis.id] : defaultDimensionRole(axis),
  ])) as Record<string, DimensionRole>;
}

export function buildDimensionAssignments(input: Pick<ResearchBriefCompilerInput, "axes" | "clusters" | "dimensionRoles">) {
  const roles = completeDimensionRoles(input.axes, input.dimensionRoles);
  return input.axes.map((axis) => {
    const selected = axis.branches.find((branch) => branch.status === "kept") ?? null;
    const traces = input.clusters.filter((cluster) => cluster.axisId === axis.id);
    const unique = (values: string[]) => Array.from(new Set(values));
    return dimensionAssignmentSchema.parse({
      axisId: axis.id,
      label: axis.label,
      selectedBranchId: selected?.id ?? null,
      selectedValue: selected?.value ?? null,
      role: roles[axis.id],
      rationale: roleRationale(roles[axis.id], selected?.label),
      searchConcepts: unique(traces.flatMap((trace) => trace.ingestionRequirements.searchConcepts)).slice(0, 12),
      requiredEvidenceFields: unique(traces.flatMap((trace) => trace.ingestionRequirements.requiredFields)).slice(0, 12),
      mismatchRisks: unique(traces.flatMap((trace) => trace.ingestionRequirements.mismatchRisks)).slice(0, 10),
    });
  });
}

function roleRationale(role: DimensionRole, selectedLabel?: string) {
  const selection = selectedLabel ? ` The active human-selected scope is “${selectedLabel}”.` : " No branch is currently active.";
  if (role === "decision-active") return `This dimension changes the proposition or realistic comparison the investigation must test.${selection}`;
  if (role === "applicability-only") return `This dimension is used to judge transportability and scope match without automatically narrowing every retrieval query.${selection}`;
  if (role === "monitored-unknown") return `This dimension stays visible as a possible gap and receives work only when it has high expected decision value.${selection}`;
  return `This dimension receives no research budget unless a later result or human decision reactivates it.${selection}`;
}

export function normalizeResearchBriefDraft(draft: ResearchBriefDraft, validAxisIds: string[]): ResearchBriefDraft {
  const allowed = new Set(validAxisIds);
  const seen = new Set<string>();
  const rawWeights = draft.claims.map((claim) => Math.max(1, claim.budgetShare));
  const total = rawWeights.reduce((sum, weight) => sum + weight, 0);
  const exactShares = rawWeights.map((weight) => (weight / total) * 100);
  const normalizedShares = exactShares.map((share) => Math.max(1, Math.floor(share)));
  let shareDelta = 100 - normalizedShares.reduce((sum, share) => sum + share, 0);
  const remainderOrder = exactShares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder);
  let cursor = 0;
  while (shareDelta !== 0) {
    const target = remainderOrder[cursor % remainderOrder.length].index;
    if (shareDelta > 0) {
      normalizedShares[target] += 1;
      shareDelta -= 1;
    } else if (normalizedShares[target] > 1) {
      normalizedShares[target] -= 1;
      shareDelta += 1;
    }
    cursor += 1;
  }
  const claims = draft.claims.map((claim, index) => {
    let id = claim.id;
    let suffix = 2;
    while (seen.has(id)) id = `${claim.id}-${suffix++}`;
    seen.add(id);
    const filtered = (ids: string[]) => Array.from(new Set(ids.filter((axisId) => allowed.has(axisId))));
    const axisIds = filtered(claim.axisIds);
    return {
      ...claim,
      id,
      budgetShare: normalizedShares[index],
      axisIds: axisIds.length ? axisIds : validAxisIds.slice(0, 1),
      queryUsesAxisIds: filtered(claim.queryUsesAxisIds),
      applicabilityUsesAxisIds: filtered(claim.applicabilityUsesAxisIds),
    };
  });
  return researchBriefDraftSchema.parse({ ...draft, claims });
}

export function researchLanesFromBrief(brief: ResearchBrief) {
  return brief.claims
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((claim) => ({
      id: claim.id,
      label: claim.shortLabel,
      question: claim.statement,
      focus: `${claim.decisionLeverage} Applicability is checked against: ${claim.applicabilityFields.join(", ")}.`,
      defaultQuery: claim.retrieval.searchQuery,
      crux: claim.decisionLeverage,
      inclusionRule: claim.retrieval.inclusionRule,
      knownSourceIds: [] as string[],
      claimFrameId: claim.id,
      budgetShare: claim.budgetShare,
      relaxationOrder: claim.retrieval.relaxationOrder,
      applicabilityFields: claim.applicabilityFields,
    }));
}
