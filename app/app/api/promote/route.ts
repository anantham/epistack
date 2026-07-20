import { claimFrames } from "../../../data/eggs-result-ledger";
import { ensureEvidenceGraphTables, getD1 } from "../../../db";
import { deepDiveSchema, type DeepDiveSource } from "../../../lib/deep-dive";
import { adversarialReviewSchema, dualReviewPolicyId, reviewDecisionSchema, type SourceArtifact } from "../../../lib/dual-review";
import { researchClaimFrameSchema, type ResearchClaimFrame } from "../../../lib/research-brief";

type PromoteRequest = {
  caseId?: unknown;
  originalPrompt?: unknown;
  compiledQuestion?: unknown;
  source?: unknown;
  candidate?: unknown;
  model?: unknown;
  humanChecked?: unknown;
  reviewMode?: unknown;
  verificationStatus?: unknown;
  artifact?: unknown;
  adversarialReview?: unknown;
  claimFrames?: unknown;
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

  const parsed = deepDiveSchema.safeParse(body.candidate);
  if (!parsed.success) {
    return Response.json({ error: "The proposed extraction no longer matches the canonical result contract." }, { status: 400 });
  }
  const rawSource = body.source as Partial<DeepDiveSource> | null;
  const suppliedClaimFrames = researchClaimFrameSchema.array().min(1).max(7).safeParse(body.claimFrames);
  const promotableClaimFrames: ResearchClaimFrame[] = suppliedClaimFrames.success
    ? suppliedClaimFrames.data
    : claimFrames.map((claim) => ({
        ...claim,
        kind: "effectiveness" as const,
        priority: 3,
        budgetShare: 25,
        decisionLeverage: "Legacy egg fixture claim retained for backward-compatible promotion.",
        axisIds: ["legacy-eggs-fixture"],
        queryUsesAxisIds: ["legacy-eggs-fixture"],
        applicabilityUsesAxisIds: [],
        retrieval: {
          searchQuery: "egg breakfast randomized trial",
          inclusionRule: "Human comparative evidence that directly bears on this scoped egg claim.",
          exclusionSignals: ["No explicit egg exposure or comparator"],
          relaxationOrder: ["Broaden the study duration while preserving exposure and comparator"],
        },
        applicabilityFields: ["population", "exposure", "comparator", "outcome", "time horizon"],
      }));
  const pmid = typeof rawSource?.pmid === "string" ? rawSource.pmid.trim() : "";
  if (!/^\d{5,12}$/.test(pmid) || typeof rawSource?.title !== "string" || typeof rawSource?.url !== "string") {
    return Response.json({ error: "Source provenance is incomplete." }, { status: 400 });
  }
  const autoRequested = body.reviewMode === "adversarial-auto";
  const rawArtifact = body.artifact as Partial<SourceArtifact> | null;
  const reviewEnvelope = body.adversarialReview as {
    policyId?: unknown;
    models?: { primary?: unknown; adversary?: unknown };
    review?: unknown;
    decisions?: unknown;
  } | null;
  const parsedReview = autoRequested ? adversarialReviewSchema.safeParse(reviewEnvelope?.review) : null;
  const parsedDecisions = autoRequested ? reviewDecisionSchema.array().min(1).max(6).safeParse(reviewEnvelope?.decisions) : null;
  const primaryModel = typeof reviewEnvelope?.models?.primary === "string" ? reviewEnvelope.models.primary.trim() : "";
  const adversaryModel = typeof reviewEnvelope?.models?.adversary === "string" ? reviewEnvelope.models.adversary.trim() : "";
  const artifactHash = typeof rawArtifact?.contentHash === "string" ? rawArtifact.contentHash : "";
  const acceptedDecisions = parsedDecisions?.success
    ? parsedDecisions.data.filter((decision) => decision.finalDecision === "promote" && decision.passageFound && decision.promotedResult)
    : [];
  const candidateMatchesAccepted = acceptedDecisions.length === parsed.data.results.length
    && parsed.data.results.every((result) => acceptedDecisions.some((decision) => JSON.stringify(decision.promotedResult) === JSON.stringify(result)));
  const reviewSupportsDecisions = parsedReview?.success === true && parsedDecisions?.success === true
    && parsedReview.data.reviews.length === parsedDecisions.data.length
    && parsedDecisions.data.every((decision) => {
      const review = parsedReview.data.reviews.find((candidate) => candidate.resultIndex === decision.resultIndex);
      if (!review) return false;
      if (decision.finalDecision === "reject") return true;
      return review.verdict !== "reject"
        && review.quoteVerified
        && review.locatorVerified
        && review.scopeVerified
        && review.relationVerified;
    });
  const autoGatePasses = autoRequested
    && reviewEnvelope?.policyId === dualReviewPolicyId
    && body.verificationStatus === "ai-cross-checked-full-text"
    && rawArtifact?.kind === "pmc-jats"
    && /^PMC\d{4,12}$/.test(rawArtifact.pmcid || "")
    && /^[a-f0-9]{64}$/i.test(artifactHash)
    && parsedReview?.success === true
    && parsedDecisions?.success === true
    && parsedReview.data.artifactHash === artifactHash
    && parsedReview.data.independentlyReadFullText
    && parsedReview.data.methodsAndResultsRead
    && primaryModel.length > 0
    && adversaryModel.length > 0
    && primaryModel.toLowerCase() !== adversaryModel.toLowerCase()
    && typeof body.model === "string"
    && body.model.trim() === primaryModel
    && reviewSupportsDecisions
    && candidateMatchesAccepted;

  if (body.humanChecked !== true && !autoGatePasses) {
    return Response.json({
      error: autoRequested
        ? "Automatic promotion failed the declared dual-model full-text policy. The proposal remains reviewable but was not persisted."
        : "A human must explicitly check an abstract-only extraction before promotion.",
    }, { status: 400 });
  }

  try {
    await ensureEvidenceGraphTables();
    const d1 = getD1();
    const now = new Date().toISOString();
    const caseId = typeof body.caseId === "string" && body.caseId.trim() ? safeId(body.caseId) : "eggs-live-mvp";
    const originalPrompt = typeof body.originalPrompt === "string" && body.originalPrompt.trim()
      ? body.originalPrompt.trim()
      : "Are eggs good to eat for my next breakfast decision?";
    const compiledQuestion = typeof body.compiledQuestion === "string" && body.compiledQuestion.trim()
      ? body.compiledQuestion.trim().slice(0, 5_000)
      : null;
    const sourceId = `pubmed-${pmid}`;
    const recordPrefix = `${caseId}-${sourceId}`;
    const studyId = `${recordPrefix}-study`;
    const familyId = `${recordPrefix}-family`;
    const model = typeof body.model === "string" ? body.model : "unspecified-model";
    const candidate = parsed.data;
    const autoPromotion = autoGatePasses;
    const verificationStatus = autoPromotion ? "ai-cross-checked-full-text" : "abstract-only";
    const relationAssessor = autoPromotion ? `${primaryModel}+${adversaryModel}` : "human-checked-ai-extraction";
    const relationStatus = autoPromotion ? "accepted-by-dual-model-review" : "accepted-pending-full-text";
    const usedClaimIds = new Set(candidate.results.map((result) => result.claimFrameId));
    const missingClaimIds = [...usedClaimIds].filter((claimId) => !promotableClaimFrames.some((claim) => claim.id === claimId));
    if (missingClaimIds.length) {
      return Response.json({ error: `The extraction references claim frames absent from the compiled research brief: ${missingClaimIds.join(", ")}.` }, { status: 400 });
    }
    const statements = [
      d1.prepare(`INSERT INTO cases (id, slug, title, original_prompt, active_question, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET original_prompt = excluded.original_prompt, active_question = excluded.active_question, status = excluded.status, updated_at = excluded.updated_at`)
        .bind(caseId, `case-${caseId}`, "Epistack investigation · live MVP", originalPrompt, compiledQuestion, "evidence-promoted", now, now),
      d1.prepare(`INSERT INTO sources (id, canonical_url, doi, pmid, title, authors_json, issued_at, publisher, source_type, csl_json, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, canonical_url = excluded.canonical_url, authors_json = excluded.authors_json, source_type = excluded.source_type, content_hash = excluded.content_hash`)
        .bind(
          sourceId,
          rawSource.url,
          rawSource.doi ?? null,
          pmid,
          rawSource.title,
          JSON.stringify((rawSource.authors || "").split(",").map((name) => name.trim()).filter(Boolean)),
          rawSource.published ?? null,
          rawSource.journal ?? null,
          autoPromotion ? "PMC JATS full text" : "PubMed abstract",
          JSON.stringify({ title: rawSource.title, DOI: rawSource.doi, PMID: pmid }),
          autoPromotion ? artifactHash : null,
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
      const claim = promotableClaimFrames.find((candidateClaim) => candidateClaim.id === claimId);
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
            autoPromotion ? "unknown-from-ai-full-text-extraction" : "unknown-from-abstract",
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
            verificationStatus,
            JSON.stringify({
              extractionModel: model,
              adversarialModel: autoPromotion ? adversaryModel : null,
              policyId: autoPromotion ? dualReviewPolicyId : null,
              sourceArtifact: autoPromotion ? rawArtifact : null,
              extractionCaveat: candidate.extractionCaveat,
              applicability: result.applicability,
            }),
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
            relationAssessor,
            relationStatus,
            now,
          ),
      );
    });

    if (autoPromotion && parsedDecisions?.success) {
      parsedDecisions.data.forEach((decision) => {
        statements.push(
          d1.prepare(`INSERT INTO assessments (id, case_id, target_type, target_id, policy_id, assessor, dimension, score, label, rationale, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET label = excluded.label, rationale = excluded.rationale, status = excluded.status`)
            .bind(
              `${recordPrefix}-adversarial-assessment-${decision.resultIndex + 1}`,
              caseId,
              "extraction-proposal",
              `${recordPrefix}-proposal-${decision.resultIndex + 1}`,
              dualReviewPolicyId,
              adversaryModel,
              "full-text-result-fidelity",
              decision.finalDecision === "promote" ? 1 : 0,
              decision.finalDecision,
              decision.rationale,
              "recorded",
              now,
            ),
        );
      });
    }

    const snapshotId = crypto.randomUUID();
    statements.push(
      d1.prepare(`INSERT INTO snapshots (id, case_id, parent_id, actor, operation, artifact_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          snapshotId,
          caseId,
          null,
          autoPromotion ? "claude-dual-model-policy" : "human-ai-workflow",
          autoPromotion ? "autopromote-full-text-results" : "promote-abstract-results",
          JSON.stringify({ source: rawSource, candidate, claimFrames: promotableClaimFrames, model, artifact: autoPromotion ? rawArtifact : null, adversarialReview: autoPromotion ? reviewEnvelope : null }),
          now,
        ),
    );
    await d1.batch(statements);

    return Response.json({
      caseId,
      sourceId,
      studyId,
      dependenceGroupId: familyId,
      resultCount: candidate.results.length,
      snapshotId,
      status: relationStatus,
    }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The result graph could not be updated." }, { status: 500 });
  }
}
