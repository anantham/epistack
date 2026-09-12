import type { DecompositionResponse } from "./decomposition";
import { operationCacheKey } from "./operation-cache.ts";

export const decompositionCacheContract = "question-decomposition-orchestrator-v5";
export const decompositionBrowserCacheStorageKey = "epistack:decomposition-operation-cache:v5";
export const legacyDecompositionBrowserCacheStorageKey = "epistack:decomposition-operation-cache:v4";
export const browserDecompositionCacheLimit = 24;
export const browserDecompositionCacheTtlMs = 30 * 24 * 60 * 60 * 1000;

export type DecompositionCacheIdentity = {
  prompt: string;
  decisionContext: string;
  model: string;
  promptSignature: string;
};

export type BrowserDecompositionCacheEntry = {
  key: string;
  savedAt: string;
  lastAccessedAt: string;
  result: DecompositionResponse;
};

export type BrowserDecompositionCacheStore = {
  version: 1;
  entries: BrowserDecompositionCacheEntry[];
};

export function normalizeDecompositionText(value: string) {
  return value.normalize("NFKC").replace(/[^\S\r\n]+/gu, " ").replace(/\n\s*\n/g, "\n\n").trim();
}

export async function decompositionCacheEntryKey(identity: DecompositionCacheIdentity) {
  return operationCacheKey("question-decomposition", decompositionCacheContract, {
    prompt: normalizeDecompositionText(identity.prompt),
    decisionContext: normalizeDecompositionText(identity.decisionContext),
    model: identity.model.trim(),
    promptConfig: identity.promptSignature,
  });
}

function isDecompositionResponse(value: unknown): value is DecompositionResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<DecompositionResponse>;
  return typeof candidate.caseId === "string"
    && typeof candidate.prompt === "string"
    && Boolean(candidate.decomposition && typeof candidate.decomposition === "object");
}

export function emptyBrowserDecompositionCache(): BrowserDecompositionCacheStore {
  return { version: 1, entries: [] };
}

export function parseBrowserDecompositionCache(
  raw: string | null,
  now = Date.now(),
): BrowserDecompositionCacheStore {
  if (!raw) return emptyBrowserDecompositionCache();
  try {
    const parsed = JSON.parse(raw) as Partial<BrowserDecompositionCacheStore>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return emptyBrowserDecompositionCache();
    const minimumSavedAt = now - browserDecompositionCacheTtlMs;
    const seen = new Set<string>();
    const entries = parsed.entries
      .filter((entry): entry is BrowserDecompositionCacheEntry => {
        if (!entry || typeof entry !== "object") return false;
        if (typeof entry.key !== "string" || !entry.key) return false;
        if (typeof entry.savedAt !== "string" || !Number.isFinite(Date.parse(entry.savedAt))) return false;
        if (Date.parse(entry.savedAt) <= minimumSavedAt) return false;
        if (typeof entry.lastAccessedAt !== "string" || !Number.isFinite(Date.parse(entry.lastAccessedAt))) return false;
        if (!isDecompositionResponse(entry.result) || seen.has(entry.key)) return false;
        seen.add(entry.key);
        return true;
      })
      .sort((left, right) => Date.parse(right.lastAccessedAt) - Date.parse(left.lastAccessedAt))
      .slice(0, browserDecompositionCacheLimit);
    return { version: 1, entries };
  } catch {
    return emptyBrowserDecompositionCache();
  }
}

export function findBrowserDecompositionCacheEntry(
  store: BrowserDecompositionCacheStore,
  key: string,
) {
  return store.entries.find((entry) => entry.key === key) ?? null;
}

export function upsertBrowserDecompositionCacheEntry(
  store: BrowserDecompositionCacheStore,
  entry: BrowserDecompositionCacheEntry,
  limit = browserDecompositionCacheLimit,
): BrowserDecompositionCacheStore {
  const entries = [
    entry,
    ...store.entries.filter((candidate) => candidate.key !== entry.key),
  ]
    .sort((left, right) => Date.parse(right.lastAccessedAt) - Date.parse(left.lastAccessedAt))
    .slice(0, Math.max(1, limit));
  return { version: 1, entries };
}
