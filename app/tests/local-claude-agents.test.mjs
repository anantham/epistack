import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { adjudicateDualReview, canonicalizeExactExcerpt, dualReviewPolicyId, passageExists, populationMismatchSignals } from "../lib/dual-review.ts";
import { jatsToPlainText, parseClaudeStructuredOutput } from "../scripts/local-claude-agents.mjs";

const artifact = {
  kind: "pmc-jats",
  pmcid: "PMC2755181",
  canonicalUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC2755181/",
  localXmlPath: ".epistack/sources/PMC2755181.xml",
  localTextPath: ".epistack/sources/PMC2755181.txt",
  contentHash: "a".repeat(64),
  retrievedAt: "2026-07-20T00:00:00.000Z",
};

function result(overrides = {}) {
  return {
    analysisLabel: "Between-group weight loss",
    analysisType: "randomized between-group comparison",
    outcome: "body weight change",
    timeHorizon: "8 weeks",
    resultRole: "primary",
    resultText: "The energy-restricted egg group lost more weight than the bagel group.",
    estimate: "2.63 kg versus 1.59 kg",
    exactExcerpt: "weight loss of 2.63 kg compared with 1.59 kg",
    locator: "Results, paragraph 2",
    claimFrameId: "weight-superiority",
    relation: "supports",
    scopeMatch: "direct",
    applicability: {
      matched: ["adults with overweight", "egg breakfast", "energy-matched comparator"],
      mismatched: [],
      unknown: [],
      constraintRelaxations: [],
      distance: "exact",
      rationale: "The claim frame and study scope match for this controlled comparison.",
    },
    rationale: "This is the prespecified between-group comparison under energy restriction.",
    ...overrides,
  };
}

function primary(results = [result()]) {
  return {
    study: {
      design: "randomized four-arm trial",
      population: "adults with overweight or obesity",
      exposure: "egg breakfast",
      comparator: "energy-matched bagel breakfast",
      limitations: ["Eight-week duration"],
      registrationId: null,
      cohortIdentifiers: [],
    },
    evidenceFamily: {
      label: "Vander Wal 2008 trial",
      reason: "All records use the same randomized sample.",
      basis: "same-sample",
      dependsOn: [],
    },
    results,
    authorConclusion: "An egg breakfast enhanced weight loss during energy restriction.",
    conclusionFit: "matches-results",
    extractionCaveat: "The automatic record still requires ongoing correction and retraction monitoring.",
    sourceInspection: {
      artifactHash: artifact.contentHash,
      fullTextRead: true,
      methodsRead: true,
      resultsRead: true,
      tablesRead: true,
      supplementaryMaterialChecked: false,
      inspectionNote: "Methods, results, and reported tables were inspected in the preserved artifact.",
    },
  };
}

function review(reviews) {
  return {
    artifactHash: artifact.contentHash,
    independentlyReadFullText: true,
    methodsAndResultsRead: true,
    overallAssessment: "The proposal is faithful only where the quoted passage and scoped comparison match.",
    reviews,
  };
}

test("JATS acquisition text and Claude structured envelopes are deterministically normalized", () => {
  assert.equal(jatsToPlainText("<article><sec><title>Results</title><p>A &amp; B</p></sec></article>"), "Results\n\nA & B");
  assert.deepEqual(parseClaudeStructuredOutput(JSON.stringify({ result: "{\"ok\":true}" })), { ok: true });
  assert.equal(passageExists("Observed weight loss of 2.63 kg compared with 1.59 kg.", "weight loss of 2.63 kg compared with 1.59 kg"), true);
  assert.equal(passageExists("The result was associated with higher risk, representing 8%–10% higher risks.", "The result was associated with higher risk."), true);
  assert.equal(passageExists("The result was associated with higher risk.", "The result was associated with higher risk, representing 8%–10% higher risks."), false);
});

test("the local companion keeps remote browser access opt-in and origin-scoped", async () => {
  const source = await readFile(new URL("../scripts/local-claude-agents.mjs", import.meta.url), "utf8");
  assert.match(source, /EPISTACK_ALLOWED_BROWSER_ORIGINS/);
  assert.match(source, /configuredBrowserOrigins\.has\(origin\)/);
  assert.match(source, /Access-Control-Allow-Private-Network/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin", "\\*"/);
});

test("dual-model policy promotes only a passage-backed result reviewed by a different model", () => {
  const outcome = adjudicateDualReview({
    primary: primary(),
    review: review([{
      resultIndex: 0,
      verdict: "accept",
      quoteVerified: true,
      locatorVerified: true,
      scopeVerified: true,
      relationVerified: true,
      rationale: "The exact passage, comparison, estimate, and claim relation were independently checked.",
      correctedResult: null,
    }]),
    fullText: "Observed weight loss of 2.63 kg compared with 1.59 kg in the diet arms.",
    artifact,
    primaryModel: "opus",
    adversaryModel: "sonnet",
  });
  assert.equal(outcome.policyId, dualReviewPolicyId);
  assert.equal(outcome.eligible, true);
  assert.equal(outcome.acceptedCount, 1);
  assert.equal(outcome.decisions[0].passageFound, true);
  assert.equal(outcome.decisions[0].finalDecision, "promote");
});

/*
Test intent:
- Accept a model-added boundary ellipsis only when the remaining excerpt is literal.
- Persist the canonical excerpt without the model's wrapper.
- Keep the strict substring gate intact for non-matching text.
*/
test("boundary ellipses are canonicalized before the strict passage gate", () => {
  const ellipsized = result({ exactExcerpt: "...weight loss of 2.63 kg compared with 1.59 kg..." });
  const outcome = adjudicateDualReview({
    primary: primary([ellipsized]),
    review: review([{
      resultIndex: 0,
      verdict: "accept",
      quoteVerified: true,
      locatorVerified: true,
      scopeVerified: true,
      relationVerified: true,
      rationale: "The quoted result is supported by the preserved source.",
      correctedResult: null,
    }]),
    fullText: "Observed weight loss of 2.63 kg compared with 1.59 kg in the diet arms.",
    artifact,
    primaryModel: "opus",
    adversaryModel: "sonnet",
  });
  assert.equal(canonicalizeExactExcerpt("…weight loss of 2.63 kg compared with 1.59 kg…"), "weight loss of 2.63 kg compared with 1.59 kg");
  assert.equal(outcome.eligible, true);
  assert.equal(outcome.decisions[0].passageFound, true);
  assert.equal(outcome.candidate.results[0].exactExcerpt, "weight loss of 2.63 kg compared with 1.59 kg");
});

test("reviewer approval cannot override a missing quotation or same-model review", () => {
  const baseReview = review([{
    resultIndex: 0,
    verdict: "accept",
    quoteVerified: true,
    locatorVerified: true,
    scopeVerified: true,
    relationVerified: true,
    rationale: "The reviewer claimed every check passed, but the deterministic gate still applies.",
    correctedResult: null,
  }]);
  const missingPassage = adjudicateDualReview({
    primary: primary(), review: baseReview, fullText: "No matching result is present.", artifact, primaryModel: "opus", adversaryModel: "sonnet",
  });
  assert.equal(missingPassage.eligible, false);
  assert.equal(missingPassage.decisions[0].finalDecision, "reject");

  const sameModel = adjudicateDualReview({
    primary: primary(), review: baseReview, fullText: "weight loss of 2.63 kg compared with 1.59 kg", artifact, primaryModel: "opus", adversaryModel: "opus",
  });
  assert.equal(sameModel.eligible, false);
  assert.match(sameModel.reasons.join(" "), /different models/);
});

test("automatic promotion rejects a study population with unrepresented scope qualifiers", () => {
  const outcome = adjudicateDualReview({
    primary: primary(),
    review: review([{
      resultIndex: 0,
      verdict: "accept",
      quoteVerified: true,
      locatorVerified: true,
      scopeVerified: true,
      relationVerified: true,
      rationale: "The quote is present, but the deterministic scope check must still run.",
      correctedResult: null,
    }]),
    fullText: "Observed weight loss of 2.63 kg compared with 1.59 kg in the diet arms.",
    artifact,
    primaryModel: "opus",
    adversaryModel: "sonnet",
    claimFrames: [{ id: "weight-superiority", population: "generally healthy adults" }],
  });
  assert.equal(outcome.decisions[0].finalDecision, "reject");
  assert.match(outcome.decisions[0].rationale, /scope qualifiers/i);
});

test("population scope qualifiers use token boundaries instead of substring matches", () => {
  assert.deepEqual(populationMismatchSignals("healthy female adults", "healthy male adults"), ["male"]);
  assert.deepEqual(populationMismatchSignals("healthy male adults", "healthy female adults"), ["female"]);
  assert.deepEqual(populationMismatchSignals("adult nonsmokers", "adult smokers"), ["smoker"]);
  assert.deepEqual(populationMismatchSignals("adult smokers", "adult nonsmokers"), []);
});
