export type ContextualizeSessionState = {
  elicitationIndex: number;
  contextAnswers: Record<string, string>;
  contextSelections: Record<string, string[]>;
};

const emptyState: ContextualizeSessionState = {
  elicitationIndex: 0,
  contextAnswers: {},
  contextSelections: {},
};

function asAnswers(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function asSelections(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, selected]) => (
      Array.isArray(selected) && selected.every((item) => typeof item === "string")
        ? [[key, selected]]
        : []
    )),
  );
}

export function restoreContextualizeSession(
  raw: string | null,
  caseId: string,
  clusterCount: number,
): ContextualizeSessionState {
  if (!raw || !caseId) return { ...emptyState };
  try {
    const value = JSON.parse(raw) as {
      caseId?: unknown;
      contextAnswers?: unknown;
      contextSelections?: unknown;
      elicitationIndex?: unknown;
    };
    if (value.caseId !== caseId) return { ...emptyState };
    const numericIndex = typeof value.elicitationIndex === "number" && Number.isFinite(value.elicitationIndex)
      ? Math.floor(value.elicitationIndex)
      : 0;
    return {
      elicitationIndex: Math.min(Math.max(0, numericIndex), Math.max(0, clusterCount - 1)),
      contextAnswers: asAnswers(value.contextAnswers),
      contextSelections: asSelections(value.contextSelections),
    };
  } catch {
    return { ...emptyState };
  }
}

export function serializeContextualizeSession(caseId: string, state: ContextualizeSessionState) {
  return JSON.stringify({ caseId, ...state });
}
