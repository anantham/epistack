import { index, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  originalPrompt: text("original_prompt").notNull(),
  activeQuestion: text("active_question"),
  status: text("status").notNull().default("framing"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("cases_slug_idx").on(table.slug)]);

export const nodes = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  body: text("body"),
  status: text("status").notNull().default("candidate"),
  origin: text("origin").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("nodes_case_idx").on(table.caseId),
  index("nodes_kind_idx").on(table.kind),
]);

export const edges = sqliteTable("edges", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  fromNodeId: text("from_node_id").notNull().references(() => nodes.id),
  toNodeId: text("to_node_id").notNull().references(() => nodes.id),
  relation: text("relation").notNull(),
  status: text("status").notNull().default("proposed"),
  rationale: text("rationale"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("edges_case_idx").on(table.caseId),
  index("edges_from_idx").on(table.fromNodeId),
  index("edges_to_idx").on(table.toNodeId),
]);

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  canonicalUrl: text("canonical_url"),
  doi: text("doi"),
  pmid: text("pmid"),
  title: text("title").notNull(),
  authorsJson: text("authors_json").notNull().default("[]"),
  issuedAt: text("issued_at"),
  publisher: text("publisher"),
  sourceType: text("source_type").notNull(),
  cslJson: text("csl_json").notNull().default("{}"),
  contentHash: text("content_hash"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("sources_doi_idx").on(table.doi),
  index("sources_pmid_idx").on(table.pmid),
]);

export const evidenceItems = sqliteTable("evidence_items", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  sourceId: text("source_id").notNull().references(() => sources.id),
  claimNodeId: text("claim_node_id").references(() => nodes.id),
  locator: text("locator"),
  excerpt: text("excerpt"),
  bearing: text("bearing").notNull(),
  extractionActor: text("extraction_actor").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("evidence_case_idx").on(table.caseId),
  index("evidence_source_idx").on(table.sourceId),
  index("evidence_claim_idx").on(table.claimNodeId),
]);

// Canonical, explicitly scoped propositions. Embeddings may propose matches,
// but scope fields determine whether claims are equal, overlapping, or distinct.
export const claimFrames = sqliteTable("claim_frames", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  statement: text("statement").notNull(),
  populationJson: text("population_json").notNull().default("{}"),
  exposureJson: text("exposure_json").notNull().default("{}"),
  comparatorJson: text("comparator_json").notNull().default("{}"),
  outcomeJson: text("outcome_json").notNull().default("{}"),
  timeHorizon: text("time_horizon"),
  modality: text("modality").notNull(),
  status: text("status").notNull().default("proposed"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("claim_frames_case_idx").on(table.caseId),
  index("claim_frames_status_idx").on(table.status),
]);

// A source is a document container. Studies, analyses, and results are modeled
// separately so one publication can contain supporting and opposing findings.
export const studies = sqliteTable("studies", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id),
  registrationId: text("registration_id"),
  design: text("design").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("studies_source_idx").on(table.sourceId),
  index("studies_registration_idx").on(table.registrationId),
]);

export const analyses = sqliteTable("analyses", {
  id: text("id").primaryKey(),
  studyId: text("study_id").notNull().references(() => studies.id),
  label: text("label").notNull(),
  analysisType: text("analysis_type").notNull(),
  populationJson: text("population_json").notNull().default("{}"),
  exposureJson: text("exposure_json").notNull().default("{}"),
  comparatorJson: text("comparator_json").notNull().default("{}"),
  outcomeJson: text("outcome_json").notNull().default("{}"),
  timeHorizon: text("time_horizon"),
  estimand: text("estimand"),
  modelJson: text("model_json").notNull().default("{}"),
  multiplicity: text("multiplicity").notNull().default("unknown"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("analyses_study_idx").on(table.studyId)]);

export const dependenceGroups = sqliteTable("dependence_groups", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  label: text("label").notNull(),
  reason: text("reason").notNull(),
  dependsOnJson: text("depends_on_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("dependence_groups_case_idx").on(table.caseId)]);

export const resultRecords = sqliteTable("result_records", {
  id: text("id").primaryKey(),
  analysisId: text("analysis_id").notNull().references(() => analyses.id),
  dependenceGroupId: text("dependence_group_id").notNull().references(() => dependenceGroups.id),
  resultRole: text("result_role").notNull(),
  resultText: text("result_text").notNull(),
  estimateJson: text("estimate_json").notNull().default("{}"),
  locator: text("locator").notNull(),
  excerpt: text("excerpt"),
  verificationStatus: text("verification_status").notNull().default("unverified"),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("result_records_analysis_idx").on(table.analysisId),
  index("result_records_family_idx").on(table.dependenceGroupId),
]);

// Relationship judgments are attributed assertions. They are never silently
// collapsed into a single source-level stance.
export const evidenceRelations = sqliteTable("evidence_relations", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  resultId: text("result_id").notNull().references(() => resultRecords.id),
  claimFrameId: text("claim_frame_id").notNull().references(() => claimFrames.id),
  relation: text("relation").notNull(),
  scopeMatch: text("scope_match").notNull(),
  rationale: text("rationale").notNull(),
  assessor: text("assessor").notNull(),
  status: text("status").notNull().default("proposed"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("evidence_relations_case_idx").on(table.caseId),
  index("evidence_relations_result_idx").on(table.resultId),
  index("evidence_relations_claim_idx").on(table.claimFrameId),
]);

export const decisionEpisodes = sqliteTable("decision_episodes", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  question: text("question").notNull(),
  targetContextJson: text("target_context_json").notNull().default("{}"),
  constraintsJson: text("constraints_json").notNull().default("{}"),
  valuesJson: text("values_json").notNull().default("{}"),
  graphSnapshotId: text("graph_snapshot_id").references(() => snapshots.id),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("decision_episodes_case_idx").on(table.caseId)]);

export const decisionOptions = sqliteTable("decision_options", {
  id: text("id").primaryKey(),
  decisionId: text("decision_id").notNull().references(() => decisionEpisodes.id),
  label: text("label").notNull(),
  actionJson: text("action_json").notNull().default("{}"),
  status: text("status").notNull().default("candidate"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("decision_options_decision_idx").on(table.decisionId)]);

export const decisionOutcomes = sqliteTable("decision_outcomes", {
  id: text("id").primaryKey(),
  decisionId: text("decision_id").notNull().references(() => decisionEpisodes.id),
  label: text("label").notNull(),
  measure: text("measure"),
  importance: real("importance"),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("decision_outcomes_decision_idx").on(table.decisionId)]);

export const protocols = sqliteTable("protocols", {
  id: text("id").primaryKey(),
  decisionId: text("decision_id").notNull().references(() => decisionEpisodes.id),
  optionId: text("option_id").references(() => decisionOptions.id),
  title: text("title").notNull(),
  protocolJson: text("protocol_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("protocols_decision_idx").on(table.decisionId)]);

export const observations = sqliteTable("observations", {
  id: text("id").primaryKey(),
  protocolId: text("protocol_id").notNull().references(() => protocols.id),
  sourceId: text("source_id").references(() => sources.id),
  observedAt: text("observed_at").notNull(),
  measure: text("measure").notNull(),
  valueJson: text("value_json").notNull(),
  contextJson: text("context_json").notNull().default("{}"),
  missingness: text("missingness"),
  sharing: text("sharing").notNull().default("private"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("observations_protocol_idx").on(table.protocolId)]);

export const updateEvents = sqliteTable("update_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  sourceUrl: text("source_url"),
  scope: text("scope").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  reviewStatus: text("review_status").notNull().default("queued"),
  occurredAt: text("occurred_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("update_events_target_idx").on(table.targetType, table.targetId),
  index("update_events_review_idx").on(table.reviewStatus),
]);

export const assessments = sqliteTable("assessments", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  policyId: text("policy_id").notNull(),
  assessor: text("assessor").notNull(),
  dimension: text("dimension").notNull(),
  score: real("score"),
  label: text("label"),
  rationale: text("rationale").notNull(),
  status: text("status").notNull().default("proposed"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("assessments_target_idx").on(table.targetType, table.targetId),
  index("assessments_policy_idx").on(table.policyId),
]);

export const snapshots = sqliteTable("snapshots", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  parentId: text("parent_id"),
  actor: text("actor").notNull(),
  operation: text("operation").notNull(),
  artifactJson: text("artifact_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("snapshots_case_idx").on(table.caseId)]);

export const beliefs = sqliteTable("beliefs", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  claimNodeId: text("claim_node_id").notNull().references(() => nodes.id),
  probability: real("probability").notNull(),
  priorType: text("prior_type").notNull(),
  basisSnapshotId: text("basis_snapshot_id").references(() => snapshots.id),
  assessor: text("assessor").notNull(),
  rationale: text("rationale").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("beliefs_claim_idx").on(table.claimNodeId),
  index("beliefs_case_idx").on(table.caseId),
]);

export type CaseRecord = typeof cases.$inferSelect;
export type NewCaseRecord = typeof cases.$inferInsert;
