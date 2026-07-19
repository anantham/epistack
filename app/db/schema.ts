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
