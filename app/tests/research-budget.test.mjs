import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  addResearchUsage,
  defaultResearchEffortStep,
  emptyResearchUsage,
  modelFamily,
  normalizeModelId,
  normalizeResearchEffortStep,
  parseResearchPreferences,
  remainingRunBudgetUsd,
  researchBudgetProfiles,
  researchEffortSteps,
  researchRunCapUsd,
  runBudgetExhausted,
  usageFromOpenRouter,
} from "../lib/research-budget.ts";
import {
  appendResearchTelemetrySample,
  emptyResearchTelemetry,
  parseResearchTelemetry,
  researchStageEstimate,
} from "../lib/research-telemetry.ts";

test("standard is the default research effort and unknown steps fall back to it", () => {
  assert.equal(defaultResearchEffortStep, "standard");
  assert.equal(normalizeResearchEffortStep("bogus"), "standard");
  assert.equal(normalizeResearchEffortStep(" Thorough "), "thorough");
});

test("every effort step caps web search, and the caps grow with effort", () => {
  let previousUses = 0;
  for (const step of researchEffortSteps) {
    const { webSearch } = researchBudgetProfiles[step];
    assert.ok(webSearch.max_uses >= 1 && webSearch.max_results >= 1);
    assert.ok(webSearch.max_total_results >= webSearch.max_results);
    assert.ok(webSearch.max_uses > previousUses);
    previousUses = webSearch.max_uses;
  }
});

test("model ids must be provider/model slugs", () => {
  assert.equal(normalizeModelId(" deepseek/deepseek-v4.1-flash "), "deepseek/deepseek-v4.1-flash");
  assert.equal(normalizeModelId("openai/gpt-4o-mini"), "openai/gpt-4o-mini");
  for (const invalid of ["", "gpt-4o", "openai/gpt 4o", `openai/${"x".repeat(160)}`, 42]) {
    assert.equal(normalizeModelId(invalid), undefined);
  }
  assert.equal(modelFamily("anthropic/claude-opus-4.8"), "anthropic");
});

test("saved research preferences keep only valid models", () => {
  const preferences = parseResearchPreferences(JSON.stringify({
    effort: "quick",
    models: { search: "openai/gpt-5.2", reader: "not a model", reviewer: "openai/gpt-4o-mini" },
  }));
  assert.deepEqual(preferences, { effort: "quick", models: { search: "openai/gpt-5.2", reviewer: "openai/gpt-4o-mini" } });
  assert.deepEqual(parseResearchPreferences("{broken"), { effort: "standard", models: {} });
});

test("OpenRouter usage accounting sums into a run total", () => {
  const first = usageFromOpenRouter({ cost: 0.021, prompt_tokens: 12_000, completion_tokens: 900, server_tool_use: { web_search_requests: 3 } });
  const second = usageFromOpenRouter({ cost: "not a number" });
  const total = addResearchUsage(addResearchUsage(emptyResearchUsage, first), second);
  assert.deepEqual(total, { calls: 2, costUsd: 0.021, webSearchRequests: 3, promptTokens: 12_000, completionTokens: 900 });
});

test("every run gets the same five-dollar cap", () => {
  assert.equal(researchRunCapUsd, 5);
  assert.equal(remainingRunBudgetUsd(1.25), 3.75);
  assert.equal(remainingRunBudgetUsd(7), 0);
  assert.equal(runBudgetExhausted(4.99), false);
  assert.equal(runBudgetExhausted(5), true);
});

test("stage estimates use timed runs and stay provisional until enough samples exist", () => {
  let store = emptyResearchTelemetry;
  const untimed = researchStageEstimate(store, "recall", "standard");
  assert.equal(untimed.samples, 0);
  assert.equal(untimed.provisional, true);
  assert.ok(untimed.estimateMs > 0);
  for (const totalMs of [40_000, 60_000, 50_000]) {
    store = appendResearchTelemetrySample(store, {
      stage: "recall",
      effort: "standard",
      model: "OpenRouter · deepseek/deepseek-v4.1-flash",
      totalMs,
      costUsd: 0.02,
      at: "2026-09-14T00:00:00.000Z",
    });
  }
  const timed = researchStageEstimate(store, "recall", "standard");
  assert.deepEqual([timed.samples, timed.estimateMs, timed.provisional], [3, 50_000, false]);
  assert.equal(parseResearchTelemetry(JSON.stringify(store)).samples.length, 3);
  assert.deepEqual(parseResearchTelemetry("{broken"), emptyResearchTelemetry);
});

test("hosted recall never sends an uncapped web search tool", async () => {
  const recall = await readFile(new URL("../app/api/recall/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(recall, /tools: \[\{ type: "openrouter:web_search" \}\]/);
  assert.match(recall, /type: "openrouter:web_search", parameters:/);
});
