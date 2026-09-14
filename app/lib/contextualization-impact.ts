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

function changedFieldsFor(effect: string) {
  if (effect === "prune") return ["claim scope", "retrieval and screening"];
  if (effect === "branch") return ["action alternatives", "separate evidence paths"];
  return ["applicability", "transportability checks"];
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
    return {
      axisId: entry.axisId,
      label: entry.label,
      effect: entry.effect,
      answer,
      consequence: entry.researchConsequence,
      changedFields: changedFieldsFor(entry.effect),
      claimLabels: Array.from(new Set(claimsByAxis.get(entry.axisId) ?? [])),
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
