import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { operationCacheKey, stableSerialize } from "../lib/operation-cache.ts";

test("operation cache keys are stable across object key ordering and contract-versioned", async () => {
  const left = { filters: ["reviews", "trials"], query: "egg breakfast", nested: { max: 6, sort: "relevance" } };
  const right = { nested: { sort: "relevance", max: 6 }, query: "egg breakfast", filters: ["reviews", "trials"] };
  assert.equal(stableSerialize(left), stableSerialize(right));
  assert.equal(
    await operationCacheKey("pubmed-discovery", "v1", left),
    await operationCacheKey("pubmed-discovery", "v1", right),
  );
  assert.notEqual(
    await operationCacheKey("pubmed-discovery", "v1", left),
    await operationCacheKey("pubmed-discovery", "v2", left),
  );
});

test("live research and model extraction use a bypassable shared cache", async () => {
  const [researchRoute, deepDiveRoute, decompositionRoute, cacheStore] = await Promise.all([
    readFile(new URL("../app/api/research/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/deep-dive/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/decompose/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/cache.ts", import.meta.url), "utf8"),
  ]);
  for (const route of [researchRoute, deepDiveRoute, decompositionRoute]) {
    assert.match(route, /readOperationCache/);
    assert.match(route, /writeOperationCache/);
    assert.match(route, /status: "hit"/);
    assert.match(route, /status: refresh \? "bypass" : "miss"/);
  }
  assert.match(researchRoute, /body\.refresh === true/);
  assert.match(deepDiveRoute, /body\.refresh === true/);
  assert.match(decompositionRoute, /refresh = body\.refresh === true/);
  assert.match(deepDiveRoute, /const cached = await readOperationCache[\s\S]+const openRouterApiKey/);
  assert.match(decompositionRoute, /const cached = await readOperationCache[\s\S]+const openRouterApiKey/);
  assert.match(cacheStore, /Cache failure must never block the underlying research operation/);
  assert.match(cacheStore, /ON CONFLICT\(id\) DO UPDATE SET/);
});

test("decomposition reuses an exact browser result before requiring a model key", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /epistack:decomposition-operation-cache:v2/);
  assert.match(page, /cached\.prompt === normalizedPrompt/);
  assert.match(page, /cached\.decisionContext === contextForRequest/);
  assert.match(page, /cached\.model === normalizedModel/);
  assert.match(page, /cache: \{ status: "browser", layer: "browser"/);
  assert.match(page, /if \(!openRouterKey\.trim\(\)\)/);
  assert.match(page, /Recompute/);
});

test("the dashboard restores disposable UI state and exposes explicit live refresh", async () => {
  const dashboard = await readFile(new URL("../app/research/research-dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /epistack:research-ui-cache:v1/);
  assert.match(dashboard, /window\.localStorage\.getItem\(dashboardCacheKey\)/);
  assert.match(dashboard, /window\.localStorage\.setItem\(dashboardCacheKey/);
  assert.match(dashboard, /Reset browser cache/);
  assert.match(dashboard, /Refresh live/);
  assert.match(dashboard, /Re-extract live/);
  assert.match(dashboard, /status: "browser", layer: "browser"/);
});
