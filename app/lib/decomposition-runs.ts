export type DecompositionRunRow = {
  outcome: string;
  stage: number;
  stage_ms_json: string;
  rate_limits: number;
};

export type DecompositionRunRecord = {
  jobId: string;
  outcome: string;
  stage: number;
  stageMs: number[];
  attempts: number[];
  rateLimits: number;
  effort?: string;
};

function percentile(sorted: number[], point: number): number | null {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((point / 100) * sorted.length) - 1));
  return sorted[index];
}

function parseNumberArray(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number") : [];
  } catch {
    return [];
  }
}

export function summarizeDecompositionRuns(rows: DecompositionRunRow[]) {
  const runs = rows.length;
  const completed = rows.filter((row) => row.outcome === "completed").length;
  const failed = rows.filter((row) => row.outcome === "failed").length;
  const stageCount = rows.reduce((max, row) => Math.max(max, row.stage), 0);
  const perStage: number[][] = Array.from({ length: stageCount }, () => []);
  for (const row of rows) {
    parseNumberArray(row.stage_ms_json).forEach((value, index) => {
      if (value >= 0 && index < stageCount) perStage[index].push(value);
    });
  }
  return {
    runs,
    completed,
    failed,
    successRate: runs ? completed / runs : null,
    totalRateLimits: rows.reduce((sum, row) => sum + (row.rate_limits || 0), 0),
    stages: perStage.map((values) => {
      const sorted = [...values].sort((left, right) => left - right);
      return { count: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
    }),
  };
}

export async function recordDecompositionRun(d1: D1Database, record: DecompositionRunRecord): Promise<void> {
  try {
    await d1.prepare(
      `INSERT INTO decomposition_runs
         (id, job_id, outcome, stage, stage_ms_json, attempts_json, rate_limits, effort, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      record.jobId,
      record.outcome,
      record.stage,
      JSON.stringify(record.stageMs),
      JSON.stringify(record.attempts),
      record.rateLimits,
      record.effort ?? null,
      Date.now(),
    ).run();
  } catch {
    // Cross-run telemetry is an operational aid; it must never fail a run.
  }
}