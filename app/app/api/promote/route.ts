import { claimFrames } from "../../../data/eggs-result-ledger";
import { ensureEvidenceGraphTables, getD1 } from "../../../db";
import { deepDiveSchema, type DeepDiveSource } from "../../../lib/deep-dive";

type PromoteRequest = {
  caseId?: unknown;
  originalPrompt?: unknown;
  source?: unknown;
  candidate?: unknown;
  model?: unknown;
  humanChecked?: unknown;
};

function safeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export async function GET(request: Request) {
  try {
    await ensureEvidenceGraphTables();
    const d1 = getD1();
    const requestedCaseId = new URL(request.url).searchParams.get("caseId") || "eggs-live-mvp";
    const caseId = safeId(requestedCaseId);
    const rows = await d1.prepare(`SELECT
        s.pmid, s.title, s.canonical_url AS source_url,
        rr.id AS result_id, rr.result_text, rr.verification_status, rr.locator,
        er.relation, er.scope_match, er.rationale, er.status, er.created_at,
        dg.label AS family_label, dg.reason AS family_reason
      FROM evidence_relations er
      JOIN result_records rr ON rr.id = er.result_id
      JOIN analyses a ON a.id = rr.analysis_id
      JOIN studies st ON st.id = a.study_id
      JOIN sources s ON s.id = st.source_id
      JOIN dependence_groups dg ON dg.id = rr.dependence_group_id
      WHERE er.case_id = ?
      ORDER BY er.created_at DESC`)
      .bind(caseId)
      .all();
    return Response.json({ caseId, records: rows.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The promotion register could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: PromoteRequest;
  try {
    body = await request.json() as PromoteRequest;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (body.humanChecked !== true) {
    return Response.json({ error: "A human must explicitly check the proposed extraction before promotion." }, { status: 400 });
  }
  const parsed = deepDiveSchema.safeParse(body.candidate);
  if (!parsed.success) {
    return Response.json({ error: "The proposed extraction no longer matches the canonical result contract." }, { status: 400 });
  }
  const rawSource = body.source as Partial<DeepDiveSource> | null;
  const pmid = typeof rawSource?.pmid === "string" ? rawSource.pmid.trim() : "";
  if (!/^\d{5,12}$/.test(pmid) || typeof rawSource?.title !== "string" || typeof rawSource?.url !== "string") {
    return Response.json({ error: "Source provenance is incomplete." }, { status: 400 });
  }

  try {
    await ensureEvidenceGraphTables();
    const d1 = getD1();
    const now = new Date().toISOString();
    const caseId = typeof body.caseId === "string" && body.caseId.trim() ? safeId(body.caseId) : "eggs-live-mvp";
    const originalPrompt = typeof body.originalPrompt === "string" && body.originalPrompt.trim()
      ? body.originalPrompt.trim()
      : "Are eggs good to eat for my next breakfast decision?";
    const sourceId = `pubmed-${pmid}`;
    const recordPrefix = `${caseId}-${sourceId}`;
    const studyId = `${recordPrefix}-study`;
    const familyId = `${recordPrefix}-family`;
    const model = typeof body.model === "string" ? body.model : "unspecified-model";
    const candidate = parsed.data;
    const usedClaimIds = new Set(candidate.results.map((result) => result.claimFrameId));
    const statements = [
      d1.prepare(`INSERT INTO cases (id, slug, title, original_prompt, active_question, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`)
        .bind(caseId, `case-${caseId}`, "Egg investigation · live MVP", originalPrompt, null, "evidence-promoted", now, now),
      d1.prepare(`INSERT INTO sources (id, canonical_url, doi, pmid, title, authors_json, issued_at, publisher, source_type, csl_json, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, canonical_url = excluded.canonical_url, authors_json = excluded.authors_json`)
        .bind(
          sourceId,
          rawSource.url,
          rawSource.doi ?? null,
          pmid,
          rawSource.title,
          JSON.stringify((rawSource.authors || "").split(",").map((name) => name.trim()).filter(Boolean)),
          rawSource.published ?? null,
          rawSource.journal ?? null,
          "PubMed abstract",
          JSON.stringify({ title: rawSource.title, DOI: rawSource.doi, PMID: pmid }),
          null,
          now,
        ),
      d1.prepare(`INSERT INTO studies (id, source_id, registration_id, design, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET design = excluded.design, payload_json = excluded.payload_json`)
        .bind(studyId, sourceId, null, candidate.study.design, JSON.stringify(candidate.study), now),
      d1.prepare(`INSERT INTO dependence_groups (id, case_id, label, reason, depends_on_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET label = excluded.label, reason = excluded.reason`)
        .bind(familyId, caseId, candidate.evidenceFamily.label, candidate.evidenceFamily.reason, "[]", now),
    ];

    for (const claimId of usedClaimIds) {
      const claim = claimFrames.find((candidateClaim) => candidateClaim.id === claimId);
      if (!claim) continue;
      statements.push(
        d1.prepare(`INSERT INTO claim_frames (id, case_id, statement, population_json, exposure_json, comparator_json, outcome_json, time_horizon, modality, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET statement = excluded.statement, updated_at = excluded.updated_at`)
          .bind(
            `${caseId}-${claim.id}`,
            caseId,
            claim.statement,
            JSON.stringify({ description: claim.population }),
            JSON.stringify({ description: claim.exposure }),
            JSON.stringify({ description: claim.comparator }),
            JSON.stringify({ description: claim.outcome }),
            claim.timeHorizon,
            claim.modality,
            "active",
            now,
            now,
          ),
      );
    }

    candidate.results.forEach((result, index) => {
      const analysisId = `${recordPrefix}-analysis-${index + 1}`;
      const resultId = `${recordPrefix}-result-${index + 1}`;
      const relationId = `${recordPrefix}-relation-${index + 1}`;
      statements.push(
        d1.prepare(`INSERT INTO analyses (id, study_id, label, analysis_type, population_json, exposure_json, comparator_json, outcome_json, time_horizon, estimand, model_json, multiplicity, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET label = excluded.label, analysis_type = excluded.analysis_type, outcome_json = excluded.outcome_json`)
          .bind(
            analysisId,
            studyId,
            result.analysisLabel,
            result.analysisType,
            JSON.stringify({ description: candidate.study.population }),
            JSON.stringify({ description: candidate.study.exposure }),
            JSON.stringify({ description: candidate.study.comparator }),
            JSON.stringify({ description: result.outcome }),
            result.timeHorizon,
            null,
            "{}",
            "unknown-from-abstract",
            now,
          ),
        d1.prepare(`INSERT INTO result_records (id, analysis_id, dependence_group_id, result_role, result_text, estimate_json, locator, excerpt, verification_status, payload_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET result_text = excluded.result_text, estimate_json = excluded.estimate_json, locator = excluded.locator, excerpt = excluded.excerpt, payload_json = excluded.payload_json`)
          .bind(
            resultId,
            analysisId,
            familyId,
            result.resultRole,
            result.resultText,
            JSON.stringify({ display: result.estimate || null }),
            result.locator,
            result.exactExcerpt || null,
            "abstract-only",
            JSON.stringify({ extractionModel: model, extractionCaveat: candidate.extractionCaveat }),
            now,
          ),
        d1.prepare(`INSERT INTO evidence_relations (id, case_id, result_id, claim_frame_id, relation, scope_match, rationale, assessor, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET relation = excluded.relation, scope_match = excluded.scope_match, rationale = excluded.rationale, status = excluded.status`)
          .bind(
            relationId,
            caseId,
            resultId,
            `${caseId}-${result.claimFrameId}`,
            result.relation,
            result.scopeMatch,
            result.rationale,
            "human-checked-ai-extraction",
            "accepted-pending-full-text",
            now,
          ),
      );
    });

    const snapshotId = crypto.randomUUID();
    statements.push(
      d1.prepare(`INSERT INTO snapshots (id, case_id, parent_id, actor, operation, artifact_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(snapshotId, caseId, null, "human-ai-workflow", "promote-abstract-results", JSON.stringify({ source: rawSource, candidate, model }), now),
    );
    await d1.batch(statements);

    return Response.json({
      caseId,
      sourceId,
      studyId,
      dependenceGroupId: familyId,
      resultCount: candidate.results.length,
      snapshotId,
      status: "accepted-pending-full-text",
    }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The result graph could not be updated." }, { status: 500 });
  }
}
