import { env } from 'cloudflare:workers';
import { getD1 } from '../../../../db';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const expectedTables = ['analyses', 'assessments', 'beliefs', 'cases', 'claim_frames', 'decision_episodes', 'decision_options', 'decision_outcomes', 'dependence_groups', 'edges', 'evidence_items', 'evidence_relations', 'nodes', 'observations', 'operation_cache', 'protocols', 'result_records', 'snapshots', 'sources', 'studies', 'update_events'];
const migrations = [
  { hash: '0553b82648856b9b1f02d76b822a741f688b80d5f7f900e35f04716a96088f22', createdAt: 1784444060602 },
  { hash: '37e294c054dae4e3d340a08b380a239df8b6a47d1e7b634f9173e21509491288', createdAt: 1784475241982 },
  { hash: '0f000ab4de4fd4478f186100e9b1364bdd70c1ba98249138144bbcb50c6818e4', createdAt: 1784505637914 },
  { hash: 'e193b17106d96e66404eed8ddd782e4c2d35f2dec18c8e6f098e308ba8a16692', createdAt: 1789280187699 },
  { hash: 'bcba714858452d0be70868c2591d416b30d5a954260b84b8065e55076f606e6c', createdAt: 1789282404220 },
];

function authorized(request: Request) {
  const expected = (env as unknown as { JOBS_TICK_TOKEN?: string }).JOBS_TICK_TOKEN;
  return Boolean(expected && request.headers.get('authorization') === `Bearer ${expected}`);
}

export async function POST(request: Request) {
  if (!authorized(request)) return json({ error: 'Not found.' }, 404);
  const db = getD1();
  await db.prepare('CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)').run();
  const existing = await db.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all<{ hash: string; created_at: number }>();
  const existingHashes = new Set((existing.results ?? []).map(row => row.hash));

  const tableRows = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${expectedTables.map(() => '?').join(',')})`).bind(...expectedTables).all<{ name: string }>();
  const presentTables = new Set((tableRows.results ?? []).map(row => row.name));
  const missingTables = expectedTables.filter(name => !presentTables.has(name));
  if (missingTables.length) return json({ error: 'Existing schema is incomplete; refusing to baseline migration history.', missingTables }, 409);

  const statements = [
    'CREATE TABLE IF NOT EXISTS `hosted_brief_jobs` (`id` text PRIMARY KEY NOT NULL, `token` text NOT NULL, `state_json` text NOT NULL, `created_at` integer NOT NULL, `locked_until` integer DEFAULT 0 NOT NULL)',
    'CREATE INDEX IF NOT EXISTS `hosted_brief_jobs_locked_idx` ON `hosted_brief_jobs` (`locked_until`)',
    'CREATE TABLE IF NOT EXISTS `hosted_decomposition_jobs` (`id` text PRIMARY KEY NOT NULL, `token` text NOT NULL, `state_json` text NOT NULL, `created_at` integer NOT NULL, `locked_until` integer DEFAULT 0 NOT NULL)',
    'CREATE INDEX IF NOT EXISTS `hosted_decomposition_jobs_locked_idx` ON `hosted_decomposition_jobs` (`locked_until`)',
    'CREATE TABLE IF NOT EXISTS `decomposition_runs` (`id` text PRIMARY KEY NOT NULL, `job_id` text NOT NULL, `outcome` text NOT NULL, `stage` integer NOT NULL, `stage_ms_json` text DEFAULT \'[]\' NOT NULL, `attempts_json` text DEFAULT \'[]\' NOT NULL, `rate_limits` integer DEFAULT 0 NOT NULL, `effort` text, `created_at` integer NOT NULL)',
    'CREATE INDEX IF NOT EXISTS `decomposition_runs_created_idx` ON `decomposition_runs` (`created_at`)',
  ];
  await db.batch(statements.map(statement => db.prepare(statement)));
  const missingMigrations = migrations.filter(migration => !existingHashes.has(migration.hash));
  if (missingMigrations.length) {
    await db.batch(missingMigrations.map(migration => db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').bind(migration.hash, migration.createdAt)));
  }
  const rows = await db.prepare('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at').all();
  return json({ applied: missingMigrations.map(migration => migration.hash), baselineVerified: true, migrations: rows.results });
}
