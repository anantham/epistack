import { deepDiveResultSchema, type DeepDiveResult } from "./deep-dive.ts";
import {
  adversarialReviewSchema,
  dualReviewPolicyId,
  reviewDecisionSchema,
  type AdversarialReview,
  type ReviewDecision,
} from "./dual-review.ts";

// A person may overturn an adversarial reviewer's reject. The overturn is an explicit
// human stamp: it is recorded as human-verified next to the reviewer's reject, it can
// only accept the exact proposal that was rejected, and the server still re-checks the
// quoted passage against an independently fetched copy of the full text.

export const humanOverturnReviewMode = "human-overturn";
export const humanOverturnRelationStatus = "accepted-human-verified-full-text";
export const humanVerifiedResultStatus = "human-verified-full-text";
export const humanOverturnAssessor = "human-overturned-reviewer-reject";
export const humanOverturnSnapshotOperation = "human-overturn-reviewer-reject";
export const overturnNoteLimit = 280;

/** The result a reject refers to, mirroring adjudicateDualReview: a revision stands only with a corrected result. */
export function rejectedProposal(
  primaryResults: readonly unknown[],
  review: Pick<AdversarialReview, "reviews">,
  resultIndex: number,
): DeepDiveResult | null {
  const item = review.reviews.find((candidate) => candidate.resultIndex === resultIndex);
  const proposed = item?.verdict === "revise" ? item.correctedResult ?? null : primaryResults[resultIndex];
  const parsed = proposed ? deepDiveResultSchema.safeParse(proposed) : null;
  return parsed?.success ? parsed.data : null;
}

export type HumanOverturn = {
  ok: true;
  resultIndex: number;
  note: string;
  result: DeepDiveResult;
  decision: ReviewDecision;
  decisions: ReviewDecision[];
  review: AdversarialReview;
  models: { primary: string; adversary: string };
};

export type HumanOverturnFailure = { ok: false; code: string; error: string };

const fail = (code: string, error: string): HumanOverturnFailure => ({ ok: false, code, error });

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function trimmed(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function checkHumanOverturn(input: {
  humanChecked: unknown;
  overturn: unknown;
  adversarialReview: unknown;
  artifact: unknown;
  model: unknown;
  /** The request's candidate results after schema parsing. */
  candidateResults: readonly unknown[];
}): HumanOverturn | HumanOverturnFailure {
  if (input.humanChecked !== true) {
    return fail("OVERTURN_NOT_CONFIRMED", "A person must confirm they read the passage and the reviewer's objection before overturning a reject.");
  }
  const overturn = asRecord(input.overturn);
  const resultIndex = overturn.resultIndex;
  if (typeof resultIndex !== "number" || !Number.isInteger(resultIndex) || resultIndex < 0 || resultIndex > 5) {
    return fail("OVERTURN_TARGET_INVALID", "Name the rejected result to overturn.");
  }
  const note = overturn.note === undefined ? "" : typeof overturn.note === "string" ? overturn.note.trim() : null;
  if (note === null || note.length > overturnNoteLimit) {
    return fail("OVERTURN_NOTE_INVALID", `The note must be text of at most ${overturnNoteLimit} characters.`);
  }

  const envelope = asRecord(input.adversarialReview);
  if (envelope.policyId !== dualReviewPolicyId) {
    return fail("OVERTURN_POLICY_MISMATCH", "Only a reject from the current dual-model full-text review can be overturned.");
  }
  const models = asRecord(envelope.models);
  const primary = trimmed(models.primary);
  const adversary = trimmed(models.adversary);
  if (!primary || !adversary || primary.toLowerCase() === adversary.toLowerCase() || trimmed(input.model) !== primary) {
    return fail("OVERTURN_MODELS_INVALID", "The review record must name two different models, with the extractor as the recorded model.");
  }
  const review = adversarialReviewSchema.safeParse(envelope.review);
  const decisions = reviewDecisionSchema.array().min(1).max(6).safeParse(envelope.decisions);
  if (!review.success || !decisions.success) {
    return fail("OVERTURN_REVIEW_INVALID", "The adversarial review record is incomplete.");
  }

  const artifact = asRecord(input.artifact);
  const artifactHash = trimmed(artifact.contentHash).toLowerCase();
  if (
    artifact.kind !== "pmc-jats"
    || !/^PMC\d{4,12}$/.test(trimmed(artifact.pmcid))
    || !/^[a-f0-9]{64}$/.test(artifactHash)
    || review.data.artifactHash.toLowerCase() !== artifactHash
  ) {
    return fail("OVERTURN_ARTIFACT_MISMATCH", "The reviewer must have read the same preserved full text that the result cites.");
  }

  const decision = decisions.data.find((candidate) => candidate.resultIndex === resultIndex);
  if (!decision) return fail("OVERTURN_TARGET_INVALID", "The review record has no decision for that result.");
  if (decision.finalDecision !== "reject") return fail("OVERTURN_TARGET_NOT_REJECTED", "Only a rejected result can be overturned.");
  if (!decision.passageFound) {
    return fail("OVERTURN_PASSAGE_NOT_FOUND", "The quoted passage was not found in the preserved full text, so this reject cannot be overturned.");
  }

  const result = rejectedProposal(Array.isArray(envelope.primaryResults) ? envelope.primaryResults : [], review.data, resultIndex);
  if (!result) return fail("OVERTURN_NO_PROPOSAL", "There is no concrete proposed result to accept for that reject.");
  if (input.candidateResults.length !== 1 || JSON.stringify(input.candidateResults[0]) !== JSON.stringify(result)) {
    return fail("OVERTURN_RESULT_MISMATCH", "The accepted result must be exactly the proposal the reviewer rejected.");
  }

  return {
    ok: true,
    resultIndex,
    note,
    result,
    decision,
    decisions: decisions.data,
    review: review.data,
    models: { primary, adversary },
  };
}
