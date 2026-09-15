import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExtractionChunkTask,
  buildReviewChunkTask,
  boundedReviewableArtifactText,
  chunkRetryDelayMs,
  chunkExtractionSchema,
  chunkReviewSchema,
  isRetryableChunkFailure,
  mergeChunkExtractions,
  mergeChunkReviews,
  planChunkedPrompts,
  reviewableArtifactText,
} from "../lib/chunked-full-text.ts";

/* Test intent
 * - Keep every Lyra request below the server-enforced prompt budget.
 * - Preserve overlap and complete artifact coverage across segments.
 * - Merge chunk observations without weakening the final deep-dive schema.
 * - Reject candidates that no reviewer segment explicitly covers.
 */

const hash = "a".repeat(64);
const sectionsRead = { methods: true, results: true, tables: false, interpretation: false, supplementaryMaterial: false };
const context = {
  question: "Which intervention is better?",
  decisionContext: "The decision context is deliberately short for this contract test.",
  citation: "Example article · PMID 12345678",
  artifactHash: hash,
  claimFrames: "claim-a\nPopulation: adults\nExposure: intervention\nComparator: control\nOutcome: weight",
  applicabilityProfile: "Adults in the supplied setting.",
};

const result = (overrides = {}) => ({
  analysisLabel: "Primary weight result",
  analysisType: "randomized trial",
  outcome: "weight change",
  timeHorizon: "12 weeks",
  resultRole: "primary",
  resultText: "The intervention group lost more weight than the control group.",
  estimate: "-2.1 kg versus -0.8 kg",
  exactExcerpt: "The intervention group lost more weight than the control group.",
  locator: "Results, paragraph 1",
  claimFrameId: "claim-a",
  relation: "supports",
  scopeMatch: "direct",
  applicability: {
    matched: ["adults"],
    mismatched: [],
    unknown: [],
    constraintRelaxations: [],
    distance: "exact",
    rationale: "The reported population matches the supplied claim.",
  },
  rationale: "The reported comparison directly addresses the supplied claim.",
  ...overrides,
});

const extractionChunk = (overrides = {}) => chunkExtractionSchema.parse({
  artifactHash: hash,
  chunkIndex: 0,
  chunkCount: 1,
  chunkRead: true,
  sectionsRead,
  study: {
    design: "Randomized trial",
    population: "Adults",
    exposure: "Intervention",
    comparator: "Control",
    limitations: ["Short follow-up"],
    registrationId: null,
    cohortIdentifiers: [],
  },
  evidenceFamily: { label: "Example trial", reason: "One participant sample.", basis: "same-sample", dependsOn: [] },
  results: [result()],
  authorConclusion: "The intervention reduced weight.",
  conclusionFit: "matches-results",
  extractionCaveat: "Supplementary material was not available.",
  inspectionNote: "The bounded segment was inspected.",
  ...overrides,
});

test("chunked prompt planning stays within the Lyra character budget and overlaps coverage", () => {
  const fullText = Array.from({ length: 12_000 }, (_, index) => `Sentence ${index} contains preserved source text.`).join(" ");
  const instructions = "Read the supplied segment and return the bounded JSON contract.";
  const plan = planChunkedPrompts({
    fullText,
    instructions,
    taskFor: (chunk) => buildExtractionChunkTask(context, chunk),
    promptLimit: 12_000,
    safetyMargin: 450,
  });

  assert.ok(plan.chunks.length > 1);
  assert.equal(plan.chunks.at(-1).end, fullText.length);
  assert.ok(plan.chunks[1].start < plan.chunks[0].end);
  for (const task of plan.tasks) assert.ok(instructions.length + task.length <= 12_000);
});

test("chunk retries recognize transient provider failures without retrying schema failures", () => {
  assert.equal(isRetryableChunkFailure(Object.assign(new Error("ChatGPT prompt submission was not confirmed."), { code: "provider_transient" })), true);
  assert.equal(isRetryableChunkFailure(new Error("Page.goto: net::ERR_NETWORK_CHANGED at https://chatgpt.com/")), true);
  assert.equal(isRetryableChunkFailure(new Error("ChatGPT interactive control 'Latest' did not appear")), true);
  assert.equal(isRetryableChunkFailure(new Error("ChatGPT model selection did not persist after effort change")), true);
  assert.equal(isRetryableChunkFailure(new Error("BrowserType.launch_persistent_context: Target page, context or browser has been closed")), true);
  assert.equal(isRetryableChunkFailure(new Error("Locator.press: Timeout 30000ms exceeded waiting for #prompt-textarea")), true);
  assert.equal(isRetryableChunkFailure(new Error("The model output did not match the schema.")), false);
  assert.equal(isRetryableChunkFailure(Object.assign(new Error("The hosted Astra stage timed out before it completed."), { code: "backend-timeout" })), false);
  assert.equal(chunkRetryDelayMs(1), 1_000);
  assert.equal(chunkRetryDelayMs(3), 4_000);
});

test("chunked review keeps the preserved hash while excluding a trailing bibliography from model context", () => {
  assert.equal(reviewableArtifactText("Results\nThe outcome changed.\n\nReferences\n1. Citation."), "Results\nThe outcome changed.");
  assert.equal(reviewableArtifactText("Results\nThe outcome changed."), "Results\nThe outcome changed.");
});

test("bounded review text matches the hosted artifact prefix boundary", () => {
  assert.equal(
    boundedReviewableArtifactText("Methods\nResults\nDiscussion\nReferences\n1. Citation.", 24),
    "Methods\nResults\nDiscussi",
  );
  assert.equal(boundedReviewableArtifactText("Results\nThe outcome changed.", 10), "Results\nTh");
});

test("chunk extraction merge creates a complete candidate and derives full-text attestations", () => {
  const merged = mergeChunkExtractions([extractionChunk()], hash);
  assert.equal(merged.sourceInspection.artifactHash, hash);
  assert.equal(merged.sourceInspection.fullTextRead, true);
  assert.equal(merged.study.population, "Adults");
  assert.equal(merged.results.length, 1);
  assert.equal(merged.results[0].exactExcerpt, result().exactExcerpt);
});

test("chunk review merge preserves explicit coverage and rejects uncovered results", () => {
  const primary = mergeChunkExtractions([extractionChunk({ results: [result(), result({ analysisLabel: "Secondary result", exactExcerpt: "The control group reported no serious adverse events." })] })], hash);
  const reviewChunk = chunkReviewSchema.parse({
    artifactHash: hash,
    chunkIndex: 0,
    chunkCount: 1,
    chunkRead: true,
    sectionsRead,
    findings: [{
      resultIndex: 0,
      verdict: "accept",
      quoteVerified: true,
      locatorVerified: true,
      scopeVerified: true,
      relationVerified: true,
      rationale: "The segment supports the result exactly.",
      correctedResult: null,
    }],
    inspectionNote: "The bounded review segment was inspected.",
  });
  const review = mergeChunkReviews([reviewChunk], primary, hash);
  assert.equal(review.independentlyReadFullText, true);
  assert.equal(review.reviews[0].verdict, "accept");
  assert.equal(review.reviews[1].verdict, "reject");
  assert.match(review.reviews[1].rationale, /No bounded reviewer segment/);
  assert.match(buildReviewChunkTask(context, { index: 0, count: 1, start: 0, end: 10, text: "source text" }, "{}"), /findings/);
});
