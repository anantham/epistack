import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getD1() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure the DB binding or export the artifact as JSON.",
    );
  }
  return env.DB;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}

let snapshotTablesEnsured: Promise<void> | null = null;

export function ensureSnapshotTables(): Promise<void> {
  snapshotTablesEnsured ??= runSnapshotTables().catch((error) => {
    snapshotTablesEnsured = null;
    throw error;
  });
  return snapshotTablesEnsured;
}

async function runSnapshotTables() {
  const d1 = getD1();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      original_prompt TEXT NOT NULL,
      active_question TEXT,
      status TEXT NOT NULL DEFAULT 'framing',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS cases_slug_idx ON cases (slug)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id),
      parent_id TEXT,
      actor TEXT NOT NULL,
      operation TEXT NOT NULL,
      artifact_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS snapshots_case_idx ON snapshots (case_id)"),
  ]);
}

let evidenceGraphTablesEnsured: Promise<void> | null = null;

export function ensureEvidenceGraphTables(): Promise<void> {
  evidenceGraphTablesEnsured ??= runEvidenceGraphTables().catch((error) => {
    evidenceGraphTablesEnsured = null;
    throw error;
  });
  return evidenceGraphTablesEnsured;
}

async function runEvidenceGraphTables() {
  await ensureSnapshotTables();
  const d1 = getD1();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      canonical_url TEXT,
      doi TEXT,
      pmid TEXT,
      title TEXT NOT NULL,
      authors_json TEXT NOT NULL DEFAULT '[]',
      issued_at TEXT,
      publisher TEXT,
      source_type TEXT NOT NULL,
      csl_json TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT,
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS claim_frames (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id),
      statement TEXT NOT NULL,
      population_json TEXT NOT NULL DEFAULT '{}',
      exposure_json TEXT NOT NULL DEFAULT '{}',
      comparator_json TEXT NOT NULL DEFAULT '{}',
      outcome_json TEXT NOT NULL DEFAULT '{}',
      time_horizon TEXT,
      modality TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS studies (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id),
      registration_id TEXT,
      design TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL REFERENCES studies(id),
      label TEXT NOT NULL,
      analysis_type TEXT NOT NULL,
      population_json TEXT NOT NULL DEFAULT '{}',
      exposure_json TEXT NOT NULL DEFAULT '{}',
      comparator_json TEXT NOT NULL DEFAULT '{}',
      outcome_json TEXT NOT NULL DEFAULT '{}',
      time_horizon TEXT,
      estimand TEXT,
      model_json TEXT NOT NULL DEFAULT '{}',
      multiplicity TEXT NOT NULL DEFAULT 'unknown',
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS dependence_groups (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id),
      label TEXT NOT NULL,
      reason TEXT NOT NULL,
      depends_on_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS result_records (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL REFERENCES analyses(id),
      dependence_group_id TEXT NOT NULL REFERENCES dependence_groups(id),
      result_role TEXT NOT NULL,
      result_text TEXT NOT NULL,
      estimate_json TEXT NOT NULL DEFAULT '{}',
      locator TEXT NOT NULL,
      excerpt TEXT,
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS evidence_relations (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id),
      result_id TEXT NOT NULL REFERENCES result_records(id),
      claim_frame_id TEXT NOT NULL REFERENCES claim_frames(id),
      relation TEXT NOT NULL,
      scope_match TEXT NOT NULL,
      rationale TEXT NOT NULL,
      assessor TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id),
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      assessor TEXT NOT NULL,
      dimension TEXT NOT NULL,
      score REAL,
      label TEXT,
      rationale TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS assessments_target_idx ON assessments (target_type, target_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS assessments_policy_idx ON assessments (policy_id)"),
  ]);
}

let decisionTablesEnsured: Promise<void> | null = null;

export function ensureDecisionTables(): Promise<void> {
  decisionTablesEnsured ??= runDecisionTables().catch((error) => {
    decisionTablesEnsured = null;
    throw error;
  });
  return decisionTablesEnsured;
}

async function runDecisionTables() {
  await ensureEvidenceGraphTables();
  const d1 = getD1();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS decision_episodes (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id),
      question TEXT NOT NULL,
      target_context_json TEXT NOT NULL DEFAULT '{}',
      constraints_json TEXT NOT NULL DEFAULT '{}',
      values_json TEXT NOT NULL DEFAULT '{}',
      graph_snapshot_id TEXT REFERENCES snapshots(id),
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS decision_episodes_case_idx ON decision_episodes (case_id)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS decision_options (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL REFERENCES decision_episodes(id),
      label TEXT NOT NULL,
      action_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'candidate',
      created_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS decision_options_decision_idx ON decision_options (decision_id)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS decision_outcomes (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL REFERENCES decision_episodes(id),
      label TEXT NOT NULL,
      measure TEXT,
      importance REAL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS decision_outcomes_decision_idx ON decision_outcomes (decision_id)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS protocols (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL REFERENCES decision_episodes(id),
      option_id TEXT REFERENCES decision_options(id),
      title TEXT NOT NULL,
      protocol_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS protocols_decision_idx ON protocols (decision_id)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      protocol_id TEXT NOT NULL REFERENCES protocols(id),
      source_id TEXT REFERENCES sources(id),
      observed_at TEXT NOT NULL,
      measure TEXT NOT NULL,
      value_json TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      missingness TEXT,
      sharing TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS observations_protocol_idx ON observations (protocol_id)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS update_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      source_url TEXT,
      scope TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      review_status TEXT NOT NULL DEFAULT 'queued',
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS update_events_target_idx ON update_events (target_type, target_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS update_events_review_idx ON update_events (review_status)"),
  ]);
}

let hostedJobTablesEnsured: Promise<void> | null = null;

export function ensureHostedJobTables(): Promise<void> {
  hostedJobTablesEnsured ??= runHostedJobTables().catch((error) => {
    hostedJobTablesEnsured = null;
    throw error;
  });
  return hostedJobTablesEnsured;
}

async function runHostedJobTables() {
  const d1 = getD1();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS hosted_decomposition_jobs (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      state_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS hosted_decomposition_jobs_locked_idx ON hosted_decomposition_jobs (locked_until)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS hosted_brief_jobs (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      state_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS hosted_brief_jobs_locked_idx ON hosted_brief_jobs (locked_until)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS decomposition_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      stage INTEGER NOT NULL,
      stage_ms_json TEXT NOT NULL DEFAULT '[]',
      attempts_json TEXT NOT NULL DEFAULT '[]',
      rate_limits INTEGER NOT NULL DEFAULT 0,
      effort TEXT,
      created_at INTEGER NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS decomposition_runs_created_idx ON decomposition_runs (created_at)"),
  ]);
}
