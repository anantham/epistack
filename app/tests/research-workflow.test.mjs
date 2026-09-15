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

test("the capability rail explains placeholder capabilities as planned", async () => {
  const dashboard = await readFile(new URL("../app/research/research-dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /capability\.status === "live" \? "live" : "planned"/);
});

test("research route keeps discovery separate from evidence promotion", async () => {
  const [dashboard, api, deepDiveApi, promoteApi, investigateApi, database, decision, recallApi] = await Promise.all([
    readFile(new URL("../app/research/research-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/research/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/deep-dive/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/promote/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/investigate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/synthesis/decision-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/recall/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /Search rank is not evidential weight/);
  assert.doesNotMatch(dashboard, /Promise\.all\(researchLanes\.map/);
  assert.match(dashboard, /Automation carries the routine attention\. Humans inspect the cruxes/);
  assert.match(dashboard, /Inspect atomic results/);
  assert.match(dashboard, /Run full-paper cross-check/);
  assert.match(dashboard, /Use abstract-only fallback/);
  assert.match(dashboard, /Promote checked results/);
  assert.match(dashboard, /Persistent graph · Live promotions only/);
  assert.match(dashboard, /discovery leads/);
  assert.match(dashboard, /accepted records/);
  assert.match(dashboard, /papers acquired/);
  assert.match(dashboard, /full-text reviews/);
  assert.match(dashboard, /researchBriefStorageKey/);
  assert.match(dashboard, /researchLanesFromBrief/);
  assert.match(dashboard, /claimFrames: compiledClaimFrames\(\)/);
  assert.match(dashboard, /applicabilityProfile: outboundApplicabilityProfile\(\)/);
  assert.match(dashboard, /applicabilityProfile: localApplicabilityProfile\(\)/);
  assert.match(api, /eutils\.ncbi\.nlm\.nih\.gov/);
  assert.match(api, /compilePubmedQuery/);
  assert.match(deepDiveApi, /deepDiveSchema\.safeParse/);
  assert.match(deepDiveApi, /verificationStatus: "abstract-only"/);
  assert.match(deepDiveApi, /shareableApplicabilityProfileSchema/);
  assert.match(deepDiveApi, /Local-only stakeholder facts cannot be sent/);
  assert.match(promoteApi, /autoGatePasses/);
  assert.match(promoteApi, /dualReviewPolicyId/);
  assert.match(promoteApi, /provisional-pending-full-text/);
  assert.match(promoteApi, /accepted-by-dual-model-review/);
  assert.match(investigateApi, /astraRenderedPromptLimit/);
  assert.match(investigateApi, /input\.length \+ instructions\.length/);
  assert.match(investigateApi, /Astra prompt limit/);
  assert.match(promoteApi, /JOIN result_records/);
  assert.match(database, /ensureEvidenceGraphTables/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS assessments/);
  assert.match(decision, /Only accepted D1 result records/);
  assert.match(decision, /Synthesize decision/);
  assert.match(decision, /loadBearingResultIds/);
  assert.match(decision, /dependenceGroups/);
  assert.match(dashboard, /searchKeptClaims/);
  assert.match(dashboard, /Recall layer · Lead-only/);
  assert.match(dashboard, /Use this query/);
  assert.match(recallApi, /openrouter:web_search/);
  assert.match(recallApi, /Astra fallback · web search/);
  assert.match(recallApi, /map\(\(lead\) => lead\.id\)\.slice\(0, 12\)/);
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

test("research requires a matching case contract and minimizes outbound applicability context", async () => {
  const [dashboard, navigation, artifact, decision, synthesisPage] = await Promise.all([
    readFile(new URL("../app/research/research-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/case-navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/artifact/artifact-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/synthesis/decision-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/synthesis/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /Research contract required/);
  assert.match(dashboard, /will not substitute a demo/);
  assert.match(dashboard, /new URLSearchParams\(window\.location\.search\)\.get\("caseId"\)/);
  assert.doesNotMatch(dashboard, /legacyClaimFrames|Egg fixture fallback|eggs-live-mvp/);
  assert.match(dashboard, /setOpenLane\(\(current\) => current === lane\.id \? "" : lane\.id\)/);
  assert.match(dashboard, /Recheck companion status/);
  assert.match(dashboard, /\/api\/recall/);
  assert.match(dashboard, /applicabilityProfile: outboundApplicabilityProfile\(\)/);
  assert.match(dashboard, /applicabilityProfile: localApplicabilityProfile\(\)/);

  const outboundStart = dashboard.indexOf("function outboundApplicabilityProfile");
  const localStart = dashboard.indexOf("function localApplicabilityProfile");
  assert.ok(outboundStart >= 0 && localStart > outboundStart);
  const outboundProfile = dashboard.slice(outboundStart, localStart);
  assert.doesNotMatch(outboundProfile, /brief\.stakeholderProfile|brief\.decisionContext|assignment\.selectedValue/);

  assert.match(navigation, /useCaseHref/);
  assert.match(navigation, /caseId=\$\{encodeURIComponent\(caseId\)\}/);
  assert.doesNotMatch(artifact, /\|\| "eggs-live-mvp"/);
  assert.doesNotMatch(decision, /\|\| "eggs-live-mvp"/);
  assert.match(decision, /if \(!decisionResponse\.ok\)/);
  assert.match(decision, /artifact\.integrityWarnings\.length === 0/);
  assert.match(decision, /href="\/\?settings=1"/);
  assert.match(synthesisPage, /useCaseHref\("\/artifact"\)/);
});
