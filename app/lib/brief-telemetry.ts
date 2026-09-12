export const briefTelemetryStorageKey = "epistack:brief-telemetry:v1";

const briefTelemetryRunLimit = 25;

export type BriefTelemetryRun = {
  totalMs: number;
  effort: string;
  at: string;
};

export type BriefTelemetry = {
  version: 1;
  runs: BriefTelemetryRun[];
};

export type BriefTelemetrySummary = {
  samples: number;
  totalMedianMs: number | null;
  byEffort: Record<string, { samples: number; totalMedianMs: number | null }>;
};

export const emptyBriefTelemetry: BriefTelemetry = { version: 1, runs: [] };

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseBriefTelemetry(raw: string | null): BriefTelemetry {
  try {
    const parsed = JSON.parse(raw || "null") as Partial<BriefTelemetry> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.runs)) return emptyBriefTelemetry;
    const runs = parsed.runs
      .filter((run): run is BriefTelemetryRun => Boolean(run) && finitePositive(run.totalMs) && typeof run.effort === "string")
      .map((run) => ({ totalMs: run.totalMs, effort: run.effort, at: typeof run.at === "string" ? run.at : "" }))
      .slice(-briefTelemetryRunLimit);
    return { version: 1, runs };
  } catch {
    return emptyBriefTelemetry;
  }
}

export function appendBriefTelemetryRun(store: BriefTelemetry, run: BriefTelemetryRun): BriefTelemetry {
  if (!finitePositive(run.totalMs)) return store;
  const normalized: BriefTelemetryRun = { totalMs: run.totalMs, effort: run.effort || "instant", at: run.at };
  return { version: 1, runs: [...store.runs, normalized].slice(-briefTelemetryRunLimit) };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeBriefTelemetry(store: BriefTelemetry): BriefTelemetrySummary {
  const totals = store.runs.map((run) => run.totalMs).filter(finitePositive);
  const byEffort: BriefTelemetrySummary["byEffort"] = {};
  for (const run of store.runs) {
    const effort = run.effort || "instant";
    if (!byEffort[effort]) byEffort[effort] = { samples: 0, totalMedianMs: null };
    byEffort[effort].samples += 1;
  }
  for (const effort of Object.keys(byEffort)) {
    const effortTotals = store.runs.filter((run) => (run.effort || "instant") === effort).map((run) => run.totalMs).filter(finitePositive);
    byEffort[effort].totalMedianMs = median(effortTotals);
  }
  return { samples: totals.length, totalMedianMs: median(totals), byEffort };
}
