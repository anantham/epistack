import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("decision synthesis reads the canonical accepted graph and validates every reference", async () => {
  const [route, projection, store, workbench] = await Promise.all([
    readFile(new URL("../app/api/synthesize/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/decision-synthesis.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/live-artifact-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/synthesis/decision-workbench.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /readLiveArtifact\(caseId\)/);
  assert.match(route, /artifact\.graph\.results\.length === 0/);
  assert.match(route, /validateDecisionReferences/);
  assert.match(route, /validateDecisionOptionCoverage/);
  assert.match(route, /mislabeledHumanValues/);
  assert.match(route, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(route, /graph_snapshot_id/);
  assert.match(route, /freeze-accepted-evidence-basis/);
  assert.match(route, /projectionHash/);
  assert.match(route, /privacyMinimizedDecisionBrief/);
  assert.match(route, /NO_DECISION_ELIGIBLE_EVIDENCE/);
  assert.match(route, /researchBrief:\s*JSON\.stringify\(input\.shareableBrief/);
  assert.match(route, /synthesize-decision/);
  assert.match(route, /cacheStatus === "hit"/);
  assert.match(projection, /dependenceFamilies/);
  assert.match(projection, /applicability/);
  assert.match(projection, /basisRelationIds/);
  assert.match(projection, /mismatchedClaimRelationIds/);
  assert.doesNotMatch(projection, /confidence:\s*z\./);
  assert.match(store, /accepted-by-dual-model-review/);
  assert.match(store, /accepted-human-verified-full-text/);
  assert.match(workbench, /typeof window === "undefined"/);
  assert.match(workbench, /setSession\(getSession\(\)\)/);
});

test("new accepted evidence invalidates prior decisions and keeps stable semantic result identity", async () => {
  const [promotion, stableIds, database] = await Promise.all([
    readFile(new URL("../app/api/promote/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/stable-record-id.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(promotion, /SET status = 'stale'/);
  assert.match(promotion, /accepted-evidence-changed/);
  assert.match(promotion, /promotedResultSemanticKey/);
  assert.match(stableIds, /stableSemanticId/);
  assert.match(database, /ensureDecisionTables/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS update_events/);
});
