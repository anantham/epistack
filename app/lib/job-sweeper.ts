import { getD1 } from "../db";

type DueJob = { id: string; token: string; origin: string | null };
type JobProgress = { status?: string; nextAt?: number; code?: string };

const dueJobsLimitPerSweep = 4;
const perJobBudgetMs = 20_000;
const pollDelayMs = 4_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Drive one stranded job as far as it will go inside a bounded budget. Each
// iteration re-issues the exact POST a polling client would send; the route's
// locked_until lease keeps this from racing a live client or another sweep.
async function driveJob(origin: string, path: string, id: string, token: string): Promise<void> {
  const deadline = Date.now() + perJobBudgetMs;
  while (Date.now() < deadline) {
    let progress: JobProgress | null = null;
    try {
      const response = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ id, token }),
        signal: AbortSignal.timeout(25_000),
      });
      progress = await response.json().catch(() => null);
    } catch {
      return;
    }
    if (!progress) return;
    if (progress.status === "completed" || progress.status === "failed") return;
    if (progress.code === "backend-unreachable") return;
    if (progress.status === "in_progress") {
      await sleep(pollDelayMs);
      continue;
    }
    if (progress.status === "queued") {
      if (typeof progress.nextAt === "number" && progress.nextAt > Date.now()) return;
      continue;
    }
    return;
  }
}

async function sweepTable(table: string, path: string): Promise<void> {
  const d1 = getD1();
  const now = Date.now();
  const rows = await d1.prepare(
    `SELECT id, token, json_extract(state_json, '$.origin') AS origin
       FROM ${table}
      WHERE locked_until < ?
        AND json_extract(state_json, '$.status') NOT IN ('completed', 'failed', 'submitting')
        AND COALESCE(json_extract(state_json, '$.nextAt'), 0) <= ?
      ORDER BY created_at ASC
      LIMIT ?`,
  ).bind(now, now, dueJobsLimitPerSweep).all<DueJob>();

  await Promise.all((rows.results ?? []).map((row) => {
    if (!row.origin || !/^https?:\/\//i.test(row.origin)) return Promise.resolve();
    return driveJob(row.origin.replace(/\/$/, ""), path, row.id, row.token);
  }));
}

export async function sweepHostedJobs(): Promise<void> {
  await Promise.all([
    sweepTable("hosted_decomposition_jobs", "/api/decompose-live"),
    sweepTable("hosted_brief_jobs", "/api/compile-brief"),
  ]);
}