import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const promotionRoute = await readFile(
  new URL("../app/api/promote/route.ts", import.meta.url),
  "utf8",
);

test("promotion requires a real case and the complete compiled claim set", () => {
  assert.match(promotionRoute, /if \(!validCaseId\(body\.caseId\)\)/);
  assert.match(promotionRoute, /if \(!suppliedClaimFrames\.success\)/);
  assert.match(promotionRoute, /for \(const claim of promotableClaimFrames\)/);
  assert.doesNotMatch(promotionRoute, /eggs-result-ledger/);
  assert.doesNotMatch(promotionRoute, /Legacy egg fixture/);
});

test("atomic results are deduplicated while claim relations remain distinct", () => {
  assert.match(promotionRoute, /const atomicById = new Map/);
  assert.match(promotionRoute, /const relationById = new Map/);
  assert.match(promotionRoute, /atomicResults\.forEach/);
  assert.match(promotionRoute, /relationRecords\.forEach/);
  assert.match(promotionRoute, /relationId: `\$\{recordPrefix\}-relation-\$\{semanticKey\}-\$\{safeId\(result\.claimFrameId\)\}`/);
});

test("full-text promotion supersedes omitted prior accepted records transactionally", () => {
  assert.match(promotionRoute, /SET status = 'superseded-by-full-text-review'/);
  assert.match(promotionRoute, /SET verification_status = 'superseded-by-full-text-review'/);
  assert.match(promotionRoute, /AND er\.id NOT IN/);
  assert.match(promotionRoute, /AND rr\.id NOT IN/);
  assert.match(promotionRoute, /verification_status = excluded\.verification_status/);
  assert.match(promotionRoute, /depends_on_json = excluded\.depends_on_json/);
});

test("provisional abstracts cannot enter the accepted-only artifact", () => {
  assert.match(promotionRoute, /provisional-pending-full-text/);
  assert.doesNotMatch(promotionRoute, /accepted-pending-full-text/);
  assert.match(promotionRoute, /record-provisional-abstract-results/);
  assert.match(promotionRoute, /An abstract-only proposal cannot overwrite or downgrade it/);
});

test("identical promotion fingerprints do not invalidate decisions", () => {
  assert.match(promotionRoute, /const graphChanged = previousSnapshot\?\.graph_fingerprint !== graphFingerprint/);
  assert.match(promotionRoute, /if \(graphChanged\)/);
  assert.match(promotionRoute, /latestCaseSnapshot\?\.id \?\? null/);
  assert.match(promotionRoute, /if \(autoPromotion\)/);
});

test("automatic acceptance independently verifies the public source artifact", () => {
  assert.match(promotionRoute, /idconv\/api\/v1\/articles/);
  assert.match(promotionRoute, /efetch\.fcgi/);
  assert.match(promotionRoute, /fetchedHash !== declaredHash/);
  assert.match(promotionRoute, /passageExists\(plainText, excerpt\)/);
  assert.match(promotionRoute, /sourceArtifact: persistedArtifact/);
  assert.doesNotMatch(promotionRoute, /sourceArtifact: autoPromotion \? rawArtifact/);
  assert.match(promotionRoute, /serverVerified: true/);
});

test("registered studies share an explicit family key and preserve declared dependencies", () => {
  assert.match(promotionRoute, /registered-family-\$\{await stableSemanticId\(\{ registrationId \}\)\}/);
  assert.match(promotionRoute, /registration_id = excluded\.registration_id/);
  assert.match(promotionRoute, /JSON\.stringify\(dependsOn\)/);
  assert.doesNotMatch(promotionRoute, /cohortIdentifiers.*familyId/s);
});
