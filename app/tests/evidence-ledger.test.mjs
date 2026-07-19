import assert from "node:assert/strict";
import test from "node:test";
import {
  atomicResults,
  claimFrames,
  evidenceFamilies,
  resultsForSource,
  sourceRelationshipSummary,
  sourcesWithResults,
} from "../data/eggs-result-ledger.ts";

test("every atomic result resolves to a claim, source, and dependence family", () => {
  const claimIds = new Set(claimFrames.map((claim) => claim.id));
  const sourceIds = new Set(sourcesWithResults.map((source) => source.id));
  const familyIds = new Set(evidenceFamilies.map((family) => family.id));

  assert.ok(atomicResults.length >= 16);
  for (const result of atomicResults) {
    assert.ok(claimIds.has(result.claimId), `Unknown claim: ${result.claimId}`);
    assert.ok(sourceIds.has(result.sourceId), `Unknown source: ${result.sourceId}`);
    assert.ok(familyIds.has(result.evidenceFamilyId), `Unknown family: ${result.evidenceFamilyId}`);
    assert.ok(result.locator.length > 0, `Missing locator: ${result.id}`);
    assert.ok(result.rationale.length > 0, `Missing rationale: ${result.id}`);
  }
});

test("a publication can carry opposing result relationships without being flattened", () => {
  const vanderWal = resultsForSource("vander-wal-2008");
  assert.ok(vanderWal.some((result) => result.relation === "supports"));
  assert.ok(vanderWal.some((result) => result.relation === "contradicts"));
  assert.equal(sourceRelationshipSummary(vanderWal), "mixed");
  assert.equal(new Set(vanderWal.map((result) => result.evidenceFamilyId)).size, 1);
});

test("review results declare dependence on represented primary-study families", () => {
  const review = evidenceFamilies.find((family) => family.id === "review-emrani-2023");
  assert.ok(review);
  assert.deepEqual(review.dependsOn, ["trial-vander-wal-2008", "trial-keogh-2020"]);
});
