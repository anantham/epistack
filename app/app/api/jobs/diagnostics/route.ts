import { env } from 'cloudflare:workers';
import { getD1 } from '../../../../db';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
  const expected = (env as unknown as { JOBS_TICK_TOKEN?: string }).JOBS_TICK_TOKEN;
  const authorization = request.headers.get('authorization');
  if (!expected || authorization !== `Bearer ${expected}`) return json({ error: 'Not found.' }, 404);

  const db = getD1();
  const indexes = await db.prepare(`
    SELECT name, tbl_name, sql
    FROM sqlite_master
    WHERE type = 'index'
      AND name IN ('hosted_decomposition_jobs_locked_idx', 'hosted_brief_jobs_locked_idx', 'decomposition_runs_created_idx')
    ORDER BY name
  `).all();

  let migrations: unknown = null;
  let migrationError: string | null = null;
  try {
    migrations = await db.prepare('SELECT * FROM __drizzle_migrations ORDER BY created_at').all();
  } catch (error) {
    migrationError = error instanceof Error ? error.message : 'Migration ledger query failed.';
  }

  return json({ indexes: indexes.results, migrations: migrations && (migrations as { results?: unknown[] }).results, migrationError });
}
