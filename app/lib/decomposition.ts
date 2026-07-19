export type BranchStatus = "kept" | "candidate" | "parked";
export type BranchRelevance = "high" | "medium" | "low";

export type InterpretationBranch = {
  id: string;
  label: string;
  value: string;
  detail: string;
  why: string;
  status: BranchStatus;
  relevance: BranchRelevance;
  origin: "ai" | "human";
};

export type InterpretationAxis = {
  id: string;
  label: string;
  question: string;
  branches: InterpretationBranch[];
};

export type QuestionHighlight = {
  quote: string;
  label: string;
  why: string;
  axisId: string;
  clusterId: string;
};

export type EvidenceIngestionRequirements = {
  requiredFields: string[];
  searchConcepts: string[];
  mismatchRisks: string[];
};

export type DecompositionCluster = {
  id: string;
  label: string;
  axisId: string;
  highlightQuotes: string[];
  latentVariable: string;
  rationale: string;
  ingestionRequirements: EvidenceIngestionRequirements;
};

export type DecompositionArtifact = {
  caseTitle: string;
  summary: string;
  highlights: QuestionHighlight[];
  clusters: DecompositionCluster[];
  axes: InterpretationAxis[];
  claimTemplate: string;
  knownUnknowns: string[];
};

export type DecompositionResponse = {
  caseId: string;
  mode: "ai" | "local-fallback";
  model: string;
  warning: string | null;
  prompt: string;
  decomposition: DecompositionArtifact;
};

export const decompositionSessionKey = "epistack:decomposition:v1";
