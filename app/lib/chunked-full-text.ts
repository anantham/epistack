import { z } from "zod";
import { deepDiveResultSchema, type DeepDiveResult } from "./deep-dive.ts";
import { fullPaperExtractionSchema, type AdversarialReview, type FullPaperExtraction } from "./dual-review.ts";

const defaultArtifactSentence = "Not stated in the preserved artifact.";

const optionalText = (max: number) => z.string().trim().min(3).max(max).optional();

const partialStudySchema = z.object({
  design: optionalText(320),
  population: optionalText(320),
  exposure: optionalText(320),
  comparator: optionalText(320),
  limitations: z.array(z.string().trim().min(3).max(260)).max(6).optional(),
  registrationId: z.string().trim().min(3).max(120).nullable().optional(),
  cohortIdentifiers: z.array(z.string().trim().min(2).max(120)).max(8).optional(),
});

const partialEvidenceFamilySchema = z.object({
  label: optionalText(160),
  reason: optionalText(360),
  basis: z.enum([
    "same-sample",
    "shared-registration",
    "review-reuses-primary-studies",
    "distinct-sample",
    "unknown",
  ]).optional(),
  dependsOn: z.array(z.string().trim().min(2).max(160)).max(16).optional(),
});

const sectionsReadSchema = z.object({
  methods: z.boolean(),
  results: z.boolean(),
  tables: z.boolean(),
  interpretation: z.boolean(),
  supplementaryMaterial: z.boolean(),
});

/** The deliberately small per-request extraction contract. The complete
 * deep-dive schema is applied after all bounded artifact segments are merged. */
export const chunkExtractionSchema = z.object({
  artifactHash: z.string().min(32).max(128),
  // The server overwrites these with the actual request position. They are
  // optional at parse time because a model cannot be trusted to count its
  // own parallel request batch reliably.
  chunkIndex: z.number().int().min(0).max(63).optional(),
  chunkCount: z.number().int().min(1).max(64).optional(),
  chunkRead: z.boolean(),
  sectionsRead: sectionsReadSchema,
  study: partialStudySchema.optional(),
  evidenceFamily: partialEvidenceFamilySchema.optional(),
  results: z.array(deepDiveResultSchema).max(6),
  authorConclusion: z.string().max(520).optional(),
  conclusionFit: z.enum(["matches-results", "broader-than-results", "narrower-than-results", "not-stated"]).optional(),
  extractionCaveat: z.string().max(420).optional(),
  inspectionNote: z.string().min(8).max(420),
});

const chunkFindingSchema = z.object({
  resultIndex: z.number().int().min(0).max(5),
  verdict: z.enum(["accept", "revise", "reject"]),
  quoteVerified: z.boolean(),
  locatorVerified: z.boolean(),
  scopeVerified: z.boolean(),
  relationVerified: z.boolean(),
  rationale: z.string().min(8).max(520),
  correctedResult: deepDiveResultSchema.nullable().optional(),
});

/** A reviewer may return no finding for a segment. The server merges these
 * findings and creates an explicit reject for any uncovered candidate. */
export const chunkReviewSchema = z.object({
  artifactHash: z.string().min(32).max(128),
  chunkIndex: z.number().int().min(0).max(63).optional(),
  chunkCount: z.number().int().min(1).max(64).optional(),
  chunkRead: z.boolean(),
  sectionsRead: sectionsReadSchema,
  findings: z.array(chunkFindingSchema).max(6),
  inspectionNote: z.string().min(8).max(420),
});

export type ChunkExtraction = z.infer<typeof chunkExtractionSchema>;
export type ChunkReview = z.infer<typeof chunkReviewSchema>;

export type ArtifactChunk = {
  index: number;
  count: number;
  start: number;
  end: number;
  text: string;
};

export type ChunkPromptContext = {
  question: string;
  decisionContext: string;
  citation: string;
  artifactHash: string;
  claimFrames: string;
  applicabilityProfile: string;
};

export function isRetryableChunkFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  const message = error instanceof Error ? error.message : String(error);
  return ["provider_transient", "backend-unreachable"].includes(code)
    || /prompt submission was not confirmed|provider transient|timed out|rate limited|HTTP (408|429|5\d\d)/i.test(message);
}

export function chunkRetryDelayMs(attempt: number) {
  return Math.min(4_000, 1_000 * (2 ** Math.max(0, attempt - 1)));
}

/** References and machine-generated trailing metadata are preserved in the
 * artifact and covered by its hash, but do not need to consume the bounded
 * model context used to review substantive study text. */
export function reviewableArtifactText(fullText: string) {
  const match = fullText.match(/\n(?:references|bibliography|reference list)\s*\n/i);
  return match?.index && match.index > 0 ? fullText.slice(0, match.index).trim() : fullText;
}

export function splitArtifactText(
  fullText: string,
  fits: (text: string) => boolean,
  options: { overlapChars?: number; maxChunks?: number } = {},
): ArtifactChunk[] {
  // Keep more overlap than the maximum exactExcerpt length so a passage that
  // crosses a segment boundary is still wholly visible in one request.
  const overlapChars = Math.max(0, options.overlapChars ?? 520);
  const maxChunks = Math.max(1, options.maxChunks ?? 64);
  if (!fullText) return [];
  if (fits(fullText)) return [{ index: 0, count: 1, start: 0, end: fullText.length, text: fullText }];

  const chunks: Array<Omit<ArtifactChunk, "index" | "count">> = [];
  let start = 0;
  while (start < fullText.length) {
    let low = start + 1;
    let high = fullText.length + 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (fits(fullText.slice(start, middle))) low = middle + 1;
      else high = middle;
    }
    let end = low - 1;
    if (end <= start) {
      throw new Error(`The bounded Lyra prompt has no room for artifact text at character ${start}. Compact the review context before retrying.`);
    }

    // Keep sentence/paragraph boundaries when there is room, while retaining
    // the fit guarantee established above.
    const boundarySearchStart = Math.max(start + 1, end - 600);
    const boundary = fullText.slice(boundarySearchStart, end).search(/\s(?=[^\s]*$)/);
    if (boundary >= 0) {
      const preferredEnd = boundarySearchStart + boundary;
      if (preferredEnd > start + Math.floor((end - start) * 0.65)) end = preferredEnd;
    }

    chunks.push({ start, end, text: fullText.slice(start, end) });
    if (end >= fullText.length) break;
    const overlap = Math.min(overlapChars, Math.max(0, Math.floor((end - start) / 3)));
    start = Math.max(start + 1, end - overlap);
    if (chunks.length >= maxChunks && start < fullText.length) {
      throw new Error(`The preserved artifact requires more than ${maxChunks} bounded Lyra requests.`);
    }
  }
  return chunks.map((chunk, index) => ({ ...chunk, index, count: chunks.length }));
}

export function buildExtractionChunkTask(context: ChunkPromptContext, chunk: ArtifactChunk) {
  return [
    "CHUNKED FULL-TEXT EXTRACTION",
    `This is artifact segment ${chunk.index + 1} of ${chunk.count}, character offsets ${chunk.start}-${chunk.end}. Inspect this entire segment. The server will merge every segment before applying the final schema and promotion gates.`,
    `RESEARCH QUESTION\n${context.question}`,
    `DECISION CONTEXT\n${context.decisionContext}`,
    `CITATION\n${context.citation}`,
    `ARTIFACT SHA-256\n${context.artifactHash}`,
    `CLAIM FRAMES\n${context.claimFrames}`,
    `LOCAL APPLICABILITY PROFILE\n${context.applicabilityProfile}`,
    "PRESERVED ARTIFACT SEGMENT",
    "----- BEGIN SEGMENT -----",
    chunk.text,
    "----- END SEGMENT -----",
    "Return one JSON object with artifactHash, chunkIndex, chunkCount, chunkRead, sectionsRead, optional directly-stated study/evidenceFamily fields, 0–6 directly reported result records, optional authorConclusion/conclusionFit/extractionCaveat, and inspectionNote. Each result contains the normal typed fields plus applicability; copy every exactExcerpt literally from this segment. Never paraphrase, add quotation marks, or use ellipses.",
  ].join("\n\n");
}

export function buildReviewChunkTask(context: ChunkPromptContext, chunk: ArtifactChunk, candidateJson: string) {
  return [
    "CHUNKED ADVERSARIAL FULL-TEXT REVIEW",
    `This is artifact segment ${chunk.index + 1} of ${chunk.count}, character offsets ${chunk.start}-${chunk.end}. Inspect this entire segment independently. Return findings only for indexed candidates materially addressed by this segment; return an empty findings array when none are addressed. The server will merge all segment findings conservatively.`,
    `RESEARCH QUESTION\n${context.question}`,
    `DECISION CONTEXT\n${context.decisionContext}`,
    `CITATION\n${context.citation}`,
    `ARTIFACT SHA-256\n${context.artifactHash}`,
    `CLAIM FRAMES\n${context.claimFrames}`,
    `LOCAL APPLICABILITY PROFILE\n${context.applicabilityProfile}`,
    "INDEXED PRIMARY CANDIDATES",
    candidateJson,
    "PRESERVED ARTIFACT SEGMENT",
    "----- BEGIN SEGMENT -----",
    chunk.text,
    "----- END SEGMENT -----",
    "For each finding, verify the quote, locator, result boundary, scope, relation, comparator, estimate, and polarity against this segment. Return one JSON object with artifactHash, chunkIndex, chunkCount, chunkRead, sectionsRead, findings, and inspectionNote. Corrected exactExcerpt values must be copied literally from the segment; never use ellipses or paraphrase.",
  ].join("\n\n");
}

export function planChunkedPrompts(input: {
  fullText: string;
  instructions: string;
  taskFor: (chunk: ArtifactChunk) => string;
  promptLimit: number;
  safetyMargin?: number;
  overlapChars?: number;
}) {
  const safetyMargin = input.safetyMargin ?? 450;
  const chunks = splitArtifactText(
    input.fullText,
    (text) => input.instructions.length + input.taskFor({ index: 0, count: 64, start: 0, end: text.length, text }).length <= input.promptLimit - safetyMargin,
    { overlapChars: input.overlapChars },
  );
  const tasks = chunks.map((chunk, index) => {
    const actual = { ...chunk, index, count: chunks.length };
    const size = input.instructions.length + input.taskFor(actual).length;
    if (size > input.promptLimit) throw new Error(`Chunk ${index + 1} still exceeds the bounded Lyra prompt limit (${size} characters).`);
    return input.taskFor(actual);
  });
  return { chunks, tasks };
}

function firstValue<T>(chunks: ChunkExtraction[], read: (chunk: ChunkExtraction) => T | undefined) {
  const ranked = [...chunks].sort((a, b) => {
    const score = (chunk: ChunkExtraction) => Number(chunk.sectionsRead.methods) * 4 + Number(chunk.sectionsRead.results) * 3 + Number(chunk.sectionsRead.interpretation) * 2 + Number(chunk.sectionsRead.tables);
    return score(b) - score(a);
  });
  return ranked.map(read).find((value) => value !== undefined && value !== "");
}

function mergePartialObject<T extends Record<string, unknown>>(chunks: ChunkExtraction[], read: (chunk: ChunkExtraction) => T | undefined) {
  const output: Record<string, unknown> = {};
  for (const chunk of chunks) {
    const candidate = read(chunk);
    if (!candidate) continue;
    for (const [key, value] of Object.entries(candidate)) {
      if (value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0) && output[key] === undefined) output[key] = value;
    }
  }
  return output;
}

function resultKey(result: DeepDiveResult) {
  return `${result.analysisLabel.trim().toLocaleLowerCase("en")}\u0000${result.exactExcerpt.trim().toLocaleLowerCase("en")}`;
}

export function mergeChunkExtractions(chunks: ChunkExtraction[], artifactHash: string): FullPaperExtraction {
  const validChunks = chunks.filter((chunk) => chunk.chunkRead && chunk.artifactHash === artifactHash);
  const mergedStudy = mergePartialObject(validChunks, (chunk) => chunk.study);
  const mergedFamily = mergePartialObject(validChunks, (chunk) => chunk.evidenceFamily);
  const results: DeepDiveResult[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    for (const result of chunk.results) {
      const key = resultKey(result);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(result);
      if (results.length >= 6) break;
    }
    if (results.length >= 6) break;
  }
  const sourceInspection = {
    artifactHash,
    fullTextRead: validChunks.length === chunks.length && chunks.length > 0,
    methodsRead: chunks.some((chunk) => chunk.sectionsRead.methods),
    resultsRead: chunks.some((chunk) => chunk.sectionsRead.results),
    tablesRead: chunks.some((chunk) => chunk.sectionsRead.tables),
    supplementaryMaterialChecked: chunks.some((chunk) => chunk.sectionsRead.supplementaryMaterial),
    inspectionNote: `Lyra inspected ${chunks.length} bounded artifact segments with overlap before server-side merge.`,
  };
  return fullPaperExtractionSchema.parse({
    study: {
      design: mergedStudy.design ?? defaultArtifactSentence,
      population: mergedStudy.population ?? defaultArtifactSentence,
      exposure: mergedStudy.exposure ?? defaultArtifactSentence,
      comparator: mergedStudy.comparator ?? defaultArtifactSentence,
      limitations: mergedStudy.limitations ?? [defaultArtifactSentence],
      registrationId: mergedStudy.registrationId ?? null,
      cohortIdentifiers: mergedStudy.cohortIdentifiers ?? [],
    },
    evidenceFamily: {
      label: mergedFamily.label ?? defaultArtifactSentence,
      reason: mergedFamily.reason ?? defaultArtifactSentence,
      basis: mergedFamily.basis ?? "unknown",
      dependsOn: mergedFamily.dependsOn ?? [],
    },
    results,
    authorConclusion: firstValue(chunks, (chunk) => chunk.authorConclusion) ?? "",
    conclusionFit: firstValue(chunks, (chunk) => chunk.conclusionFit) ?? "not-stated",
    extractionCaveat: firstValue(chunks, (chunk) => chunk.extractionCaveat) ?? defaultArtifactSentence,
    sourceInspection,
  });
}

function findingPriority(finding: ChunkReview["findings"][number]) {
  return { reject: 3, revise: 2, accept: 1 }[finding.verdict];
}

export function mergeChunkReviews(chunks: ChunkReview[], primary: FullPaperExtraction, artifactHash: string): AdversarialReview {
  const grouped = new Map<number, ChunkReview["findings"]>();
  for (const chunk of chunks) {
    if (chunk.artifactHash !== artifactHash || !chunk.chunkRead) continue;
    for (const finding of chunk.findings) {
      const existing = grouped.get(finding.resultIndex) ?? [];
      existing.push(finding);
      grouped.set(finding.resultIndex, existing);
    }
  }
  const reviews = primary.results.map((_, resultIndex) => {
    const candidates = grouped.get(resultIndex) ?? [];
    const selected = [...candidates].sort((a, b) => findingPriority(b) - findingPriority(a))[0];
    return selected ?? {
      resultIndex,
      verdict: "reject" as const,
      quoteVerified: false,
      locatorVerified: false,
      scopeVerified: false,
      relationVerified: false,
      rationale: `No bounded reviewer segment returned a finding for resultIndex ${resultIndex}. The result remains rejected until a reviewer explicitly covers it.`,
      correctedResult: null,
    };
  });
  const methodsRead = chunks.some((chunk) => chunk.sectionsRead.methods);
  const resultsRead = chunks.some((chunk) => chunk.sectionsRead.results);
  const completeRead = chunks.length > 0 && chunks.every((chunk) => chunk.chunkRead && chunk.artifactHash === artifactHash);
  return {
    artifactHash,
    independentlyReadFullText: completeRead,
    methodsAndResultsRead: completeRead && methodsRead && resultsRead,
    overallAssessment: `The adversarial reviewer inspected ${chunks.length} bounded artifact segments and merged findings conservatively.`,
    reviews,
  };
}
