import { z } from "zod";

export const liveArtifactContractVersion = "live-artifact.v1" as const;

const jsonObjectSchema = z.record(z.string(), z.unknown());
const nullableString = z.string().nullable();

export const liveArtifactCaseSchema = z.object({
  id: z.string().min(1),
  slug: z.string(),
  title: z.string(),
  originalPrompt: z.string(),
  activeQuestion: nullableString,
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const liveClaimFrameSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  statement: z.string(),
  population: jsonObjectSchema,
  exposure: jsonObjectSchema,
  comparator: jsonObjectSchema,
  outcome: jsonObjectSchema,
  timeHorizon: nullableString,
  modality: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const liveSourceSchema = z.object({
  id: z.string().min(1),
  canonicalUrl: nullableString,
  doi: nullableString,
  pmid: nullableString,
  title: z.string(),
  authors: z.array(z.string()),
  issuedAt: nullableString,
  publisher: nullableString,
  sourceType: z.string(),
  csl: jsonObjectSchema,
  contentHash: nullableString,
  createdAt: z.string(),
});

export const liveStudySchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  registrationId: nullableString,
  design: z.string(),
  details: jsonObjectSchema,
  createdAt: z.string(),
});

export const liveAnalysisSchema = z.object({
  id: z.string().min(1),
  studyId: z.string().min(1),
  label: z.string(),
  analysisType: z.string(),
  population: jsonObjectSchema,
  exposure: jsonObjectSchema,
  comparator: jsonObjectSchema,
  outcome: jsonObjectSchema,
  timeHorizon: nullableString,
  estimand: nullableString,
  model: jsonObjectSchema,
  multiplicity: z.string(),
  createdAt: z.string(),
});

export const liveResultSchema = z.object({
  id: z.string().min(1),
  analysisId: z.string().min(1),
  dependenceGroupId: z.string().min(1),
  resultRole: z.string(),
  resultText: z.string(),
  estimate: jsonObjectSchema,
  locator: z.string(),
  excerpt: nullableString,
  verificationStatus: z.string(),
  details: jsonObjectSchema,
  createdAt: z.string(),
});

export const liveEvidenceRelationSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  resultId: z.string().min(1),
  claimFrameId: z.string().min(1),
  relation: z.string(),
  scopeMatch: z.string(),
  rationale: z.string(),
  assessor: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

export const liveDependenceGroupSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  label: z.string(),
  reason: z.string(),
  dependsOn: z.array(z.string()),
  createdAt: z.string(),
});

export const liveSnapshotMetadataSchema = z.object({
  id: z.string().min(1),
  parentId: nullableString,
  actor: z.string(),
  operation: z.string(),
  createdAt: z.string(),
});

export const liveDecisionMetadataSchema = z.object({
  id: z.string().min(1),
  question: z.string(),
  status: z.string(),
  graphSnapshotId: nullableString,
  basisEvidenceVersion: nullableString,
  basisProjectionHash: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
  isStale: z.boolean(),
  staleReasons: z.array(z.string()),
});

export const liveArtifactStatusSchema = z.object({
  phase: z.enum(["empty", "collecting", "ready", "stale", "degraded"]),
  label: z.string(),
  reasons: z.array(z.string()),
  storage: z.literal("d1"),
  isStale: z.boolean(),
});

export const liveArtifactSchema = z.object({
  contractVersion: z.literal(liveArtifactContractVersion),
  generatedAt: z.string(),
  caseId: z.string().min(1),
  case: liveArtifactCaseSchema.nullable(),
  status: liveArtifactStatusSchema,
  counts: z.object({
    claimFrames: z.number().int().nonnegative(),
    missingClaims: z.number().int().nonnegative(),
    sources: z.number().int().nonnegative(),
    studies: z.number().int().nonnegative(),
    analyses: z.number().int().nonnegative(),
    results: z.number().int().nonnegative(),
    evidenceRelations: z.number().int().nonnegative(),
    dependenceGroups: z.number().int().nonnegative(),
    verificationStatuses: z.record(z.string(), z.number().int().nonnegative()),
    relationTypes: z.record(z.string(), z.number().int().nonnegative()),
  }),
  missingClaims: z.array(z.object({
    claimFrameId: z.string().min(1),
    statement: z.string(),
    status: z.string(),
    reason: z.literal("no-accepted-evidence"),
  })),
  latestEvidenceAt: nullableString,
  latestSnapshot: liveSnapshotMetadataSchema.nullable(),
  latestEvidenceSnapshot: liveSnapshotMetadataSchema.nullable(),
  latestDecision: liveDecisionMetadataSchema.nullable(),
  researchContract: jsonObjectSchema.nullable(),
  integrityWarnings: z.array(z.string()),
  graph: z.object({
    claimFrames: z.array(liveClaimFrameSchema),
    sources: z.array(liveSourceSchema),
    studies: z.array(liveStudySchema),
    analyses: z.array(liveAnalysisSchema),
    results: z.array(liveResultSchema),
    evidenceRelations: z.array(liveEvidenceRelationSchema),
    dependenceGroups: z.array(liveDependenceGroupSchema),
  }),
});

export type LiveArtifact = z.infer<typeof liveArtifactSchema>;
export type LiveArtifactStatus = z.infer<typeof liveArtifactStatusSchema>;

export const liveArtifactUnavailableSchema = z.object({
  contractVersion: z.literal(liveArtifactContractVersion),
  caseId: z.string(),
  status: z.object({
    phase: z.literal("unavailable"),
    label: z.string(),
    reasons: z.array(z.string()),
    storage: z.literal("d1"),
    isStale: z.literal(false),
  }),
  error: z.object({
    code: z.literal("D1_UNAVAILABLE"),
    message: z.string(),
    recoverable: z.literal(true),
  }),
});

export type RawCaseRow = {
  id: string;
  slug: string;
  title: string;
  original_prompt: string;
  active_question: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type RawClaimFrameRow = {
  id: string;
  case_id: string;
  statement: string;
  population_json: string;
  exposure_json: string;
  comparator_json: string;
  outcome_json: string;
  time_horizon: string | null;
  modality: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type RawSourceRow = {
  id: string;
  canonical_url: string | null;
  doi: string | null;
  pmid: string | null;
  title: string;
  authors_json: string;
  issued_at: string | null;
  publisher: string | null;
  source_type: string;
  csl_json: string;
  content_hash: string | null;
  created_at: string;
};

export type RawStudyRow = {
  id: string;
  source_id: string;
  registration_id: string | null;
  design: string;
  payload_json: string;
  created_at: string;
};

export type RawAnalysisRow = {
  id: string;
  study_id: string;
  label: string;
  analysis_type: string;
  population_json: string;
  exposure_json: string;
  comparator_json: string;
  outcome_json: string;
  time_horizon: string | null;
  estimand: string | null;
  model_json: string;
  multiplicity: string;
  created_at: string;
};

export type RawResultRow = {
  id: string;
  analysis_id: string;
  dependence_group_id: string;
  result_role: string;
  result_text: string;
  estimate_json: string;
  locator: string;
  excerpt: string | null;
  verification_status: string;
  payload_json: string;
  created_at: string;
};

export type RawEvidenceRelationRow = {
  id: string;
  case_id: string;
  result_id: string;
  claim_frame_id: string;
  relation: string;
  scope_match: string;
  rationale: string;
  assessor: string;
  status: string;
  created_at: string;
};

export type RawDependenceGroupRow = {
  id: string;
  case_id: string;
  label: string;
  reason: string;
  depends_on_json: string;
  created_at: string;
};

export type RawSnapshotRow = {
  id: string;
  parent_id: string | null;
  actor: string;
  operation: string;
  artifact_json?: string | null;
  created_at: string;
};

export type RawDecisionRow = {
  id: string;
  question: string;
  graph_snapshot_id: string | null;
  basis_operation?: string | null;
  basis_artifact_json?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type LiveArtifactRows = {
  caseRecord?: RawCaseRow | null;
  claimFrames?: RawClaimFrameRow[];
  sources?: RawSourceRow[];
  studies?: RawStudyRow[];
  analyses?: RawAnalysisRow[];
  results?: RawResultRow[];
  evidenceRelations?: RawEvidenceRelationRow[];
  dependenceGroups?: RawDependenceGroupRow[];
  latestSnapshot?: RawSnapshotRow | null;
  latestContractSnapshot?: RawSnapshotRow | null;
  latestEvidenceSnapshot?: RawSnapshotRow | null;
  latestDecision?: RawDecisionRow | null;
};

function parseObject(
  serialized: string,
  field: string,
  warnings: string[],
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The warning below deliberately avoids echoing stored content.
  }
  warnings.push(`${field} was not a valid JSON object and was replaced with an empty object.`);
  return {};
}

function parseStringArray(serialized: string, field: string, warnings: string[]) {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // The warning below deliberately avoids echoing stored content.
  }
  warnings.push(`${field} was not a valid string array and was replaced with an empty array.`);
  return [];
}

function uniqueById<T extends { id: string }>(rows: T[], label: string, warnings: string[]) {
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (byId.has(row.id)) {
      warnings.push(`${label} ${row.id} appeared more than once; the first record was retained.`);
      continue;
    }
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

function stableSort<T extends { id: string; createdAt: string }>(rows: T[]) {
  return [...rows].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function countBy(rows: string[]) {
  const counts: Record<string, number> = {};
  for (const value of rows) counts[value] = (counts[value] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function timestampValue(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestTimestamp(values: string[], warnings: string[]) {
  let latest: { value: string; timestamp: number } | null = null;
  for (const value of values) {
    const timestamp = timestampValue(value);
    if (timestamp === null) {
      warnings.push("An accepted evidence timestamp was invalid and was excluded from freshness checks.");
      continue;
    }
    if (!latest || timestamp > latest.timestamp) latest = { value, timestamp };
  }
  return latest?.value || null;
}

function isClaimInScope(status: string) {
  return !["archived", "parked", "rejected", "withdrawn"].includes(status.toLowerCase());
}

function isAcceptedEvidenceRelation(status: string) {
  return [
    "accepted-by-dual-model-review",
    "accepted-human-verified-full-text",
  ].includes(status.toLowerCase());
}

function statusFor(input: {
  hasCase: boolean;
  claimCount: number;
  resultCount: number;
  missingClaimCount: number;
  decisionIsStale: boolean;
  warnings: string[];
}): LiveArtifactStatus {
  const reasons: string[] = [];
  let phase: LiveArtifactStatus["phase"];
  let label: string;

  if (input.warnings.length) {
    phase = "degraded";
    label = "Artifact loaded with integrity warnings";
    reasons.push(`${input.warnings.length} stored-data integrity warning${input.warnings.length === 1 ? "" : "s"} need review.`);
  } else if (!input.hasCase || (input.claimCount === 0 && input.resultCount === 0)) {
    phase = "empty";
    label = "No accepted evidence yet";
    reasons.push(input.hasCase
      ? "The case exists, but it has no claim frames or accepted evidence relations."
      : "No persisted case was found for this identifier.");
  } else if (input.decisionIsStale) {
    phase = "stale";
    label = "Decision needs review";
    reasons.push("Accepted evidence has changed since the latest decision's recorded basis.");
  } else if (input.resultCount === 0 || input.missingClaimCount > 0) {
    phase = "collecting";
    label = "Evidence collection is incomplete";
    if (input.resultCount === 0) reasons.push("No accepted result relations have been promoted.");
    if (input.missingClaimCount > 0) {
      reasons.push(`${input.missingClaimCount} in-scope claim${input.missingClaimCount === 1 ? " has" : "s have"} no accepted evidence relation.`);
    }
  } else {
    phase = "ready";
    label = "Accepted evidence projection is current";
    reasons.push("Every in-scope claim has at least one accepted evidence relation.");
  }

  return {
    phase,
    label,
    reasons,
    storage: "d1",
    isStale: input.decisionIsStale,
  };
}

export function normalizeLiveArtifact(
  caseId: string,
  rows: LiveArtifactRows,
  generatedAt = new Date().toISOString(),
): LiveArtifact {
  const integrityWarnings: string[] = [];

  const claimFrames = stableSort(uniqueById((rows.claimFrames || []).map((row) => ({
    id: row.id,
    caseId: row.case_id,
    statement: row.statement,
    population: parseObject(row.population_json, `claim_frames.${row.id}.population_json`, integrityWarnings),
    exposure: parseObject(row.exposure_json, `claim_frames.${row.id}.exposure_json`, integrityWarnings),
    comparator: parseObject(row.comparator_json, `claim_frames.${row.id}.comparator_json`, integrityWarnings),
    outcome: parseObject(row.outcome_json, `claim_frames.${row.id}.outcome_json`, integrityWarnings),
    timeHorizon: row.time_horizon,
    modality: row.modality,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })), "claim frame", integrityWarnings));

  const sources = uniqueById((rows.sources || []).map((row) => ({
    id: row.id,
    canonicalUrl: row.canonical_url,
    doi: row.doi,
    pmid: row.pmid,
    title: row.title,
    authors: parseStringArray(row.authors_json, `sources.${row.id}.authors_json`, integrityWarnings),
    issuedAt: row.issued_at,
    publisher: row.publisher,
    sourceType: row.source_type,
    csl: parseObject(row.csl_json, `sources.${row.id}.csl_json`, integrityWarnings),
    contentHash: row.content_hash,
    createdAt: row.created_at,
  })), "source", integrityWarnings);

  const studies = uniqueById((rows.studies || []).map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    registrationId: row.registration_id,
    design: row.design,
    details: parseObject(row.payload_json, `studies.${row.id}.payload_json`, integrityWarnings),
    createdAt: row.created_at,
  })), "study", integrityWarnings);

  const analyses = uniqueById((rows.analyses || []).map((row) => ({
    id: row.id,
    studyId: row.study_id,
    label: row.label,
    analysisType: row.analysis_type,
    population: parseObject(row.population_json, `analyses.${row.id}.population_json`, integrityWarnings),
    exposure: parseObject(row.exposure_json, `analyses.${row.id}.exposure_json`, integrityWarnings),
    comparator: parseObject(row.comparator_json, `analyses.${row.id}.comparator_json`, integrityWarnings),
    outcome: parseObject(row.outcome_json, `analyses.${row.id}.outcome_json`, integrityWarnings),
    timeHorizon: row.time_horizon,
    estimand: row.estimand,
    model: parseObject(row.model_json, `analyses.${row.id}.model_json`, integrityWarnings),
    multiplicity: row.multiplicity,
    createdAt: row.created_at,
  })), "analysis", integrityWarnings);

  const dependenceGroups = uniqueById((rows.dependenceGroups || []).map((row) => ({
    id: row.id,
    caseId: row.case_id,
    label: row.label,
    reason: row.reason,
    dependsOn: parseStringArray(row.depends_on_json, `dependence_groups.${row.id}.depends_on_json`, integrityWarnings),
    createdAt: row.created_at,
  })), "dependence group", integrityWarnings);

  const results = uniqueById((rows.results || []).map((row) => ({
    id: row.id,
    analysisId: row.analysis_id,
    dependenceGroupId: row.dependence_group_id,
    resultRole: row.result_role,
    resultText: row.result_text,
    estimate: parseObject(row.estimate_json, `result_records.${row.id}.estimate_json`, integrityWarnings),
    locator: row.locator,
    excerpt: row.excerpt,
    verificationStatus: row.verification_status,
    details: parseObject(row.payload_json, `result_records.${row.id}.payload_json`, integrityWarnings),
    createdAt: row.created_at,
  })), "result", integrityWarnings);

  const proposedRelations = uniqueById((rows.evidenceRelations || [])
    .filter((row) => isAcceptedEvidenceRelation(row.status))
    .map((row) => ({
      id: row.id,
      caseId: row.case_id,
      resultId: row.result_id,
      claimFrameId: row.claim_frame_id,
      relation: row.relation,
      scopeMatch: row.scope_match,
      rationale: row.rationale,
      assessor: row.assessor,
      status: row.status,
      createdAt: row.created_at,
    })), "evidence relation", integrityWarnings);

  const sourceIds = new Set(sources.map((record) => record.id));
  const validStudies = studies.filter((record) => {
    if (sourceIds.has(record.sourceId)) return true;
    integrityWarnings.push(`Study ${record.id} references missing source ${record.sourceId}.`);
    return false;
  });
  const studyIds = new Set(validStudies.map((record) => record.id));
  const validAnalyses = analyses.filter((record) => {
    if (studyIds.has(record.studyId)) return true;
    integrityWarnings.push(`Analysis ${record.id} references missing study ${record.studyId}.`);
    return false;
  });
  const analysisIds = new Set(validAnalyses.map((record) => record.id));
  const groupIds = new Set(dependenceGroups.map((record) => record.id));
  const validResults = results.filter((record) => {
    const analysisExists = analysisIds.has(record.analysisId);
    const groupExists = groupIds.has(record.dependenceGroupId);
    if (!analysisExists) integrityWarnings.push(`Result ${record.id} references missing analysis ${record.analysisId}.`);
    if (!groupExists) integrityWarnings.push(`Result ${record.id} references missing dependence group ${record.dependenceGroupId}.`);
    return analysisExists && groupExists;
  });
  const resultIds = new Set(validResults.map((record) => record.id));
  const claimIds = new Set(claimFrames.map((record) => record.id));
  const validRelations = proposedRelations.filter((record) => {
    const resultExists = resultIds.has(record.resultId);
    const claimExists = claimIds.has(record.claimFrameId);
    if (!resultExists) integrityWarnings.push(`Evidence relation ${record.id} references missing result ${record.resultId}.`);
    if (!claimExists) integrityWarnings.push(`Evidence relation ${record.id} references missing claim frame ${record.claimFrameId}.`);
    return resultExists && claimExists;
  });

  // Keep only accepted evidence and the document/result chain needed to
  // inspect it. Claim frames remain complete so unanswered claims are visible.
  const connectedResultIds = new Set(validRelations.map((record) => record.resultId));
  const connectedResults = stableSort(validResults.filter((record) => connectedResultIds.has(record.id)));
  const connectedAnalysisIds = new Set(connectedResults.map((record) => record.analysisId));
  const connectedAnalyses = stableSort(validAnalyses.filter((record) => connectedAnalysisIds.has(record.id)));
  const connectedStudyIds = new Set(connectedAnalyses.map((record) => record.studyId));
  const connectedStudies = stableSort(validStudies.filter((record) => connectedStudyIds.has(record.id)));
  const connectedSourceIds = new Set(connectedStudies.map((record) => record.sourceId));
  const connectedSources = stableSort(sources.filter((record) => connectedSourceIds.has(record.id)));
  const connectedGroupIds = new Set(connectedResults.map((record) => record.dependenceGroupId));
  const connectedGroups = stableSort(dependenceGroups.filter((record) => connectedGroupIds.has(record.id)));
  const evidenceRelations = stableSort(validRelations);

  const claimsWithEvidence = new Set(
    evidenceRelations
      .filter((relation) => relation.relation !== "not-informative")
      .map((relation) => relation.claimFrameId),
  );
  const missingClaims = claimFrames
    .filter((claim) => isClaimInScope(claim.status) && !claimsWithEvidence.has(claim.id))
    .map((claim) => ({
      claimFrameId: claim.id,
      statement: claim.statement,
      status: claim.status,
      reason: "no-accepted-evidence" as const,
    }));
  const latestEvidenceAt = latestTimestamp([
    ...evidenceRelations.map((relation) => relation.createdAt),
    ...(rows.latestEvidenceSnapshot?.created_at ? [rows.latestEvidenceSnapshot.created_at] : []),
  ], integrityWarnings);

  let latestDecision: z.infer<typeof liveDecisionMetadataSchema> | null = null;
  if (rows.latestDecision) {
    const staleReasons: string[] = [];
    let basisEvidenceVersion: string | null = null;
    let basisProjectionHash: string | null = null;
    if (rows.latestDecision.basis_artifact_json) {
      const basisArtifact = parseObject(
        rows.latestDecision.basis_artifact_json,
        `decision_episodes.${rows.latestDecision.id}.basis_artifact_json`,
        integrityWarnings,
      );
      basisEvidenceVersion = typeof basisArtifact.evidenceVersion === "string"
        ? basisArtifact.evidenceVersion
        : null;
      basisProjectionHash = typeof basisArtifact.projectionHash === "string"
        ? basisArtifact.projectionHash
        : null;
    }
    const decisionStatus = rows.latestDecision.status.toLowerCase();
    if (decisionStatus === "stale" || decisionStatus === "outdated") {
      staleReasons.push("decision-status-is-stale");
    }
    const decisionUpdatedAt = timestampValue(rows.latestDecision.updated_at);
    const evidenceUpdatedAt = timestampValue(latestEvidenceAt);
    if (evidenceUpdatedAt !== null && (decisionUpdatedAt === null || evidenceUpdatedAt > decisionUpdatedAt)) {
      staleReasons.push("newer-accepted-evidence");
    }
    if (rows.latestEvidenceSnapshot) {
      if (!rows.latestDecision.graph_snapshot_id) {
        staleReasons.push("not-bound-to-evidence-snapshot");
      } else if (rows.latestDecision.basis_operation === "freeze-accepted-evidence-basis") {
        if (!basisEvidenceVersion) {
          staleReasons.push("frozen-basis-missing-evidence-version");
        } else if (basisEvidenceVersion !== rows.latestEvidenceSnapshot.id) {
          staleReasons.push("basis-evidence-version-is-not-latest");
        }
      } else if (rows.latestDecision.graph_snapshot_id !== rows.latestEvidenceSnapshot.id) {
        staleReasons.push("basis-snapshot-is-not-latest-evidence-snapshot");
      }
    }
    latestDecision = {
      id: rows.latestDecision.id,
      question: rows.latestDecision.question,
      status: rows.latestDecision.status,
      graphSnapshotId: rows.latestDecision.graph_snapshot_id,
      basisEvidenceVersion,
      basisProjectionHash,
      createdAt: rows.latestDecision.created_at,
      updatedAt: rows.latestDecision.updated_at,
      isStale: staleReasons.length > 0,
      staleReasons,
    };
  }

  const caseRecord = rows.caseRecord ? {
    id: rows.caseRecord.id,
    slug: rows.caseRecord.slug,
    title: rows.caseRecord.title,
    originalPrompt: rows.caseRecord.original_prompt,
    activeQuestion: rows.caseRecord.active_question,
    status: rows.caseRecord.status,
    createdAt: rows.caseRecord.created_at,
    updatedAt: rows.caseRecord.updated_at,
  } : null;
  const latestSnapshot = rows.latestSnapshot ? {
    id: rows.latestSnapshot.id,
    parentId: rows.latestSnapshot.parent_id,
    actor: rows.latestSnapshot.actor,
    operation: rows.latestSnapshot.operation,
    createdAt: rows.latestSnapshot.created_at,
  } : null;
  const latestEvidenceSnapshot = rows.latestEvidenceSnapshot ? {
    id: rows.latestEvidenceSnapshot.id,
    parentId: rows.latestEvidenceSnapshot.parent_id,
    actor: rows.latestEvidenceSnapshot.actor,
    operation: rows.latestEvidenceSnapshot.operation,
    createdAt: rows.latestEvidenceSnapshot.created_at,
  } : null;
  let researchContract: Record<string, unknown> | null = null;
  const contractSnapshot = rows.latestContractSnapshot ?? rows.latestSnapshot;
  if (contractSnapshot?.artifact_json) {
    const snapshotArtifact = parseObject(contractSnapshot.artifact_json, "latest contextualization snapshot artifact", integrityWarnings);
    const candidateContract = snapshotArtifact.researchBrief;
    if (candidateContract && typeof candidateContract === "object" && !Array.isArray(candidateContract)) {
      researchContract = candidateContract as Record<string, unknown>;
    }
  }

  const artifact: LiveArtifact = {
    contractVersion: liveArtifactContractVersion,
    generatedAt,
    caseId,
    case: caseRecord,
    status: statusFor({
      hasCase: caseRecord !== null,
      claimCount: claimFrames.filter((claim) => isClaimInScope(claim.status)).length,
      resultCount: connectedResults.length,
      missingClaimCount: missingClaims.length,
      decisionIsStale: latestDecision?.isStale || false,
      warnings: integrityWarnings,
    }),
    counts: {
      claimFrames: claimFrames.length,
      missingClaims: missingClaims.length,
      sources: connectedSources.length,
      studies: connectedStudies.length,
      analyses: connectedAnalyses.length,
      results: connectedResults.length,
      evidenceRelations: evidenceRelations.length,
      dependenceGroups: connectedGroups.length,
      verificationStatuses: countBy(connectedResults.map((record) => record.verificationStatus)),
      relationTypes: countBy(evidenceRelations.map((record) => record.relation)),
    },
    missingClaims,
    latestEvidenceAt,
    latestSnapshot,
    latestEvidenceSnapshot,
    latestDecision,
    researchContract,
    integrityWarnings,
    graph: {
      claimFrames,
      sources: connectedSources,
      studies: connectedStudies,
      analyses: connectedAnalyses,
      results: connectedResults,
      evidenceRelations,
      dependenceGroups: connectedGroups,
    },
  };

  return liveArtifactSchema.parse(artifact);
}
