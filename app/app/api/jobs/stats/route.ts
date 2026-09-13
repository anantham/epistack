import { env } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import { summarizeDecompositionRuns, type DecompositionRunRow } from "../../../../lib/decomposition-runs";

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

// Aggregate stage latency/success across runs. Hidden unless JOBS_TICK_TOKEN
// is configured, matching the manual sweep endpoint's guard.
export async function GET(request: Request) {
  const expected = (env as unknown as { JOBS_TICK_TOKEN?: string }).JOBS_TICK_TOKEN;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || provided !== expected) return json({ error: "Not found." }, 404);
  const d1 = getD1();
  const rows = await d1.prepare(
    `SELECT outcome, stage, stage_ms_json, rate_limits FROM decomposition_runs ORDER BY created_at DESC LIMIT 500`,
  ).all<DecompositionRunRow>();
  return json(summarizeDecompositionRuns(rows.results ?? []));
}