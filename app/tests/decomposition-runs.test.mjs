import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDecompositionRuns } from "../lib/decomposition-runs.ts";

test("summarizes stage latency, success rate, and rate limits across runs", () => {
  const summary = summarizeDecompositionRuns([
    { outcome: "completed", stage: 3, stage_ms_json: "[100,200,300]", rate_limits: 0 },
    { outcome: "completed", stage: 3, stage_ms_json: "[300,400,500]", rate_limits: 2 },
    { outcome: "failed", stage: 1, stage_ms_json: "[50]", rate_limits: 1 },
  ]);
  assert.equal(summary.runs, 3);
  assert.equal(summary.completed, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.successRate, 2 / 3);
  assert.equal(summary.totalRateLimits, 3);
  assert.equal(summary.stages[0].count, 3);
  assert.equal(summary.stages[0].p50, 100);
  assert.equal(summary.stages[0].p95, 300);
  assert.equal(summary.stages[2].count, 2);
});

test("an empty run set degrades to nulls rather than throwing", () => {
  const summary = summarizeDecompositionRuns([]);
  assert.equal(summary.runs, 0);
  assert.equal(summary.successRate, null);
  assert.deepEqual(summary.stages, []);
});