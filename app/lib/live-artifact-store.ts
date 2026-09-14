import { ensureEvidenceGraphTables, getD1 } from "../db";
import {
  normalizeLiveArtifact,
  type LiveArtifact,
  type RawAnalysisRow,
  type RawCaseRow,
  type RawClaimFrameRow,
  type RawDecisionRow,
  type RawDependenceGroupRow,
  type RawEvidenceRelationRow,
  type RawResultRow,
  type RawSnapshotRow,
  type RawSourceRow,
  type RawStudyRow,
} from "./live-artifact";

const acceptedRelationFilter = "er.status IN ('accepted-by-dual-model-review', 'accepted-human-verified-full-text')";

function resultRows<T>(result: { results?: unknown[] }): T[] {
  return Array.isArray(result.results) ? result.results as T[] : [];
}

export function isD1Unavailable(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /D1 binding [`']?DB[`']? is unavailable/i.test(message)
    || /binding.*DB.*unavailable/i.test(message);
}

/**
 * Read the accepted graph directly from the canonical D1 records. Consumers
 * such as synthesis receive the same normalized contract as the artifact UI;
 * they cannot smuggle browser-authored evidence into the decision layer.
 */
export async function readLiveArtifact(caseId: string): Promise<LiveArtifact> {
  await ensureEvidenceGraphTables();
  const d1 = getD1();
  const prepared = [
    d1.prepare("SELECT * FROM cases WHERE id = ? LIMIT 1").bind(caseId),
    d1.prepare("SELECT * FROM claim_frames WHERE case_id = ? ORDER BY created_at, id").bind(caseId),
    d1.prepare(`SELECT DISTINCT s.*
      FROM sources s
      JOIN studies st ON st.source_id = s.id
      JOIN analyses a ON a.study_id = st.id
      JOIN result_records rr ON rr.analysis_id = a.id
      JOIN evidence_relations er ON er.result_id = rr.id
      WHERE er.case_id = ? AND ${acceptedRelationFilter}
      ORDER BY s.created_at, s.id`).bind(caseId),
    d1.prepare(`SELECT DISTINCT st.*
      FROM studies st
      JOIN analyses a ON a.study_id = st.id
      JOIN result_records rr ON rr.analysis_id = a.id
      JOIN evidence_relations er ON er.result_id = rr.id
      WHERE er.case_id = ? AND ${acceptedRelationFilter}
      ORDER BY st.created_at, st.id`).bind(caseId),
    d1.prepare(`SELECT DISTINCT a.*
      FROM analyses a
      JOIN result_records rr ON rr.analysis_id = a.id
      JOIN evidence_relations er ON er.result_id = rr.id
      WHERE er.case_id = ? AND ${acceptedRelationFilter}
      ORDER BY a.created_at, a.id`).bind(caseId),
    d1.prepare(`SELECT DISTINCT rr.*
      FROM result_records rr
      JOIN evidence_relations er ON er.result_id = rr.id
      WHERE er.case_id = ? AND ${acceptedRelationFilter}
      ORDER BY rr.created_at, rr.id`).bind(caseId),
    d1.prepare(`SELECT er.*
      FROM evidence_relations er
      WHERE er.case_id = ? AND ${acceptedRelationFilter}
      ORDER BY er.created_at, er.id`).bind(caseId),
    d1.prepare(`SELECT DISTINCT dg.*
      FROM dependence_groups dg
      JOIN result_records rr ON rr.dependence_group_id = dg.id
      JOIN evidence_relations er ON er.result_id = rr.id
      WHERE er.case_id = ? AND ${acceptedRelationFilter}
      ORDER BY dg.created_at, dg.id`).bind(caseId),
    d1.prepare("SELECT id, parent_id, actor, operation, artifact_json, created_at FROM snapshots WHERE case_id = ? ORDER BY created_at DESC, id DESC LIMIT 1").bind(caseId),
    d1.prepare(`SELECT id, parent_id, actor, operation, created_at
      FROM snapshots
      WHERE case_id = ? AND operation IN ('autopromote-full-text-results', 'promote-human-verified-full-text')
      ORDER BY created_at DESC, id DESC LIMIT 1`).bind(caseId),
    d1.prepare(`SELECT id, parent_id, actor, operation, artifact_json, created_at
      FROM snapshots
      WHERE case_id = ? AND json_extract(artifact_json, '$.researchBrief') IS NOT NULL
      ORDER BY created_at DESC, id DESC LIMIT 1`).bind(caseId),
    d1.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'decision_episodes' LIMIT 1"),
  ];
  const queryResults = await d1.batch(prepared);
  const decisionTableExists = resultRows<{ name: string }>(queryResults[11]).length > 0;
  let latestDecision: RawDecisionRow | null = null;
  if (decisionTableExists) {
    const decisionResult = await d1.prepare(`SELECT
        de.id, de.question, de.graph_snapshot_id, de.status, de.created_at, de.updated_at,
        basis.operation AS basis_operation, basis.artifact_json AS basis_artifact_json
      FROM decision_episodes de
      LEFT JOIN snapshots basis ON basis.id = de.graph_snapshot_id
      WHERE de.case_id = ?
      ORDER BY de.created_at DESC,
        CASE de.status WHEN 'recorded' THEN 0 WHEN 'stale' THEN 1 WHEN 'draft' THEN 2 WHEN 'superseded' THEN 3 ELSE 2 END,
        de.id DESC LIMIT 1`).bind(caseId).all();
    latestDecision = resultRows<RawDecisionRow>(decisionResult)[0] || null;
  }

  return normalizeLiveArtifact(caseId, {
    caseRecord: resultRows<RawCaseRow>(queryResults[0])[0] || null,
    claimFrames: resultRows<RawClaimFrameRow>(queryResults[1]),
    sources: resultRows<RawSourceRow>(queryResults[2]),
    studies: resultRows<RawStudyRow>(queryResults[3]),
    analyses: resultRows<RawAnalysisRow>(queryResults[4]),
    results: resultRows<RawResultRow>(queryResults[5]),
    evidenceRelations: resultRows<RawEvidenceRelationRow>(queryResults[6]),
    dependenceGroups: resultRows<RawDependenceGroupRow>(queryResults[7]),
    latestSnapshot: resultRows<RawSnapshotRow>(queryResults[8])[0] || null,
    latestEvidenceSnapshot: resultRows<RawSnapshotRow>(queryResults[9])[0] || null,
    latestContractSnapshot: resultRows<RawSnapshotRow>(queryResults[10])[0] || null,
    latestDecision,
  });
}
