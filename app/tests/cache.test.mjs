import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  browserDecompositionCacheLimit,
  decompositionBackendIsPrimary,
  decompositionCacheEntryKey,
  emptyBrowserDecompositionCache,
  findBrowserDecompositionCacheEntry,
  normalizeDecompositionText,
  parseBrowserDecompositionCache,
  upsertBrowserDecompositionCacheEntry,
} from "../lib/decomposition-cache.ts";
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
  const [researchRoute, deepDiveRoute, decompositionRoute, synthesisRoute, cacheStore] = await Promise.all([
    readFile(new URL("../app/api/research/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/deep-dive/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/decompose/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/synthesize/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/cache.ts", import.meta.url), "utf8"),
  ]);
  for (const route of [researchRoute, deepDiveRoute, decompositionRoute]) {
    assert.match(route, /readOperationCache/);
    assert.match(route, /writeOperationCache/);
    assert.match(route, /status: "hit"/);
    assert.match(route, /status: refresh \? "bypass" : "miss"/);
  }
  assert.match(synthesisRoute, /readOperationCache/);
  assert.match(synthesisRoute, /writeOperationCache/);
  assert.match(synthesisRoute, /cacheStatus = "hit"/);
  assert.match(synthesisRoute, /status: cacheStatus/);
  assert.match(synthesisRoute, /refresh \? "bypass" : "miss"/);
  assert.match(researchRoute, /body\.refresh === true/);
  assert.match(deepDiveRoute, /body\.refresh === true/);
  assert.match(decompositionRoute, /refresh = body\.refresh === true/);
  assert.match(synthesisRoute, /const refresh = body\.refresh === true/);
  assert.match(deepDiveRoute, /const cached = await readOperationCache[\s\S]+const openRouterApiKey/);
  assert.match(decompositionRoute, /const cached = await readOperationCache[\s\S]+const openRouterApiKey/);
  assert.match(cacheStore, /Cache failure must never block the underlying research operation/);
  assert.match(cacheStore, /ON CONFLICT\(id\) DO UPDATE SET/);
});

function cachedDecomposition(caseId) {
  return {
    caseId,
    mode: "ai",
    model: "test model",
    warning: null,
    prompt: "Are eggs good to eat?",
    decisionContext: "",
    decomposition: {
      caseTitle: "Eggs",
      summary: "Test",
      highlights: [],
      clusters: [],
      axes: [],
      claimTemplate: "Test",
      knownUnknowns: [],
      contextQuestions: [],
    },
    cache: { status: "miss", layer: "d1", createdAt: null, expiresAt: null },
  };
}

test("fallback results are not cached under the primary backend identity", async () => {
  assert.equal(decompositionBackendIsPrimary("Astra · GPT 6 · orchestrated specialists"), true);
  assert.equal(decompositionBackendIsPrimary("OpenRouter · anthropic/claude-opus-4.8 · orchestrated specialists"), false);
  assert.equal(decompositionBackendIsPrimary("Astra · GPT 6 (Astra fallback)"), false);
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /decompositionBackendIsPrimary\(payload\.model\)/);
  const inspector = await readFile(new URL("../app/decompose-live/page.tsx", import.meta.url), "utf8");
  assert.match(inspector, /runHostedDecomposition/);
});

test("decomposition cache identity canonicalizes insignificant whitespace", async () => {
  const base = {
    prompt: "Are eggs good? How can we tell?",
    decisionContext: "",
    model: "anthropic/claude-opus-4.8",
    promptSignature: "prompts-a",
  };
  assert.equal(normalizeDecompositionText("  Are eggs good?\tHow can we tell?  "), "Are eggs good? How can we tell?");
  assert.equal(
    await decompositionCacheEntryKey(base),
    await decompositionCacheEntryKey({
      ...base,
      prompt: "  Are eggs good?\tHow can we tell?  ",
      decisionContext: " ",
      model: ` ${base.model} `,
    }),
  );
  assert.notEqual(
    await decompositionCacheEntryKey(base),
    await decompositionCacheEntryKey({ ...base, decisionContext: "Age: 31" }),
  );
  assert.notEqual(
    await decompositionCacheEntryKey(base),
    await decompositionCacheEntryKey({ ...base, model: "google/gemini-3-pro" }),
  );
  assert.notEqual(
    await decompositionCacheEntryKey(base),
    await decompositionCacheEntryKey({ ...base, promptSignature: "prompts-b" }),
  );
});

test("base and contextualized decompositions coexist in the browser cache", async () => {
  const baseKey = await decompositionCacheEntryKey({
    prompt: "Are eggs good to eat?",
    decisionContext: "",
    model: "anthropic/claude-opus-4.8",
    promptSignature: "prompts-a",
  });
  const contextualKey = await decompositionCacheEntryKey({
    prompt: "Are eggs good to eat?",
    decisionContext: "Age: 31; Location: Kerala",
    model: "anthropic/claude-opus-4.8",
    promptSignature: "prompts-a",
  });
  let store = emptyBrowserDecompositionCache();
  store = upsertBrowserDecompositionCacheEntry(store, {
    key: baseKey,
    savedAt: "2026-07-24T00:00:00.000Z",
    lastAccessedAt: "2026-07-24T00:00:00.000Z",
    result: cachedDecomposition("base"),
  });
  store = upsertBrowserDecompositionCacheEntry(store, {
    key: contextualKey,
    savedAt: "2026-07-24T00:01:00.000Z",
    lastAccessedAt: "2026-07-24T00:01:00.000Z",
    result: { ...cachedDecomposition("contextual"), decisionContext: "Age: 31; Location: Kerala" },
  });
  assert.equal(findBrowserDecompositionCacheEntry(store, baseKey)?.result.caseId, "base");
  assert.equal(findBrowserDecompositionCacheEntry(store, contextualKey)?.result.caseId, "contextual");
  assert.equal(store.entries.length, 2);

  store = upsertBrowserDecompositionCacheEntry(store, {
    key: baseKey,
    savedAt: "2026-07-24T00:02:00.000Z",
    lastAccessedAt: "2026-07-24T00:02:00.000Z",
    result: cachedDecomposition("base-new"),
  });
  assert.equal(store.entries.length, 2);
  assert.equal(findBrowserDecompositionCacheEntry(store, baseKey)?.result.caseId, "base-new");
});

test("browser decomposition cache bounds and validates persisted entries", () => {
  let store = emptyBrowserDecompositionCache();
  for (let index = 0; index <= browserDecompositionCacheLimit; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 6, 24, 0, index)).toISOString();
    store = upsertBrowserDecompositionCacheEntry(store, {
      key: `key-${index}`,
      savedAt: timestamp,
      lastAccessedAt: timestamp,
      result: cachedDecomposition(`case-${index}`),
    });
  }
  assert.equal(store.entries.length, browserDecompositionCacheLimit);
  assert.equal(findBrowserDecompositionCacheEntry(store, "key-0"), null);
  const restored = parseBrowserDecompositionCache(JSON.stringify(store), Date.UTC(2026, 6, 24, 2));
  assert.equal(restored.entries.length, browserDecompositionCacheLimit);
  assert.deepEqual(parseBrowserDecompositionCache("{not json"), emptyBrowserDecompositionCache());
});


test("the dashboard restores disposable UI state and exposes explicit live refresh", async () => {
  const dashboard = await readFile(new URL("../app/research/research-dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /epistack:research-ui-cache:v2/);
  assert.match(dashboard, /briefId/);
  assert.match(dashboard, /window\.localStorage\.getItem\(dashboardCacheKey\)/);
  assert.match(dashboard, /window\.localStorage\.setItem\(dashboardCacheKey/);
  assert.match(dashboard, /Reset browser cache/);
  assert.match(dashboard, /Refresh live/);
  assert.match(dashboard, /Re-extract live/);
  
});
