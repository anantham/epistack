export const decompositionTelemetryStorageKey = "epistack:decomposition-telemetry:v1";

const telemetryRunLimit = 25;

export type DecompositionPass = "initial" | "refine";

export type DecompositionTelemetryRun = {
  totalMs: number;
  stageMs: number[];
  pass: DecompositionPass;
  backend: string;
  at: string;
  effort: string;
};

export type DecompositionTelemetry = {
  version: 1;
  runs: DecompositionTelemetryRun[];
};

export type DecompositionTelemetrySummary = {
  samples: number;
  totalMedianMs: number | null;
  stageMediansMs: Array<number | null>;
  byPass: Record<DecompositionPass, { samples: number; totalMedianMs: number | null }>;
  byEffort: Record<string, { samples: number; totalMedianMs: number | null; stageMediansMs: Array<number | null> }>;
};

export const emptyDecompositionTelemetry: DecompositionTelemetry = { version: 1, runs: [] };

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPass(value: unknown): value is DecompositionPass {
  return value === "initial" || value === "refine";
}

function normalizeEffort(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "instant";
}

export function parseDecompositionTelemetry(raw: string | null): DecompositionTelemetry {
  try {
    const parsed = JSON.parse(raw || "null") as Partial<DecompositionTelemetry> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.runs)) return emptyDecompositionTelemetry;
    const runs = parsed.runs
      .filter((run): run is DecompositionTelemetryRun => Boolean(run) && finitePositive(run.totalMs) && Array.isArray(run.stageMs))
      .map((run) => ({
        totalMs: run.totalMs,
        stageMs: run.stageMs.filter(finitePositive),
        pass: isPass(run.pass) ? run.pass : "initial",
        backend: typeof run.backend === "string" ? run.backend : "unknown",
        at: typeof run.at === "string" ? run.at : "",
        effort: normalizeEffort(run.effort),
      }))
      .slice(-telemetryRunLimit);
    return { version: 1, runs };
  } catch {
    return emptyDecompositionTelemetry;
  }
}

export function appendDecompositionTelemetryRun(store: DecompositionTelemetry, run: DecompositionTelemetryRun): DecompositionTelemetry {
  if (!finitePositive(run.totalMs)) return store;
  const normalized: DecompositionTelemetryRun = {
    totalMs: run.totalMs,
    stageMs: run.stageMs.filter(finitePositive),
    pass: isPass(run.pass) ? run.pass : "initial",
    backend: run.backend,
    at: run.at,
    effort: normalizeEffort(run.effort),
  };
  return { version: 1, runs: [...store.runs, normalized].slice(-telemetryRunLimit) };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function stageMediansMs(runs: DecompositionTelemetryRun[]): Array<number | null> {
  const stageCount = runs.reduce((max, run) => Math.max(max, run.stageMs.length), 0);
  return Array.from({ length: stageCount }, (_, index) => (
    median(runs.map((run) => run.stageMs[index]).filter(finitePositive))
  ));
}

export function summarizeDecompositionTelemetry(store: DecompositionTelemetry): DecompositionTelemetrySummary {
  const totals = store.runs.map((run) => run.totalMs).filter(finitePositive);
  const stageMedians = stageMediansMs(store.runs);
  const byPass: DecompositionTelemetrySummary["byPass"] = {
    initial: { samples: 0, totalMedianMs: null },
    refine: { samples: 0, totalMedianMs: null },
  };
  for (const pass of ["initial", "refine"] as const) {
    const passTotals = store.runs.filter((run) => run.pass === pass).map((run) => run.totalMs).filter(finitePositive);
    byPass[pass] = { samples: passTotals.length, totalMedianMs: median(passTotals) };
  }
  const effortGroups = new Map<string, DecompositionTelemetryRun[]>();
  for (const run of store.runs) {
    const effort = normalizeEffort(run.effort);
    const group = effortGroups.get(effort);
    if (group) group.push(run);
    else effortGroups.set(effort, [run]);
  }
  const byEffort: DecompositionTelemetrySummary["byEffort"] = {};
  for (const [effort, runs] of effortGroups) {
    const effortTotals = runs.map((run) => run.totalMs).filter(finitePositive);
    byEffort[effort] = { samples: effortTotals.length, totalMedianMs: median(effortTotals), stageMediansMs: stageMediansMs(runs) };
  }
  return { samples: totals.length, totalMedianMs: median(totals), stageMediansMs: stageMedians, byPass, byEffort };
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
