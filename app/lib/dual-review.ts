import { z } from "zod";
import { deepDiveResultSchema, deepDiveSchema, type DeepDiveCandidate, type DeepDiveResult, type DeepDiveSource } from "./deep-dive.ts";
import type { PmcArtifactKind } from "./pmc-full-text.ts";

export const dualReviewPolicyId = "dual-model-pmc-full-text-v2" as const;

export const fullPaperExtractionSchema = deepDiveSchema.extend({
  sourceInspection: z.object({
    artifactHash: z.string().min(32).max(128),
    fullTextRead: z.boolean(),
    methodsRead: z.boolean(),
    resultsRead: z.boolean(),
    tablesRead: z.boolean(),
    supplementaryMaterialChecked: z.boolean(),
    inspectionNote: z.string().min(8).max(420),
  }),
});

export const adversarialReviewSchema = z.object({
  artifactHash: z.string().min(32).max(128),
  independentlyReadFullText: z.boolean(),
  methodsAndResultsRead: z.boolean(),
  overallAssessment: z.string().min(8).max(520),
  reviews: z.array(z.object({
    resultIndex: z.number().int().min(0).max(5),
    verdict: z.enum(["accept", "revise", "reject"]),
    quoteVerified: z.boolean(),
    locatorVerified: z.boolean(),
    scopeVerified: z.boolean(),
    relationVerified: z.boolean(),
    rationale: z.string().min(8).max(520),
    correctedResult: deepDiveResultSchema.nullable().optional(),
  })).min(1).max(6),
});

export type FullPaperExtraction = z.infer<typeof fullPaperExtractionSchema>;
export type AdversarialReview = z.infer<typeof adversarialReviewSchema>;

export type SourceArtifact = {
  kind: PmcArtifactKind;
  pmcid: string;
  canonicalUrl: string;
  retrievedFrom?: string;
  localXmlPath: string;
  localTextPath: string;
  contentHash: string;
  retrievedAt: string;
};

export const reviewDecisionSchema = z.object({
  resultIndex: z.number().int().min(0).max(5),
  analysisLabel: z.string().min(3).max(160),
  reviewerVerdict: z.enum(["accept", "revise", "reject"]),
  finalDecision: z.enum(["promote", "reject"]),
  passageFound: z.boolean(),
  rationale: z.string().min(8).max(520),
  promotedResult: deepDiveResultSchema.nullable(),
});

export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export type DualReviewOutcome = {
  policyId: typeof dualReviewPolicyId;
  eligible: boolean;
  acceptedCount: number;
  rejectedCount: number;
  reasons: string[];
  candidate: DeepDiveCandidate;
  decisions: ReviewDecision[];
};

export type DualReviewResponse = {
  source: DeepDiveSource;
  artifact: SourceArtifact;
  primaryCandidate: FullPaperExtraction;
  candidate: DeepDiveCandidate;
  review: AdversarialReview;
  decisions: ReviewDecision[];
  promotion: Omit<DualReviewOutcome, "candidate" | "decisions">;
  models: { primary: string; adversary: string };
  verificationStatus: "ai-cross-checked-full-text";
  cache: { status: "hit" | "miss" | "bypass"; key: string; createdAt: string };
};

const populationQualifierPatterns: Array<[string, RegExp]> = [
  ["male", /\bmale\b/i],
  ["female", /\bfemale\b/i],
  ["smoker", /\bsmok(?:er|ers|ing)\b/i],
  ["diabetes", /\bdiabet(?:es|ic)\b/i],
  ["pregnancy", /\bpregnan(?:cy|t)\b/i],
  ["children", /\bchild(?:ren)?\b/i],
  ["adolescent", /\badolescent(?:s)?\b/i],
  ["older adult", /\b(?:older adult|elderly|aged)\b/i],
  ["overweight", /\boverweight\b/i],
  ["obesity", /\bobes(?:e|ity)\b/i],
  ["athlete", /\bathlet(?:e|es|ic)\b/i],
  ["resistance-trained", /\bresistance[- ]trained\b/i],
];

/**
 * Return population qualifiers that appear in the study but are not
 * represented by the claim. Word boundaries matter here: "female" must not
 * match "male", and "nonsmokers" must not match "smoker".
 */
export function populationMismatchSignals(claimPopulation: string, studyPopulation: string) {
  const claim = claimPopulation.toLocaleLowerCase("en");
  const study = studyPopulation.toLocaleLowerCase("en");
  const nonSmoking = /\bnon[- ]?smok(?:er|ers|ing)\b/i;
  return populationQualifierPatterns
    .filter(([, pattern]) => pattern.test(study))
    .filter(([qualifier]) => {
      if (qualifier === "smoker" && nonSmoking.test(study)) return false;
      return !populationQualifierPatterns.find(([candidate]) => candidate === qualifier)?.[1].test(claim);
    })
    .map(([qualifier]) => qualifier);
}

/**
 * Apply the same deterministic applicability gate at every persistence
 * boundary. The browser may request promotion, but it cannot turn a partial,
 * unknown, or differently scoped model result into accepted evidence.
 */
export function automaticScopeGateReasons(input: {
  result: DeepDiveResult;
  studyPopulation: string;
  claimFrames: Array<{ id: string; population: string }>;
}) {
  const claim = input.claimFrames.find((frame) => frame.id === input.result.claimFrameId);
  const hasClaimContract = input.claimFrames.length > 0;
  const reasons: string[] = [];
  if (!claim && hasClaimContract) reasons.push(`The result references unknown claim frame ${input.result.claimFrameId}.`);
  if (input.result.scopeMatch !== "direct") reasons.push(`The result scope is ${input.result.scopeMatch}, not direct.`);
  if (input.result.applicability.distance !== "exact") reasons.push(`Applicability distance is ${input.result.applicability.distance}, not exact.`);
  if (input.result.applicability.mismatched.length > 0) reasons.push(`Applicability mismatches remain: ${input.result.applicability.mismatched.join(", ")}.`);
  if (input.result.applicability.unknown.length > 0) reasons.push(`Applicability is unknown for: ${input.result.applicability.unknown.join(", ")}.`);
  if (claim) {
    const populationMismatch = populationMismatchSignals(claim.population, input.studyPopulation);
    if (populationMismatch.length > 0) reasons.push(`The study population adds unrepresented scope qualifiers: ${populationMismatch.join(", ")}.`);
  }
  return reasons;
}

function normalizePassage(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");
}

function normalizePassageBoundary(value: string) {
  return normalizePassage(value).replace(/[.,;:!?]+$/g, "").trim();
}

/**
 * Models sometimes wrap an otherwise literal excerpt in an ellipsis to signal
 * that it was shortened. That wrapper is not part of the source passage, so
 * remove only boundary ellipses before the strict substring check. Internal
 * ellipses and every other character remain untouched.
 */
export function canonicalizeExactExcerpt(value: string) {
  return value
    .trim()
    .replace(/^(?:\.\.\.|…)[\s]*/u, "")
    .replace(/[\s]*(?:\.\.\.|…)$/u, "")
    .trim();
}

export function passageExists(fullText: string, excerpt: string) {
  const normalizedExcerpt = normalizePassage(excerpt);
  if (normalizedExcerpt.length < 12) return false;
  if (normalizePassage(fullText).includes(normalizedExcerpt)) return true;

  // Models sometimes add a sentence-ending period when the preserved article
  // ends the same sentence with a comma, semicolon, or no punctuation. Allow
  // only that terminal punctuation normalization; words and their order must
  // still be a contiguous substring of the preserved artifact.
  const boundaryExcerpt = normalizePassageBoundary(excerpt);
  return boundaryExcerpt.length >= 12 && normalizePassageBoundary(fullText).includes(boundaryExcerpt);
}

export function adjudicateDualReview(input: {
  primary: unknown;
  review: unknown;
  fullText: string;
  artifact: SourceArtifact;
  primaryModel: string;
  adversaryModel: string;
  claimFrames?: Array<{ id: string; population: string }>;
}): DualReviewOutcome {
  const primary = fullPaperExtractionSchema.parse(input.primary);
  const review = adversarialReviewSchema.parse(input.review);
  const reasons: string[] = [];
  const modelsDiffer = input.primaryModel.trim().toLowerCase() !== input.adversaryModel.trim().toLowerCase();
  const commonGate = modelsDiffer
    && primary.sourceInspection.artifactHash === input.artifact.contentHash
    && review.artifactHash === input.artifact.contentHash
    && primary.sourceInspection.fullTextRead
    && primary.sourceInspection.methodsRead
    && primary.sourceInspection.resultsRead
    && review.independentlyReadFullText
    && review.methodsAndResultsRead;

  if (!modelsDiffer) reasons.push("Primary and adversarial agents must use different models.");
  if (primary.sourceInspection.artifactHash !== input.artifact.contentHash) reasons.push("Primary agent did not attest to the acquired artifact hash.");
  if (review.artifactHash !== input.artifact.contentHash) reasons.push("Adversarial agent did not attest to the acquired artifact hash.");
  if (!primary.sourceInspection.fullTextRead || !primary.sourceInspection.methodsRead || !primary.sourceInspection.resultsRead) reasons.push("Primary agent did not inspect the full methods and results.");
  if (!review.independentlyReadFullText || !review.methodsAndResultsRead) reasons.push("Adversarial agent did not independently inspect the full methods and results.");

  const reviewsByIndex = new Map<number, AdversarialReview["reviews"][number]>();
  for (const item of review.reviews) {
    if (!reviewsByIndex.has(item.resultIndex)) reviewsByIndex.set(item.resultIndex, item);
  }

  const promoted: DeepDiveResult[] = [];
  const decisions: ReviewDecision[] = primary.results.map((original, resultIndex) => {
    const item = reviewsByIndex.get(resultIndex);
    const proposed = item?.verdict === "revise" ? item.correctedResult ?? null : original;
    const parsedProposed = proposed ? deepDiveResultSchema.safeParse(proposed) : null;
    const promotedResult = parsedProposed?.success
      ? { ...parsedProposed.data, exactExcerpt: canonicalizeExactExcerpt(parsedProposed.data.exactExcerpt) }
      : null;
    const passageFound = promotedResult ? passageExists(input.fullText, promotedResult.exactExcerpt) : false;
    const scopeReasons = promotedResult
      ? automaticScopeGateReasons({ result: promotedResult, studyPopulation: primary.study.population, claimFrames: input.claimFrames ?? [] })
      : ["No schema-valid result was proposed."];
    const scopeGatePasses = scopeReasons.length === 0;
    const checksPass = Boolean(item
      && item.verdict !== "reject"
      && promotedResult
      && item.quoteVerified
      && item.locatorVerified
      && item.scopeVerified
      && item.relationVerified
      && passageFound
      && scopeGatePasses);
    const finalDecision = commonGate && checksPass ? "promote" as const : "reject" as const;
    if (finalDecision === "promote" && promotedResult) promoted.push(promotedResult);
    return {
      resultIndex,
      analysisLabel: original.analysisLabel,
      reviewerVerdict: item?.verdict ?? "reject",
      finalDecision,
      passageFound,
      rationale: scopeReasons.length > 0
        ? `${scopeReasons.join(" ")} It remains outside automatic promotion until the claim is narrowed or a better-matched source is reviewed.`
        : !passageFound
          ? `The exact excerpt was not found as a contiguous substring of the preserved full-text artifact. ${item?.rationale ?? "The adversarial agent returned no review for this result."}`
        : item?.rationale ?? "The adversarial agent returned no review for this result.",
      promotedResult: finalDecision === "promote" ? promotedResult : null,
    };
  });

  if (review.reviews.length !== primary.results.length || reviewsByIndex.size !== primary.results.length) {
    reasons.push("The adversarial review did not cover every proposed result exactly once.");
  }
  if (!promoted.length) reasons.push("No result survived every automatic promotion check.");

  const completeCoverage = review.reviews.length === primary.results.length && reviewsByIndex.size === primary.results.length;
  const eligible = commonGate && completeCoverage && promoted.length > 0;
  return {
    policyId: dualReviewPolicyId,
    eligible,
    acceptedCount: promoted.length,
    rejectedCount: primary.results.length - promoted.length,
    reasons,
    candidate: { ...deepDiveSchema.parse(primary), results: promoted },
    decisions,
  };
}
