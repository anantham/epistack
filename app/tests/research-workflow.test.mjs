import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  knownSourceByPmid,
  laneAudit,
  researchCapabilities,
  researchLanes,
} from "../data/eggs-investigation.ts";
import { atomicResults } from "../data/eggs-result-ledger.ts";
import { deepDiveProviderJsonSchema, deepDiveSchema } from "../lib/deep-dive.ts";
import { compilePubmedQuery } from "../lib/research.ts";

test("the MVP has distinct, editable research lanes with promoted evidence anchors", () => {
  assert.equal(researchLanes.length, 3);
  assert.equal(new Set(researchLanes.map((lane) => lane.id)).size, researchLanes.length);
  for (const lane of researchLanes) {
    assert.ok(lane.defaultQuery.length > 20);
    assert.ok(lane.crux.length > 20);
    assert.ok(lane.inclusionRule.length > 20);
    assert.ok(laneAudit(lane).resultCount > 0, `${lane.id} needs a reviewed result anchor`);
  }
});

test("known PubMed records resolve to at least one atomic result when promoted", () => {
  for (const source of knownSourceByPmid.values()) {
    const represented = atomicResults.some((result) => result.sourceId === source.id);
    if (represented) assert.ok(source.pmid, `${source.id} must be matchable from live discovery`);
  }
});

test("publication filters compile as a transparent addition to the human query", () => {
  const compiled = compilePubmedQuery("egg breakfast satiety", ["trials", "reviews"]);
  assert.match(compiled, /^\(egg breakfast satiety\) AND/);
  assert.match(compiled, /randomized controlled trial\[Publication Type\]/);
  assert.match(compiled, /systematic review\[Publication Type\]/);
  assert.equal(compilePubmedQuery("egg breakfast satiety", []), "egg breakfast satiety");
});

test("the interface labels unfinished capabilities as placeholders", () => {
  assert.ok(researchCapabilities.some((capability) => capability.status === "live"));
  assert.ok(researchCapabilities.some((capability) => capability.status === "placeholder"));
});

test("research route keeps discovery separate from evidence promotion", async () => {
  const [dashboard, api, deepDiveApi, promoteApi, database, decision] = await Promise.all([
    readFile(new URL("../app/research/research-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/research/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/deep-dive/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/promote/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/synthesis/decision-workbench.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /Search rank is not evidential weight/);
  assert.doesNotMatch(dashboard, /Promise\.all\(researchLanes\.map/);
  assert.match(dashboard, /Automation carries the routine attention\. Humans inspect the cruxes/);
  assert.match(dashboard, /Inspect atomic results/);
  assert.match(dashboard, /Run full-paper cross-check/);
  assert.match(dashboard, /Use abstract-only fallback/);
  assert.match(dashboard, /Promote checked results/);
  assert.match(dashboard, /Persistent graph · Live promotions only/);
  assert.match(api, /eutils\.ncbi\.nlm\.nih\.gov/);
  assert.match(api, /compilePubmedQuery/);
  assert.match(deepDiveApi, /deepDiveSchema\.safeParse/);
  assert.match(deepDiveApi, /verificationStatus: "abstract-only"/);
  assert.match(promoteApi, /autoGatePasses/);
  assert.match(promoteApi, /dualReviewPolicyId/);
  assert.match(promoteApi, /accepted-pending-full-text/);
  assert.match(promoteApi, /accepted-by-dual-model-review/);
  assert.match(promoteApi, /JOIN result_records/);
  assert.match(database, /ensureEvidenceGraphTables/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS assessments/);
  assert.match(decision, /What will the eggs replace/);
  assert.match(decision, /Save decision snapshot/);
  assert.match(decision, /evidenceBasis/);
});

test("abstract extraction keeps provider constraints separate from semantic validation", () => {
  function findUnsupported(value, findings = []) {
    if (!value || typeof value !== "object") return findings;
    for (const [key, child] of Object.entries(value)) {
      if (["minItems", "maxItems", "minLength", "maxLength"].includes(key)) findings.push(key);
      findUnsupported(child, findings);
    }
    return findings;
  }
  assert.deepEqual(findUnsupported(deepDiveProviderJsonSchema), []);
  assert.equal(deepDiveSchema.safeParse({}).success, false);
});
