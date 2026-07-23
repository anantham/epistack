export async function stableSemanticId(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 10)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function promotedResultSemanticKey(input: {
  sourceId: string;
  analysisLabel: string;
  analysisType: string;
  outcome: string;
  timeHorizon: string;
  resultRole: string;
  estimate: string;
  exactExcerpt: string;
  locator: string;
}) {
  // Result identity belongs to the source/analysis/result, not to a claim it
  // happens to bear on. Build the hash from an explicit allow-list so a caller
  // cannot accidentally reintroduce claim-specific fields through a wider
  // runtime object.
  return stableSemanticId({
    sourceId: input.sourceId,
    analysisLabel: input.analysisLabel,
    analysisType: input.analysisType,
    outcome: input.outcome,
    timeHorizon: input.timeHorizon,
    resultRole: input.resultRole,
    estimate: input.estimate,
    exactExcerpt: input.exactExcerpt,
    locator: input.locator,
  });
}
