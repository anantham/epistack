import { researchBriefSchema, type ResearchBrief } from "./research-brief";
import type { DecompositionResponse } from "./decomposition";

export const caseWorkflowVersion = 1 as const;

export type PersistedCaseWorkflow = {
  version: typeof caseWorkflowVersion;
  decomposition: DecompositionResponse;
  researchBrief: ResearchBrief;
  researchState?: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isDecompositionResponse(value: unknown): value is DecompositionResponse {
  const candidate = record(value);
  const decomposition = candidate ? record(candidate.decomposition) : null;
  return Boolean(
    candidate
      && typeof candidate.caseId === "string"
      && typeof candidate.prompt === "string"
      && typeof candidate.model === "string"
      && (candidate.mode === "ai" || candidate.mode === "local-fallback")
      && decomposition
      && Array.isArray(decomposition.clusters)
      && Array.isArray(decomposition.highlights),
  );
}

/**
 * The case URL is authoritative for historical navigation. Browser storage is
 * only a convenience and can contain the latest run from another tab.
 */
export function parseCaseWorkflow(value: unknown): PersistedCaseWorkflow | null {
  const candidate = record(value);
  if (!candidate || candidate.version !== caseWorkflowVersion) return null;
  if (!isDecompositionResponse(candidate.decomposition)) return null;
  const parsedBrief = researchBriefSchema.safeParse(candidate.researchBrief);
  if (!parsedBrief.success) return null;
  return {
    version: caseWorkflowVersion,
    decomposition: candidate.decomposition,
    researchBrief: parsedBrief.data,
    researchState: record(candidate.researchState) ?? undefined,
  };
}
