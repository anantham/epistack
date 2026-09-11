import assert from "node:assert/strict";
import test from "node:test";
import {
  appendDecompositionTelemetryRun,
  emptyDecompositionTelemetry,
  formatDuration,
  parseDecompositionTelemetry,
  summarizeDecompositionTelemetry,
} from "../lib/decomposition-telemetry.ts";

function run(totalMs, stageMs, pass = "initial") {
  return { totalMs, stageMs, pass, backend: "Lyra · test", at: "2026-09-11T00:00:00.000Z" };
}

test("telemetry parsing keeps only well-formed positive runs and rejects noise", () => {
  assert.deepEqual(parseDecompositionTelemetry(null), emptyDecompositionTelemetry);
  assert.deepEqual(parseDecompositionTelemetry("{not json"), emptyDecompositionTelemetry);
  assert.deepEqual(parseDecompositionTelemetry(JSON.stringify({ version: 2, runs: [] })), emptyDecompositionTelemetry);
  const parsed = parseDecompositionTelemetry(JSON.stringify({
    version: 1,
    runs: [run(1000, [300, 300, 400]), { totalMs: -5, stageMs: [] }, { totalMs: 2000 }, run(3000, [])],
  }));
  assert.equal(parsed.runs.length, 2);
  assert.deepEqual(parsed.runs[0].stageMs, [300, 300, 400]);
  assert.deepEqual(parsed.runs[1].stageMs, []);
});

test("telemetry appends runs and bounds the store", () => {
  let store = emptyDecompositionTelemetry;
  for (let index = 0; index < 40; index += 1) store = appendDecompositionTelemetryRun(store, run(1000 + index, [1, 2, 3]));
  assert.equal(store.runs.length, 25);
  assert.equal(store.runs.at(-1).totalMs, 1039);
  assert.equal(appendDecompositionTelemetryRun(store, run(0, [1])).runs.length, 25);
});

test("telemetry summary exposes overall and per-pass medians for empirical ETAs", () => {
  let store = emptyDecompositionTelemetry;
  store = appendDecompositionTelemetryRun(store, run(60_000, [20_000, 20_000, 20_000], "initial"));
  store = appendDecompositionTelemetryRun(store, run(80_000, [30_000, 30_000, 20_000], "initial"));
  store = appendDecompositionTelemetryRun(store, run(40_000, [10_000, 10_000, 20_000], "refine"));
  const summary = summarizeDecompositionTelemetry(store);
  assert.equal(summary.samples, 3);
  assert.equal(summary.totalMedianMs, 60_000);
  assert.deepEqual(summary.stageMediansMs, [20_000, 20_000, 20_000]);
  assert.deepEqual(summary.byPass.initial, { samples: 2, totalMedianMs: 70_000 });
  assert.deepEqual(summary.byPass.refine, { samples: 1, totalMedianMs: 40_000 });
});

test("durations format as tabular minutes and seconds", () => {
  assert.equal(formatDuration(null), "—");
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65_000), "1:05");
  assert.equal(formatDuration(3_599_000), "59:59");
});
