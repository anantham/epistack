import { z } from "zod";

export const sourceClassSchema = z.enum([
  "primary-study",
  "systematic-review",
  "guideline",
  "standard",
  "trial-registry",
  "official-statistics",
  "preprint",
  "reporting",
  "anecdote",
]);

export type SourceClass = z.infer<typeof sourceClassSchema>;

export const sourceClassValues = sourceClassSchema.options;

export const sourceClassLabels: Record<SourceClass, string> = {
  "primary-study": "Primary study",
  "systematic-review": "Systematic review",
  guideline: "Guideline",
  standard: "Standard",
  "trial-registry": "Trial registry",
  "official-statistics": "Official statistics",
  preprint: "Preprint",
  reporting: "News / reporting",
  anecdote: "Anecdote / lived experience",
};

// Only first-hand research can become accepted evidence. Everything else is
// normative (guidance), status (registries), context (statistics/reporting) or a
// hypothesis (anecdotes) and must never be promoted as proof of an outcome.
export function canPromoteSourceClass(value: SourceClass) {
  return value === "primary-study" || value === "systematic-review";
}

// Map the legacy discovery `type` vocabulary onto the source classes so
// companion-era leads still classify sensibly.
export function sourceClassFromLegacyType(type: string): SourceClass {
  switch (type) {
    case "systematic-review": return "systematic-review";
    case "peer-reviewed-study": return "primary-study";
    case "preprint": return "preprint";
    case "official-guidance": return "guideline";
    case "government-record": return "official-statistics";
    case "dataset": return "official-statistics";
    case "professional-analysis": return "reporting";
    case "investigative-reporting": return "reporting";
    case "organization-page": return "reporting";
    case "first-person-report": return "anecdote";
    default: return "reporting";
  }
}

export const sourceClassPromptList = sourceClassValues
  .map((value) => `- ${value}: ${sourceClassLabels[value]}`)
  .join("\n");

// What kind of claim a source can bear. Separate from how far it has been
// verified (evidenceStatus) and from whether the artifact was actually acquired
// (acquisition). A source can be reviewed + normative without ever becoming
// accepted causal evidence.
export const epistemicRoleSchema = z.enum(["causal", "normative", "descriptive", "status", "context"]);
export type EpistemicRole = z.infer<typeof epistemicRoleSchema>;

export const evidenceStatusSchema = z.enum(["lead", "acquired", "extracted", "reviewed", "accepted", "rejected"]);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

export const acquisitionSchema = z.enum(["fetched-verified", "cited-unverified"]);
export type Acquisition = z.infer<typeof acquisitionSchema>;

export function epistemicRoleForSourceClass(value: SourceClass): EpistemicRole {
  switch (value) {
    case "primary-study":
    case "systematic-review":
    case "preprint":
      return "causal";
    case "guideline":
    case "standard":
      return "normative";
    case "official-statistics":
      return "descriptive";
    case "trial-registry":
      return "status";
    case "reporting":
    case "anecdote":
      return "context";
  }
}

// A source is "preliminary" (maturity qualifier) rather than a separate role.
export function isPreliminarySourceClass(value: SourceClass) {
  return value === "preprint";
}

// The single promotion rule. Only a first-hand causal result, from an acquired
// and hash-verified artifact, that passed adversarial review may be accepted.
export function canReachAcceptedEvidence(input: {
  role: EpistemicRole;
  acquisition: Acquisition;
  adversarialPassed: boolean;
  preliminary?: boolean;
}) {
  return input.role === "causal"
    && input.acquisition === "fetched-verified"
    && input.adversarialPassed
    && !input.preliminary;
}

// Full source text may only be handed to a study-result extractor for a causal
// role from a verified acquisition. Cited-only material is a lead/context signal.
export function canExtractAsStudyResult(input: { role: EpistemicRole; acquisition: Acquisition }) {
  return input.role === "causal" && input.acquisition === "fetched-verified";
}
