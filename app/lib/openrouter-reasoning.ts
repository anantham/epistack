export const openRouterReasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type OpenRouterReasoningEffort = (typeof openRouterReasoningEfforts)[number];

/** Translate the app's effort names to OpenRouter's reasoning levels. */
export function normalizeOpenRouterReasoningEffort(value: unknown): OpenRouterReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "instant") return "none";
  if (normalized === "pro") return "max";
  return (openRouterReasoningEfforts as readonly string[]).includes(normalized)
    ? (normalized as OpenRouterReasoningEffort)
    : undefined;
}
