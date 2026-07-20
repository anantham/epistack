function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

export function stableSerialize(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export async function operationCacheKey(kind: string, contractVersion: string, input: unknown) {
  const bytes = new TextEncoder().encode(`${kind}\n${contractVersion}\n${stableSerialize(input)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${kind}:${hash}`;
}
