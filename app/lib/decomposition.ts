export type QuestionHighlight = {
  quote: string;
  label: string;
  why: string;
  clusterId: string;
};

export type EvidenceIngestionRequirements = {
  requiredFields: string[];
  searchConcepts: string[];
  mismatchRisks: string[];
};

export type ContextQuestion = {
  id: string;
  label: string;
  question: string;
  whyItMatters: string;
  effect: "prune" | "branch" | "match";
  options: string[];
};

export type DecompositionCluster = {
  id: string;
  label: string;
  highlightQuotes: string[];
  latentVariable: string;
  rationale: string;
  ingestionRequirements: EvidenceIngestionRequirements;
  contextQuestion: ContextQuestion;
};

export type DecompositionArtifact = {
  caseTitle: string;
  summary: string;
  highlights: QuestionHighlight[];
  clusters: DecompositionCluster[];
  claimTemplate: string;
  knownUnknowns: string[];
};

export type DecompositionStageProvenance = {
  stage: string;
  provider: string;
  model: string;
  status: "used" | "fallback";
  reason?: string;
};

export type DecompositionProvenance = {
  path: "hosted-primary" | "openrouter-fallback" | "deterministic-fallback";
  provider: string;
  model: string;
  stages: DecompositionStageProvenance[];
};

export type DecompositionResponse = {
  caseId: string;
  mode: "ai" | "local-fallback";
  model: string;
  provenance?: DecompositionProvenance;
  warning: string | null;
  prompt: string;
  decisionContext: string;
  decomposition: DecompositionArtifact;
  cache: CacheMetadata;
};

export const decompositionSessionKey = "epistack:decomposition:v1";
export const interpretationMapStorageKey = "epistack:interpretation-map:v1";
import type { CacheMetadata } from "./research";
