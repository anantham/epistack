import { env } from "cloudflare:workers";
import { sweepHostedJobs } from "../../../../lib/job-sweeper";

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

// Operational fallback for the scheduled sweep. Hidden unless JOBS_TICK_TOKEN
// is configured, and never advances specific jobs on behalf of a caller.
export async function POST(request: Request) {
  const expected = (env as unknown as { JOBS_TICK_TOKEN?: string }).JOBS_TICK_TOKEN;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || provided !== expected) return json({ error: "Not found." }, 404);
  await sweepHostedJobs();
  return json({ ok: true });
}