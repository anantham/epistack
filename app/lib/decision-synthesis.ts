import { jsonSchema } from "ai";
import { z } from "zod";
import type { LiveArtifact } from "./live-artifact";
import type { ResearchBrief } from "./research-brief";

const boundedText = (minimum: number, maximum: number) => z.string().min(minimum).max(maximum);

export const decisionOutcomeReadSchema = z.object({
  outcome: boundedText(2, 180),
  direction: z.enum(["favors", "opposes", "mixed", "uncertain", "not-represented"]),
  claimFrameIds: z.array(boundedText(1, 160)).min(1).max(8),
  basisResultIds: z.array(boundedText(1, 160)).max(16),
  basisRelationIds: z.array(boundedText(1, 180)).max(24),
  interpretation: boundedText(8, 520),
  applicabilityCaveat: boundedText(4, 420),
}).superRefine((value, context) => {
  if (["favors", "opposes", "mixed"].includes(value.direction)) {
    if (value.basisResultIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["basisResultIds"],
        message: "Directional outcome reads require at least one accepted result ID.",
      });
    }
    if (value.basisRelationIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["basisRelationIds"],
        message: "Directional outcome reads require at least one accepted evidence-relation ID.",
      });
    }
  }
});

export const decisionOptionReadSchema = z.object({
  optionId: boundedText(1, 100),
  label: boundedText(2, 180),
  feasibility: z.enum(["available-now", "plausible", "currently-unavailable", "unknown"]),
  outcomeReads: z.array(decisionOutcomeReadSchema).min(1).max(10),
  tradeoffs: z.array(boundedText(4, 320)).max(8),
});

export const decisionSynthesisSchema = z.object({
  schemaVersion: z.literal("0.2.0"),
  recommendation: z.object({
    stance: z.enum(["act", "do-not-act", "conditional", "defer", "insufficient-evidence"]),
    optionId: boundedText(1, 100),
    headline: boundedText(8, 320),
    action: boundedText(12, 720),
  }),
  broadVsApplicable: boundedText(8, 620),
  options: z.array(decisionOptionReadSchema).min(2).max(8),
  loadBearingResultIds: z.array(boundedText(1, 160)).min(1).max(24),
  loadBearingFamilyIds: z.array(boundedText(1, 160)).min(1).max(16),
  cruxes: z.array(z.object({
    question: boundedText(8, 320),
    whyItMatters: boundedText(8, 420),
    wouldFlipDecisionIf: boundedText(8, 420),
    resolvability: z.enum(["searchable-now", "primary-data-needed", "personally-measurable", "not-readily-resolvable"]),
  })).min(1).max(6),
  stability: z.object({
    label: z.enum(["fragile", "conditional", "stable-within-represented-boundary"]),
    survives: z.array(boundedText(4, 320)).max(8),
    flipsUnder: z.array(boundedText(4, 320)).min(1).max(8),
  }),
  valuesAndConstraints: z.object({
    humanSupplied: z.array(boundedText(2, 260)).max(12),
    modelAssumptions: z.array(boundedText(2, 260)).max(12),
  }),
  missingEvidence: z.array(z.object({
    gap: boundedText(4, 320),
    whyDecisionRelevant: boundedText(8, 420),
    nextAction: boundedText(4, 320),
  })).max(10),
  observationProtocol: z.object({
    title: boundedText(4, 180),
    purpose: boundedText(8, 420),
    duration: boundedText(2, 120),
    measurements: z.array(boundedText(2, 240)).min(1).max(12),
    stoppingConditions: z.array(boundedText(2, 240)).max(8),
    cannotEstablish: z.array(boundedText(2, 280)).min(1).max(8),
  }),
});

export type DecisionSynthesis = z.infer<typeof decisionSynthesisSchema>;

const unsupportedProviderKeywords = new Set([
  "minLength", "maxLength", "pattern", "format",
  "minimum", "maximum", "multipleOf",
  "patternProperties", "unevaluatedProperties", "propertyNames", "minProperties", "maxProperties",
  "unevaluatedItems", "contains", "minContains", "maxContains", "minItems", "maxItems", "uniqueItems",
]);

function removeUnsupportedProviderConstraints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeUnsupportedProviderConstraints);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !unsupportedProviderKeywords.has(key))
      .map(([key, child]) => [key, removeUnsupportedProviderConstraints(child)]),
  );
}

const decisionProviderJsonSchema = removeUnsupportedProviderConstraints(
  z.toJSONSchema(decisionSynthesisSchema),
) as unknown as Parameters<typeof jsonSchema>[0];

export const decisionSynthesisOutputSchema = jsonSchema<DecisionSynthesis>(decisionProviderJsonSchema);

export const decisionSynthesisInstructions = `You are the DECISION SYNTHESIZER in an epistemic investigation system.

Produce a conditional action policy for one concrete stakeholder from an ACCEPTED result-level evidence graph. You do not search the web. Never invent evidence, source quality, effect estimates, or personal values. Cite empirical claims with exact result IDs, claim-frame IDs, and evidence-relation IDs present in the supplied graph.

Keep four layers separate:
1. what accepted results report;
2. whether those results apply to this stakeholder;
3. the stakeholder's supplied values, constraints, and feasible options;
4. the resulting reversible decision.

An accepted result is not automatically true, and several results from one dependence family are not independent votes. Prefer passage-backed, directly applicable results. Treat absent evidence as absent rather than reassuring. It is valid to recommend deferring or say evidence is insufficient.

Do not emit a probability, confidence percentage, evidence score, or universal health verdict. Decision stability is sensitivity: state what changes would flip the action. A personal observation protocol may measure usability or individual response, but must explicitly name what it cannot establish.`;

export function decisionSynthesisPrompt(input: {
  question: string;
  evidenceVersion: string;
  researchBrief: unknown;
  acceptedGraph: unknown;
}) {
  return `Create the structured decision synthesis.

ORIGINAL DECISION:
${input.question}

EVIDENCE VERSION:
${input.evidenceVersion}

HUMAN-COMPILED RESEARCH BRIEF:
${JSON.stringify(input.researchBrief, null, 2)}

ACCEPTED RESULT GRAPH:
${JSON.stringify(input.acceptedGraph, null, 2)}

Requirements:
- assess every feasible option in the brief;
- set recommendation.optionId to the exact supplied option ID the action recommends (or the status-quo/defer option when the stance is defer or insufficient-evidence);
- list the result IDs and dependence-family IDs that actually carry the recommendation;
- distinguish the broad evidence picture from evidence directly applicable to this stakeholder;
- put any inferred preference or value in modelAssumptions, never humanSupplied;
- copy every option label and feasibility value exactly from the supplied action space;
- every outcome read must name the claim frames it addresses;
- every cited result must have an accompanying evidence-relation ID that connects that exact result to one of those claim frames;
- every favors, opposes, or mixed outcome read must cite at least one accepted result and relation;
- include at least one concrete decision-flip condition;
- make missing evidence operational by naming the next collection action.`;
}

export function validateDecisionReferences(
  synthesis: DecisionSynthesis,
  allowedResultIds: Iterable<string>,
  allowedFamilyIds: Iterable<string>,
  resultFamilyById: ReadonlyMap<string, string> | Record<string, string>,
  allowedClaimFrameIds: Iterable<string>,
  relationById: ReadonlyMap<string, { resultId: string; claimFrameId: string; relation: string }>
    | Record<string, { resultId: string; claimFrameId: string; relation: string }>,
) {
  const results = new Set(allowedResultIds);
  const families = new Set(allowedFamilyIds);
  const claims = new Set(allowedClaimFrameIds);
  const lookup = <V>(source: ReadonlyMap<string, V> | Record<string, V>) =>
    source instanceof Map
      ? (id: string) => source.get(id)
      : (id: string) => (source as Record<string, V>)[id];
  const familyFor = lookup(resultFamilyById);
  const relationFor = lookup(relationById);
  const outcomeReads = synthesis.options.flatMap((option) => option.outcomeReads);
  const referencedResults = new Set([
    ...synthesis.loadBearingResultIds,
    ...outcomeReads.flatMap((outcome) => outcome.basisResultIds),
  ]);
  const referencedRelations = new Set(outcomeReads.flatMap((outcome) => outcome.basisRelationIds));
  const referencedClaims = new Set(outcomeReads.flatMap((outcome) => outcome.claimFrameIds));
  const unknownResultIds = [...referencedResults].filter((id) => !results.has(id));
  const unknownFamilyIds = synthesis.loadBearingFamilyIds.filter((id) => !families.has(id));
  const unknownRelationIds = [...referencedRelations].filter((id) => !relationFor(id));
  const unknownClaimFrameIds = [...referencedClaims].filter((id) => !claims.has(id));
  const mismatchedResultRelationIds: string[] = [];
  const mismatchedClaimRelationIds: string[] = [];
  const ungroundedBasisResultIds: string[] = [];
  for (const outcome of outcomeReads) {
    const citedResults = new Set(outcome.basisResultIds);
    const citedClaims = new Set(outcome.claimFrameIds);
    const citedRelations = outcome.basisRelationIds
      .map((relationId) => ({ relationId, relation: relationFor(relationId) }))
      .filter((entry): entry is {
        relationId: string;
        relation: { resultId: string; claimFrameId: string; relation: string };
      } => Boolean(entry.relation));
    for (const { relationId, relation } of citedRelations) {
      if (!citedResults.has(relation.resultId)) mismatchedResultRelationIds.push(relationId);
      if (!citedClaims.has(relation.claimFrameId)) mismatchedClaimRelationIds.push(relationId);
    }
    for (const resultId of citedResults) {
      if (!citedRelations.some(({ relation }) => relation.resultId === resultId)) {
        ungroundedBasisResultIds.push(resultId);
      }
    }
  }
  const expectedLoadBearingFamilies = new Set(
    synthesis.loadBearingResultIds
      .map((resultId) => familyFor(resultId))
      .filter((familyId): familyId is string => Boolean(familyId)),
  );
  const missingLoadBearingFamilyIds = [...expectedLoadBearingFamilies]
    .filter((familyId) => !synthesis.loadBearingFamilyIds.includes(familyId));
  const unbackedLoadBearingFamilyIds = synthesis.loadBearingFamilyIds
    .filter((familyId) => !expectedLoadBearingFamilies.has(familyId));
  return {
    valid: unknownResultIds.length === 0
      && unknownFamilyIds.length === 0
      && unknownRelationIds.length === 0
      && unknownClaimFrameIds.length === 0
      && mismatchedResultRelationIds.length === 0
      && mismatchedClaimRelationIds.length === 0
      && ungroundedBasisResultIds.length === 0
      && missingLoadBearingFamilyIds.length === 0
      && unbackedLoadBearingFamilyIds.length === 0,
    unknownResultIds,
    unknownFamilyIds,
    unknownRelationIds,
    unknownClaimFrameIds,
    mismatchedResultRelationIds: Array.from(new Set(mismatchedResultRelationIds)),
    mismatchedClaimRelationIds: Array.from(new Set(mismatchedClaimRelationIds)),
    ungroundedBasisResultIds: Array.from(new Set(ungroundedBasisResultIds)),
    missingLoadBearingFamilyIds,
    unbackedLoadBearingFamilyIds,
  };
}

export function canonicalHumanSuppliedValues(brief: ResearchBrief) {
  return Array.from(new Set([
    ...brief.stakeholderProfile.objectives,
    ...brief.stakeholderProfile.hardConstraints,
    ...brief.stakeholderProfile.preferences,
    `Current action: ${brief.actionSpace.currentAction}`,
    `Decision horizon: ${brief.actionSpace.decisionHorizon}`,
  ])).slice(0, 12);
}

export function validateDecisionOptionCoverage(
  synthesis: DecisionSynthesis,
  brief: ResearchBrief,
) {
  const allowedOptions = new Map(brief.actionSpace.options.map((option) => [option.id, option]));
  const allowed = new Set(allowedOptions.keys());
  const returned = new Set(synthesis.options.map((option) => option.optionId));
  const duplicateOptionIds = synthesis.options
    .map((option) => option.optionId)
    .filter((id, index, all) => all.indexOf(id) !== index);
  const mismatchedOptionLabels = synthesis.options
    .filter((option) => {
      const expected = allowedOptions.get(option.optionId);
      return expected && option.label !== expected.label;
    })
    .map((option) => option.optionId);
  const mismatchedOptionFeasibilities = synthesis.options
    .filter((option) => {
      const expected = allowedOptions.get(option.optionId);
      return expected && option.feasibility !== expected.feasibility;
    })
    .map((option) => option.optionId);
  const unknownRecommendationOptionId = allowed.has(synthesis.recommendation.optionId)
    ? null
    : synthesis.recommendation.optionId;
  return {
    valid: synthesis.options.every((option) => allowed.has(option.optionId))
      && brief.actionSpace.options.every((option) => returned.has(option.id))
      && duplicateOptionIds.length === 0
      && mismatchedOptionLabels.length === 0
      && mismatchedOptionFeasibilities.length === 0
      && unknownRecommendationOptionId === null,
    unknownOptionIds: synthesis.options
      .map((option) => option.optionId)
      .filter((id) => !allowed.has(id)),
    missingOptionIds: brief.actionSpace.options
      .map((option) => option.id)
      .filter((id) => !returned.has(id)),
    duplicateOptionIds: Array.from(new Set(duplicateOptionIds)),
    mismatchedOptionLabels,
    mismatchedOptionFeasibilities,
    unknownRecommendationOptionId,
  };
}

export function privacyMinimizedDecisionBrief(brief: ResearchBrief) {
  return {
    schemaVersion: brief.schemaVersion,
    briefId: brief.briefId,
    caseId: brief.caseId,
    compiledQuestion: brief.compiledQuestion,
    stakeholderProfile: {
      objectives: brief.stakeholderProfile.objectives,
      hardConstraints: brief.stakeholderProfile.hardConstraints,
      preferences: brief.stakeholderProfile.preferences,
    },
    actionSpace: brief.actionSpace,
    claims: brief.claims.map((claim) => ({
      id: claim.id,
      shortLabel: claim.shortLabel,
      statement: claim.statement,
      kind: claim.kind,
      population: claim.population,
      exposure: claim.exposure,
      comparator: claim.comparator,
      outcome: claim.outcome,
      timeHorizon: claim.timeHorizon,
      modality: claim.modality,
      decisionLeverage: claim.decisionLeverage,
      applicabilityFields: claim.applicabilityFields,
    })),
    gapTriggers: brief.gapTriggers,
    privacy: {
      outboundQueryPolicy: brief.privacy.outboundQueryPolicy,
      enforcedOmissions: [
        "originalQuestion",
        "decisionContext",
        "stakeholderProfile.summary",
        "stakeholderProfile.localOnlyFacts",
        "dimensionAssignments.selectedValue",
      ],
    },
  };
}

export function isDecisionEligibleEvidence(
  result: { verificationStatus: string },
  relation?: { status: string },
) {
  const verification = result.verificationStatus.toLowerCase();
  const relationStatus = relation?.status.toLowerCase() ?? "";
  return /full[- ]?text/.test(verification)
    && !/(abstract|pending|unverified)/.test(verification)
    && !/pending[- ]?full[- ]?text/.test(relationStatus);
}

function privacyMinimizedApplicability(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const count = (field: string) => Array.isArray(record[field]) ? record[field].length : 0;
  return {
    distance: typeof record.distance === "string" ? record.distance : "indeterminate",
    matchedFieldCount: count("matched"),
    mismatchedFieldCount: count("mismatched"),
    unknownFieldCount: count("unknown"),
    constraintRelaxationCount: count("constraintRelaxations"),
  };
}

export function decisionGraphProjection(artifact: LiveArtifact) {
  const resultById = new Map(artifact.graph.results.map((result) => [result.id, result]));
  const eligibleRelations = artifact.graph.evidenceRelations.filter((relation) => {
    const result = resultById.get(relation.resultId);
    return result ? isDecisionEligibleEvidence(result, relation) : false;
  });
  const eligibleResultIds = new Set(eligibleRelations.map((relation) => relation.resultId));
  const eligibleResults = artifact.graph.results.filter((result) => eligibleResultIds.has(result.id));
  const eligibleAnalysisIds = new Set(eligibleResults.map((result) => result.analysisId));
  const eligibleAnalyses = artifact.graph.analyses.filter((analysis) => eligibleAnalysisIds.has(analysis.id));
  const eligibleStudyIds = new Set(eligibleAnalyses.map((analysis) => analysis.studyId));
  const eligibleStudies = artifact.graph.studies.filter((study) => eligibleStudyIds.has(study.id));
  const eligibleSourceIds = new Set(eligibleStudies.map((study) => study.sourceId));
  const eligibleFamilyIds = new Set(eligibleResults.map((result) => result.dependenceGroupId));
  return {
    contractVersion: artifact.contractVersion,
    caseId: artifact.caseId,
    evidenceVersion: artifact.latestEvidenceSnapshot?.id ?? artifact.latestEvidenceAt ?? "unversioned-accepted-graph",
    integrityWarnings: artifact.integrityWarnings,
    missingClaims: artifact.missingClaims,
    eligibility: {
      policy: "full-text-cross-checked-only",
      excludedAcceptedResultIds: artifact.graph.results
        .filter((result) => !eligibleResultIds.has(result.id))
        .map((result) => result.id),
    },
    claims: artifact.graph.claimFrames.map((claim) => ({
      id: claim.id,
      statement: claim.statement,
      population: claim.population,
      exposure: claim.exposure,
      comparator: claim.comparator,
      outcome: claim.outcome,
      timeHorizon: claim.timeHorizon,
      modality: claim.modality,
    })),
    sources: artifact.graph.sources.filter((source) => eligibleSourceIds.has(source.id)).map((source) => ({
      id: source.id,
      title: source.title,
      canonicalUrl: source.canonicalUrl,
      doi: source.doi,
      pmid: source.pmid,
      publisher: source.publisher,
      issuedAt: source.issuedAt,
      sourceType: source.sourceType,
      contentHash: source.contentHash,
    })),
    studies: eligibleStudies.map((study) => ({
      id: study.id,
      sourceId: study.sourceId,
      registrationId: study.registrationId,
      design: study.design,
      details: study.details,
    })),
    analyses: eligibleAnalyses.map((analysis) => ({
      id: analysis.id,
      studyId: analysis.studyId,
      label: analysis.label,
      analysisType: analysis.analysisType,
      population: analysis.population,
      exposure: analysis.exposure,
      comparator: analysis.comparator,
      outcome: analysis.outcome,
      timeHorizon: analysis.timeHorizon,
      estimand: analysis.estimand,
      multiplicity: analysis.multiplicity,
    })),
    results: eligibleResults.map((result) => ({
      id: result.id,
      analysisId: result.analysisId,
      dependenceGroupId: result.dependenceGroupId,
      resultRole: result.resultRole,
      resultText: result.resultText,
      estimate: result.estimate,
      locator: result.locator,
      excerpt: result.excerpt?.slice(0, 800) ?? null,
      verificationStatus: result.verificationStatus,
      applicability: privacyMinimizedApplicability(result.details.applicability),
    })),
    relations: eligibleRelations.map((relation) => ({
      id: relation.id,
      resultId: relation.resultId,
      claimFrameId: relation.claimFrameId,
      relation: relation.relation,
      scopeMatch: relation.scopeMatch,
      rationale: relation.rationale,
      assessor: relation.assessor,
      status: relation.status,
    })),
    dependenceFamilies: artifact.graph.dependenceGroups.filter((family) => eligibleFamilyIds.has(family.id)).map((family) => ({
      id: family.id,
      label: family.label,
      reason: family.reason,
      dependsOn: family.dependsOn,
    })),
  };
}
