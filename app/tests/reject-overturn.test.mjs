import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deepDiveResultSchema } from "../lib/deep-dive.ts";
import { dualReviewPolicyId } from "../lib/dual-review.ts";
import {
  checkHumanOverturn,
  humanOverturnRelationStatus,
  overturnNoteLimit,
  rejectedProposal,
} from "../lib/reject-overturn.ts";

const hash = "a".repeat(64);

const result = (overrides = {}) => ({
  analysisLabel: "Primary LDL analysis",
  analysisType: "between-group difference",
  outcome: "LDL cholesterol",
  timeHorizon: "12 weeks",
  resultRole: "primary",
  resultText: "LDL cholesterol did not differ between the egg and control groups.",
  estimate: "",
  exactExcerpt: "LDL cholesterol did not differ between groups.",
  locator: "Results, paragraph 2",
  claimFrameId: "eggs-and-ldl",
  relation: "supports",
  scopeMatch: "direct",
  applicability: {
    matched: ["healthy adults"],
    mismatched: [],
    unknown: [],
    constraintRelaxations: [],
    distance: "near",
    rationale: "A healthy adult sample close to the decision maker.",
  },
  rationale: "A direct randomized comparison of LDL cholesterol.",
  ...overrides,
});

const survivor = result({ analysisLabel: "Secondary HDL analysis", outcome: "HDL cholesterol", exactExcerpt: "HDL cholesterol rose modestly in the egg group." });

const reviewFor = (verdict, correctedResult) => ({
  artifactHash: hash,
  independentlyReadFullText: true,
  methodsAndResultsRead: true,
  overallAssessment: "One result is scoped too broadly for the claim.",
  reviews: [
    {
      resultIndex: 0,
      verdict,
      quoteVerified: true,
      locatorVerified: true,
      scopeVerified: false,
      relationVerified: false,
      rationale: "The trial enrolled people with overweight, not healthy adults.",
      ...(correctedResult === undefined ? {} : { correctedResult }),
    },
    { resultIndex: 1, verdict: "accept", quoteVerified: true, locatorVerified: true, scopeVerified: true, relationVerified: true, rationale: "Faithful to the results table." },
  ],
});

const envelope = (overrides = {}) => ({
  policyId: dualReviewPolicyId,
  models: { primary: "anthropic/claude-opus-4.8", adversary: "openai/gpt-5.4" },
  review: reviewFor("reject"),
  decisions: [
    { resultIndex: 0, analysisLabel: "Primary LDL analysis", reviewerVerdict: "reject", finalDecision: "reject", passageFound: true, rationale: "The trial enrolled people with overweight, not healthy adults.", promotedResult: null },
    { resultIndex: 1, analysisLabel: "Secondary HDL analysis", reviewerVerdict: "accept", finalDecision: "promote", passageFound: true, rationale: "Faithful to the results table.", promotedResult: survivor },
  ],
  primaryResults: [result(), survivor],
  ...overrides,
});

const request = (overrides = {}) => ({
  humanChecked: true,
  overturn: { resultIndex: 0, note: "  The population table shows most participants were healthy.  " },
  adversarialReview: envelope(),
  artifact: { kind: "pmc-jats", pmcid: "PMC1234567", contentHash: hash },
  model: "anthropic/claude-opus-4.8",
  candidateResults: [deepDiveResultSchema.parse(result())],
  ...overrides,
});

test("a person can overturn a reject only for the exact rejected proposal", () => {
  const overturn = checkHumanOverturn(request());
  assert.equal(overturn.ok, true);
  assert.equal(overturn.resultIndex, 0);
  assert.equal(overturn.note, "The population table shows most participants were healthy.");
  assert.equal(overturn.result.resultText, result().resultText);
  assert.equal(overturn.decision.reviewerVerdict, "reject");
  assert.deepEqual(overturn.models, { primary: "anthropic/claude-opus-4.8", adversary: "openai/gpt-5.4" });
});

test("an overturn is refused when its guards fail", () => {
  const code = (overrides) => {
    const outcome = checkHumanOverturn(request(overrides));
    assert.equal(outcome.ok, false);
    return outcome.code;
  };
  assert.equal(code({ humanChecked: false }), "OVERTURN_NOT_CONFIRMED");
  assert.equal(code({ overturn: { resultIndex: 7 } }), "OVERTURN_TARGET_INVALID");
  assert.equal(code({ overturn: { resultIndex: 0, note: "x".repeat(overturnNoteLimit + 1) } }), "OVERTURN_NOTE_INVALID");
  assert.equal(code({ adversarialReview: envelope({ policyId: "dual-model-pmc-full-text-v1" }) }), "OVERTURN_POLICY_MISMATCH");
  assert.equal(code({ adversarialReview: envelope({ models: { primary: "openai/gpt-5.4", adversary: "openai/gpt-5.4" } }), model: "openai/gpt-5.4" }), "OVERTURN_MODELS_INVALID");
  assert.equal(code({ model: "someone/else" }), "OVERTURN_MODELS_INVALID");
  assert.equal(code({ artifact: { kind: "pmc-jats", pmcid: "PMC1234567", contentHash: "b".repeat(64) } }), "OVERTURN_ARTIFACT_MISMATCH");
  assert.equal(code({ overturn: { resultIndex: 1 }, candidateResults: [deepDiveResultSchema.parse(survivor)] }), "OVERTURN_TARGET_NOT_REJECTED");
  const unfound = envelope();
  unfound.decisions[0] = { ...unfound.decisions[0], passageFound: false };
  assert.equal(code({ adversarialReview: unfound }), "OVERTURN_PASSAGE_NOT_FOUND");
  assert.equal(
    code({ candidateResults: [deepDiveResultSchema.parse(result({ relation: "contradicts" }))] }),
    "OVERTURN_RESULT_MISMATCH",
  );
  assert.equal(code({ candidateResults: [] }), "OVERTURN_RESULT_MISMATCH");
});

test("the rejected proposal follows the reviewer's revision the same way adjudication does", () => {
  const corrected = result({ scopeMatch: "partial", resultText: "LDL cholesterol did not differ in adults with overweight." });
  assert.equal(rejectedProposal([result()], reviewFor("reject"), 0).resultText, result().resultText);
  assert.equal(rejectedProposal([result()], reviewFor("revise", corrected), 0).resultText, corrected.resultText);
  assert.equal(rejectedProposal([result()], reviewFor("revise"), 0), null);
  assert.equal(rejectedProposal([], reviewFor("reject"), 0), null);
});

test("the promotion route re-verifies overturns and keeps human stamps through re-runs", async () => {
  const [route, dashboard, overturnPanel, artifact, artifactStore] = await Promise.all([
    readFile(new URL("../app/api/promote/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/research/research-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/research/reject-overturn.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/live-artifact.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/live-artifact-store.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /checkHumanOverturn\(/);
  assert.match(route, /if \(\(autoGatePasses \|\| humanOverturn\) && rawArtifact\)/);
  assert.match(route, /er\.status != 'accepted-human-verified-full-text'/);
  assert.match(route, /verification_status IN \('ai-cross-checked-full-text', 'human-verified-full-text'\)/);
  assert.match(dashboard, /reviewMode: humanOverturnReviewMode/);
  assert.match(overturnPanel, /Accept as human-verified/);
  assert.equal(humanOverturnRelationStatus, "accepted-human-verified-full-text");
  assert.match(artifact, /"accepted-human-verified-full-text"/);
  assert.match(artifactStore, /'accepted-human-verified-full-text'/);
});
