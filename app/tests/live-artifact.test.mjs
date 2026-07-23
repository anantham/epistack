import assert from "node:assert/strict";
import test from "node:test";
import {
  liveArtifactSchema,
  normalizeLiveArtifact,
} from "../lib/live-artifact.ts";

const t0 = "2026-07-20T10:00:00.000Z";
const t1 = "2026-07-21T10:00:00.000Z";
const t2 = "2026-07-22T10:00:00.000Z";

function fixture(overrides = {}) {
  return {
    caseRecord: {
      id: "case-eggs",
      slug: "case-eggs",
      title: "Egg decision",
      original_prompt: "Are eggs good to eat?",
      active_question: "Should I eat two eggs at breakfast?",
      status: "evidence-promoted",
      created_at: t0,
      updated_at: t1,
    },
    claimFrames: [
      {
        id: "claim-satiety",
        case_id: "case-eggs",
        statement: "Egg breakfasts improve satiety relative to the realistic comparator.",
        population_json: '{"description":"resistance-trained adults"}',
        exposure_json: '{"description":"two eggs"}',
        comparator_json: '{"description":"current breakfast"}',
        outcome_json: '{"description":"satiety"}',
        time_horizon: "one week",
        modality: "empirical",
        status: "active",
        created_at: t0,
        updated_at: t0,
      },
      {
        id: "claim-lipids",
        case_id: "case-eggs",
        statement: "The substitution does not cause an unacceptable lipid response.",
        population_json: "{}",
        exposure_json: "{}",
        comparator_json: "{}",
        outcome_json: "{}",
        time_horizon: "one week",
        modality: "empirical",
        status: "active",
        created_at: t0,
        updated_at: t0,
      },
    ],
    sources: [
      {
        id: "source-1",
        canonical_url: "https://example.test/paper",
        doi: "10.1/example",
        pmid: "12345",
        title: "Egg breakfast trial",
        authors_json: '["A. Researcher"]',
        issued_at: "2025",
        publisher: "Example Journal",
        source_type: "PMC JATS full text",
        csl_json: '{"type":"article-journal"}',
        content_hash: "a".repeat(64),
        created_at: t1,
      },
    ],
    studies: [
      {
        id: "study-1",
        source_id: "source-1",
        registration_id: null,
        design: "randomized crossover trial",
        payload_json: '{"sampleSize":30}',
        created_at: t1,
      },
    ],
    analyses: [
      {
        id: "analysis-1",
        study_id: "study-1",
        label: "Satiety analysis",
        analysis_type: "intention-to-treat",
        population_json: "{}",
        exposure_json: "{}",
        comparator_json: "{}",
        outcome_json: '{"description":"satiety"}',
        time_horizon: "4 hours",
        estimand: null,
        model_json: "{}",
        multiplicity: "unknown",
        created_at: t1,
      },
    ],
    dependenceGroups: [
      {
        id: "family-1",
        case_id: "case-eggs",
        label: "Trial family",
        reason: "One participant sample",
        depends_on_json: "[]",
        created_at: t1,
      },
    ],
    results: [
      {
        id: "result-1",
        analysis_id: "analysis-1",
        dependence_group_id: "family-1",
        result_role: "primary",
        result_text: "Satiety was higher after the egg breakfast.",
        estimate_json: '{"display":"12 mm higher"}',
        locator: "Table 2",
        excerpt: "Satiety was higher.",
        verification_status: "ai-cross-checked-full-text",
        payload_json: '{"applicability":{"population":"partial"}}',
        created_at: t1,
      },
    ],
    evidenceRelations: [
      {
        id: "relation-1",
        case_id: "case-eggs",
        result_id: "result-1",
        claim_frame_id: "claim-satiety",
        relation: "supports",
        scope_match: "partial",
        rationale: "The comparator differs, but the outcome bears directly on the claim.",
        assessor: "extractor+adversary",
        status: "accepted-by-dual-model-review",
        created_at: t1,
      },
      {
        id: "relation-proposed",
        case_id: "case-eggs",
        result_id: "result-1",
        claim_frame_id: "claim-lipids",
        relation: "supports",
        scope_match: "unknown",
        rationale: "This relation has not passed promotion.",
        assessor: "extractor",
        status: "proposed",
        created_at: t2,
      },
    ],
    latestSnapshot: {
      id: "snapshot-evidence-1",
      parent_id: null,
      actor: "human-ai-workflow",
      operation: "autopromote-full-text-results",
      created_at: t1,
    },
    latestEvidenceSnapshot: {
      id: "snapshot-evidence-1",
      parent_id: null,
      actor: "human-ai-workflow",
      operation: "autopromote-full-text-results",
      created_at: t1,
    },
    latestDecision: null,
    ...overrides,
  };
}

test("normalizes accepted evidence into one stable, schema-valid graph", () => {
  const artifact = normalizeLiveArtifact("case-eggs", fixture(), t2);
  assert.equal(liveArtifactSchema.safeParse(artifact).success, true);
  assert.equal(artifact.graph.sources[0].id, "source-1");
  assert.equal(artifact.graph.results[0].id, "result-1");
  assert.equal(artifact.graph.evidenceRelations.length, 1);
  assert.equal(artifact.graph.evidenceRelations[0].id, "relation-1");
  assert.deepEqual(artifact.counts.verificationStatuses, {
    "ai-cross-checked-full-text": 1,
  });
  assert.deepEqual(artifact.counts.relationTypes, { supports: 1 });
  assert.equal(artifact.latestEvidenceAt, t1);
  assert.equal(artifact.latestEvidenceSnapshot.id, "snapshot-evidence-1");
});

test("reports unanswered claims without treating a proposed relation as evidence", () => {
  const artifact = normalizeLiveArtifact("case-eggs", fixture(), t2);
  assert.equal(artifact.status.phase, "collecting");
  assert.equal(artifact.counts.missingClaims, 1);
  assert.deepEqual(artifact.missingClaims.map((claim) => claim.claimFrameId), ["claim-lipids"]);
});

test("groups multiple claim relations around one atomic result without duplicating its evidence chain", () => {
  const rows = fixture();
  rows.evidenceRelations = [
    rows.evidenceRelations[0],
    {
      ...rows.evidenceRelations[1],
      id: "relation-2",
      status: "accepted-by-dual-model-review",
      created_at: t1,
    },
  ];
  const artifact = normalizeLiveArtifact("case-eggs", rows, t2);

  assert.equal(artifact.counts.results, 1);
  assert.equal(artifact.counts.analyses, 1);
  assert.equal(artifact.counts.studies, 1);
  assert.equal(artifact.counts.sources, 1);
  assert.equal(artifact.counts.evidenceRelations, 2);
  assert.equal(artifact.counts.missingClaims, 0);
  assert.equal(artifact.status.phase, "ready");
});

test("provisional abstract relations do not enter accepted claim coverage", () => {
  const rows = fixture();
  rows.evidenceRelations = [{
    ...rows.evidenceRelations[0],
    status: "provisional-pending-full-text",
  }];
  const artifact = normalizeLiveArtifact("case-eggs", rows, t2);

  assert.equal(artifact.counts.results, 0);
  assert.equal(artifact.counts.evidenceRelations, 0);
  assert.equal(artifact.counts.missingClaims, 2);
});

test("an accepted not-informative relation leaves the claim uncovered", () => {
  const rows = fixture();
  rows.evidenceRelations = [{
    ...rows.evidenceRelations[0],
    relation: "not-informative",
  }];
  const artifact = normalizeLiveArtifact("case-eggs", rows, t2);

  assert.equal(artifact.counts.evidenceRelations, 1);
  assert.deepEqual(
    artifact.missingClaims.map((claim) => claim.claimFrameId),
    ["claim-lipids", "claim-satiety"],
  );
});

test("marks a decision stale when accepted evidence is newer than its basis", () => {
  const artifact = normalizeLiveArtifact("case-eggs", fixture({
    latestSnapshot: {
      id: "snapshot-evidence-2",
      parent_id: "snapshot-evidence-1",
      actor: "human-ai-workflow",
      operation: "autopromote-full-text-results",
      created_at: t2,
    },
    latestEvidenceSnapshot: {
      id: "snapshot-evidence-2",
      parent_id: "snapshot-evidence-1",
      actor: "human-ai-workflow",
      operation: "autopromote-full-text-results",
      created_at: t2,
    },
    evidenceRelations: fixture().evidenceRelations.map((relation) =>
      relation.id === "relation-1" ? { ...relation, created_at: t2 } : relation),
    latestDecision: {
      id: "decision-1",
      question: "Should I buy twelve eggs?",
      graph_snapshot_id: "snapshot-evidence-1",
      status: "recorded",
      created_at: t0,
      updated_at: t1,
    },
  }), "2026-07-23T10:00:00.000Z");

  assert.equal(artifact.status.phase, "stale");
  assert.equal(artifact.status.isStale, true);
  assert.equal(artifact.latestDecision?.isStale, true);
  assert.ok(artifact.latestDecision?.staleReasons.includes("newer-accepted-evidence"));
  assert.ok(artifact.latestDecision?.staleReasons.includes("basis-snapshot-is-not-latest-evidence-snapshot"));
});

test("a freshly frozen immutable graph basis is current when its evidence version matches", () => {
  const artifact = normalizeLiveArtifact("case-eggs", fixture({
    latestSnapshot: {
      id: "snapshot-decision-basis-1",
      parent_id: "snapshot-evidence-1",
      actor: "epistack-system",
      operation: "freeze-accepted-evidence-basis",
      created_at: t2,
    },
    latestDecision: {
      id: "decision-1",
      question: "Should I buy twelve eggs?",
      graph_snapshot_id: "snapshot-decision-basis-1",
      basis_operation: "freeze-accepted-evidence-basis",
      basis_artifact_json: JSON.stringify({
        evidenceVersion: "snapshot-evidence-1",
        projectionHash: "accepted-graph-projection:abc123",
      }),
      status: "recorded",
      created_at: t2,
      updated_at: t2,
    },
  }), "2026-07-23T10:00:00.000Z");

  assert.equal(artifact.latestDecision?.isStale, false);
  assert.equal(artifact.latestDecision?.basisEvidenceVersion, "snapshot-evidence-1");
  assert.equal(artifact.latestDecision?.basisProjectionHash, "accepted-graph-projection:abc123");
});

test("returns an honest empty projection for an unknown case", () => {
  const artifact = normalizeLiveArtifact("missing-case", {}, t2);
  assert.equal(artifact.status.phase, "empty");
  assert.equal(artifact.case, null);
  assert.equal(artifact.counts.results, 0);
  assert.deepEqual(artifact.graph.claimFrames, []);
});

test("degrades visibly instead of silently trusting malformed stored JSON", () => {
  const rows = fixture();
  rows.sources[0].authors_json = "{not-json";
  const artifact = normalizeLiveArtifact("case-eggs", rows, t2);
  assert.equal(artifact.status.phase, "degraded");
  assert.equal(artifact.graph.sources[0].authors.length, 0);
  assert.ok(artifact.integrityWarnings.some((warning) => warning.includes("authors_json")));
});
