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
  const [researchRoute, deepDiveRoute, cacheStore] = await Promise.all([
    readFile(new URL("../app/api/research/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/deep-dive/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/cache.ts", import.meta.url), "utf8"),
  ]);
  for (const route of [researchRoute, deepDiveRoute]) {
    assert.match(route, /body\.refresh === true/);
    assert.match(route, /readOperationCache/);
    assert.match(route, /writeOperationCache/);
    assert.match(route, /status: "hit"/);
    assert.match(route, /status: refresh \? "bypass" : "miss"/);
  }
  assert.match(deepDiveRoute, /const cached = await readOperationCache[\s\S]+const openRouterApiKey/);
  assert.match(cacheStore, /Cache failure must never block the underlying research operation/);
  assert.match(cacheStore, /ON CONFLICT\(id\) DO UPDATE SET/);
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
