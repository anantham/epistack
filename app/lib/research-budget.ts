export const researchEffortSteps = ["quick", "standard", "thorough"] as const;
export type ResearchEffortStep = (typeof researchEffortSteps)[number];
export const defaultResearchEffortStep: ResearchEffortStep = "standard";

/** Every run gets the same spending ceiling, whichever models are selected. */
export const researchRunCapUsd = 5;

export const openRouterModelIdPattern = /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i;

export type ResearchModelRole = "search" | "reader" | "reviewer";
export type ResearchModelPreferences = Partial<Record<ResearchModelRole, string>>;

export type ResearchBudgetProfile = {
  label: string;
  summary: string;
  /** Parameters for OpenRouter's `openrouter:web_search` server tool. */
  webSearch: { max_uses: number; max_results: number; max_total_results: number };
  searchMaxTokens: number;
  pubmedMaxResults: number;
  readerReasoning: "none" | "medium";
  readerMaxTokens: number;
};

export const researchBudgetProfiles: Record<ResearchEffortStep, ResearchBudgetProfile> = {
  quick: {
    label: "Quick",
    summary: "Up to 2 web searches per lane with 5 results each, and 6 PubMed records.",
    webSearch: { max_uses: 2, max_results: 5, max_total_results: 10 },
    searchMaxTokens: 2_500,
    pubmedMaxResults: 6,
    readerReasoning: "none",
    readerMaxTokens: 4_500,
  },
  standard: {
    label: "Standard",
    summary: "Up to 3 web searches per lane with 8 results each, and 10 PubMed records.",
    webSearch: { max_uses: 3, max_results: 8, max_total_results: 24 },
    searchMaxTokens: 3_500,
    pubmedMaxResults: 10,
    readerReasoning: "none",
    readerMaxTokens: 4_500,
  },
  thorough: {
    label: "Thorough",
    summary: "Up to 5 web searches per lane with 10 results each, 10 PubMed records, and a reasoning paper read.",
    webSearch: { max_uses: 5, max_results: 10, max_total_results: 50 },
    searchMaxTokens: 5_000,
    pubmedMaxResults: 10,
    readerReasoning: "medium",
    readerMaxTokens: 9_000,
  },
};

export function normalizeResearchEffortStep(value: unknown): ResearchEffortStep {
  if (typeof value !== "string") return defaultResearchEffortStep;
  const normalized = value.trim().toLowerCase();
  return (researchEffortSteps as readonly string[]).includes(normalized)
    ? (normalized as ResearchEffortStep)
    : defaultResearchEffortStep;
}

export function normalizeModelId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 160 && openRouterModelIdPattern.test(trimmed) ? trimmed : undefined;
}

export function normalizeResearchModels(value: unknown): ResearchModelPreferences {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const models: ResearchModelPreferences = {};
  for (const role of ["search", "reader", "reviewer"] as const) {
    const id = normalizeModelId(source[role]);
    if (id) models[role] = id;
  }
  return models;
}

export function modelFamily(modelId: string | undefined) {
  return modelId?.split("/")[0]?.toLowerCase() || "";
}

export type ResearchPreferences = { effort: ResearchEffortStep; models: ResearchModelPreferences };

// A separate record: the decomposition pages rewrite `epistack:preferences:v1` whole.
export const researchPreferencesStorageKey = "epistack:research-preferences:v1";

export function parseResearchPreferences(raw: string | null): ResearchPreferences {
  try {
    const parsed = JSON.parse(raw || "{}") as { effort?: unknown; models?: unknown };
    return { effort: normalizeResearchEffortStep(parsed.effort), models: normalizeResearchModels(parsed.models) };
  } catch {
    return { effort: defaultResearchEffortStep, models: {} };
  }
}

export type ResearchUsage = {
  calls: number;
  costUsd: number;
  webSearchRequests: number;
  promptTokens: number;
  completionTokens: number;
};

export const emptyResearchUsage: ResearchUsage = { calls: 0, costUsd: 0, webSearchRequests: 0, promptTokens: 0, completionTokens: 0 };

function finiteNonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** OpenRouter always returns a usage object; missing fields count as zero. */
export function usageFromOpenRouter(usage: unknown): ResearchUsage {
  const record = usage && typeof usage === "object" ? usage as Record<string, unknown> : {};
  const serverTools = record.server_tool_use && typeof record.server_tool_use === "object"
    ? record.server_tool_use as Record<string, unknown>
    : {};
  return {
    calls: 1,
    costUsd: finiteNonNegative(record.cost),
    webSearchRequests: finiteNonNegative(serverTools.web_search_requests),
    promptTokens: finiteNonNegative(record.prompt_tokens),
    completionTokens: finiteNonNegative(record.completion_tokens),
  };
}

export function normalizeResearchUsage(value: unknown): ResearchUsage {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    calls: finiteNonNegative(record.calls),
    costUsd: finiteNonNegative(record.costUsd),
    webSearchRequests: finiteNonNegative(record.webSearchRequests),
    promptTokens: finiteNonNegative(record.promptTokens),
    completionTokens: finiteNonNegative(record.completionTokens),
  };
}

export function addResearchUsage(total: ResearchUsage, next: ResearchUsage): ResearchUsage {
  return {
    calls: total.calls + next.calls,
    costUsd: total.costUsd + next.costUsd,
    webSearchRequests: total.webSearchRequests + next.webSearchRequests,
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
  };
}

export function remainingRunBudgetUsd(spentUsd: number, capUsd = researchRunCapUsd) {
  return Math.max(0, capUsd - finiteNonNegative(spentUsd));
}

export function runBudgetExhausted(spentUsd: number, capUsd = researchRunCapUsd) {
  return remainingRunBudgetUsd(spentUsd, capUsd) <= 0;
}

export function formatUsd(value: number) {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}
