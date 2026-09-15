import type { ResearchBrief } from "./research-brief";

export type ContextualizationImpactEntry = {
  axisId: string;
  label: string;
  effect: string;
  answer: string;
  consequence: string;
  changedFields: string[];
  claimLabels: string[];
};

export type ContextualizationImpact = {
  totalQuestions: number;
  answeredQuestions: number;
  scopedClaimLabels: string[];
  constraints: string[];
  options: string[];
  unresolved: string[];
  entries: ContextualizationImpactEntry[];
};

function changedFieldsFor(
  effect: string,
  claims: Array<{ shortLabel: string; queryUsesAxisIds?: string[]; applicabilityUsesAxisIds?: string[] }>,
  axisId: string,
) {
  const fields = effect === "prune"
    ? ["claim scope", "retrieval and screening"]
    : effect === "branch"
      ? ["action alternatives", "separate evidence paths"]
      : ["applicability", "transportability checks"];
  for (const claim of claims) {
    if ((claim.queryUsesAxisIds ?? []).includes(axisId)) fields.push("search query · " + claim.shortLabel);
    if ((claim.applicabilityUsesAxisIds ?? []).includes(axisId)) fields.push("applicability fields · " + claim.shortLabel);
  }
  return Array.from(new Set(fields));
}

export function buildContextualizationImpact(brief: Pick<ResearchBrief, "claims" | "contextualization" | "stakeholderProfile" | "actionSpace" | "parkedDimensions" | "gapTriggers">): ContextualizationImpact {
  const claimsByAxis = new Map<string, string[]>();
  for (const claim of brief.claims) {
    for (const axisId of claim.axisIds) {
      const labels = claimsByAxis.get(axisId) ?? [];
      labels.push(claim.shortLabel);
      claimsByAxis.set(axisId, labels);
    }
  }

  const entries = brief.contextualization.map((entry) => {
    const answer = [...entry.selectedValues, entry.typedAnswer].filter(Boolean).join("; ") || "No answer supplied";
    const answered = answer !== "No answer supplied";
    const linkedClaims = brief.claims.filter((claim) => claim.axisIds.includes(entry.axisId));
    return {
      axisId: entry.axisId,
      label: entry.label,
      effect: entry.effect,
      answer,
      consequence: entry.researchConsequence,
      changedFields: answered ? changedFieldsFor(entry.effect, linkedClaims, entry.axisId) : [],
      claimLabels: answered ? Array.from(new Set(claimsByAxis.get(entry.axisId) ?? [])) : [],
    };
  });

  const scopedClaimLabels = Array.from(new Set(entries.flatMap((entry) => entry.claimLabels)));
  const constraints = Array.from(new Set(brief.stakeholderProfile.hardConstraints));
  const options = brief.actionSpace.options.map((option) => option.label);
  const unresolved = [
    ...brief.parkedDimensions.map((dimension) => `${dimension.axisId}: ${dimension.reason}`),
    ...brief.gapTriggers.map((gap) => `${gap.question} (${gap.expectedDecisionValue} decision value)`),
  ];

  return {
    totalQuestions: entries.length,
    answeredQuestions: entries.filter((entry) => entry.answer !== "No answer supplied").length,
    scopedClaimLabels,
    constraints,
    options,
    unresolved,
    entries,
  };
}
