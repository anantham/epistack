import { z } from "zod";
import type { DecompositionCluster } from "./decomposition";

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

export const contextualizationEntrySchema = z.object({
  axisId: boundedText(1, 80),
  label: boundedText(2, 120),
  question: boundedText(8, 520),
  whyItMatters: boundedText(8, 520),
  effect: z.enum(["prune", "branch", "match"]),
  selectedValues: z.array(boundedText(1, 320)).max(12),
  typedAnswer: z.string().max(1000),
  researchConsequence: boundedText(8, 520),
});

export type ContextualizationEntry = z.infer<typeof contextualizationEntrySchema>;

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
  contextualization: z.array(contextualizationEntrySchema).max(12).default([]),
  privacy: z.object({
    localContextPolicy: boundedText(8, 420),
    outboundQueryPolicy: boundedText(8, 420),
    shareContextInArtifact: z.boolean().default(false),
  }),
  generatedAt: z.string().datetime(),
  compiledBy: boundedText(2, 160),
});

export type ResearchBrief = z.infer<typeof researchBriefSchema>;
export type ResearchBriefDraft = z.infer<typeof researchBriefDraftSchema>;

/**
 * The browser keeps the complete brief for the active workflow, but the
 * server-side artifact must receive an explicit privacy projection. The
 * research consequences remain visible even when the person's answers stay
 * private, so a fresh share link can explain the work without leaking local
 * context by default.
 */
export function projectResearchBriefForArtifact(brief: ResearchBrief, shareContextInArtifact = false): ResearchBrief {
  const privateContext = "Personal context is kept private by the owner; inspect the local research brief for the answer-level details.";
  return researchBriefSchema.parse({
    ...brief,
    decisionContext: shareContextInArtifact ? brief.decisionContext : privateContext,
    stakeholderProfile: {
      ...brief.stakeholderProfile,
      summary: shareContextInArtifact ? brief.stakeholderProfile.summary : privateContext,
      hardConstraints: shareContextInArtifact ? brief.stakeholderProfile.hardConstraints : [],
      preferences: shareContextInArtifact ? brief.stakeholderProfile.preferences : [],
      localOnlyFacts: [],
    },
    dimensionAssignments: brief.dimensionAssignments.map((assignment) => ({
      ...assignment,
      selectedBranchId: shareContextInArtifact ? assignment.selectedBranchId : null,
      selectedValue: shareContextInArtifact ? assignment.selectedValue : null,
    })),
    contextualization: brief.contextualization.map((entry) => ({
      ...entry,
      selectedValues: shareContextInArtifact ? entry.selectedValues : [],
      typedAnswer: shareContextInArtifact ? entry.typedAnswer : "",
    })),
    privacy: {
      ...brief.privacy,
      shareContextInArtifact,
    },
  });
}

export type ResearchBriefCompilerInput = {
  caseId: string;
  originalQuestion: string;
  compiledQuestion: string;
  decisionContext: string;
  // axes removed
  clusters: DecompositionCluster[];
  knownUnknowns: string[];
  dimensionRoles: Record<string, DimensionRole>;
  prior: number;
};

const applicabilityPattern = /(population|people|person|who|where|setting|geograph|jurisdiction|demograph|age|sex|source|access|preference)/i;
const monitoredPattern = /(unknown|uncertain|predict|modifier|heterogen|boundary|mechanism|production|provenance|certif|feed|housing)/i;

export function defaultDimensionRole(cluster: Pick<DecompositionCluster, "id" | "label" | "latentVariable">): DimensionRole {
  const description = `${cluster.id} ${cluster.label} ${cluster.latentVariable}`;
  if (applicabilityPattern.test(description)) return "applicability-only";
  if (monitoredPattern.test(description)) return "monitored-unknown";
  return "decision-active";
}

export function completeDimensionRoles(clusters: DecompositionCluster[], saved: Record<string, DimensionRole> = {}) {
  return Object.fromEntries(clusters.map((cluster) => [
    cluster.id,
    dimensionRoleSchema.safeParse(saved[cluster.id]).success ? saved[cluster.id] : defaultDimensionRole(cluster),
  ])) as Record<string, DimensionRole>;
}

export function buildDimensionAssignments(input: Pick<ResearchBriefCompilerInput, "clusters" | "dimensionRoles">) {
  const roles = completeDimensionRoles(input.clusters, input.dimensionRoles);
  return input.clusters.map((cluster) => {
    const unique = (values: string[]) => Array.from(new Set(values));
    return dimensionAssignmentSchema.parse({
      axisId: cluster.id,
      label: cluster.label,
      selectedBranchId: null,
      selectedValue: null,
      role: roles[cluster.id],
      rationale: roleRationale(roles[cluster.id], cluster.label),
      searchConcepts: unique(cluster.ingestionRequirements.searchConcepts).slice(0, 12),
      requiredEvidenceFields: unique(cluster.ingestionRequirements.requiredFields).slice(0, 12),
      mismatchRisks: unique(cluster.ingestionRequirements.mismatchRisks).slice(0, 10),
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
  const contextualization = brief.contextualization ?? [];
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
      contextualization: contextualization
        .filter((entry) => claim.axisIds.includes(entry.axisId))
        .map((entry) => ({
          axisId: entry.axisId,
          label: entry.label,
          answer: [...entry.selectedValues, entry.typedAnswer].filter(Boolean).join("; ") || "No answer supplied",
          consequence: entry.researchConsequence,
        })),
    }));
}
