import { jsonSchema } from "ai";
import { z } from "zod";
import type { CacheMetadata } from "./research";

export const deepDiveResultSchema = z.object({
  analysisLabel: z.string().min(3).max(160),
  analysisType: z.string().min(3).max(100),
  outcome: z.string().min(2).max(220),
  timeHorizon: z.string().min(2).max(120),
  resultRole: z.enum(["primary", "secondary", "exploratory", "methodological", "author-interpretation"]),
  resultText: z.string().min(8).max(520),
  estimate: z.string().max(220),
  exactExcerpt: z.string().max(420),
  locator: z.string().min(3).max(180),
  claimFrameId: z.enum(["weight-superiority", "free-living-weight-loss", "acute-satiety", "short-term-ldl"]),
  relation: z.enum(["supports", "contradicts", "qualifies", "undercuts", "bounds", "not-informative"]),
  scopeMatch: z.enum(["direct", "partial", "indirect"]),
  rationale: z.string().min(8).max(420),
});

export const deepDiveSchema = z.object({
  study: z.object({
    design: z.string().min(3).max(140),
    population: z.string().min(3).max(320),
    exposure: z.string().min(3).max(320),
    comparator: z.string().min(3).max(320),
    limitations: z.array(z.string().min(3).max(260)).min(1).max(6),
  }),
  evidenceFamily: z.object({
    label: z.string().min(3).max(160),
    reason: z.string().min(8).max(360),
  }),
  results: z.array(deepDiveResultSchema).min(1).max(6),
  authorConclusion: z.string().max(520),
  conclusionFit: z.enum(["matches-results", "broader-than-results", "narrower-than-results", "not-stated"]),
  extractionCaveat: z.string().min(8).max(420),
});

const unsupportedProviderKeywords = new Set([
  "minLength", "maxLength", "pattern", "format",
  "minimum", "maximum", "multipleOf",
  "patternProperties", "unevaluatedProperties", "propertyNames", "minProperties", "maxProperties",
  "unevaluatedItems", "contains", "minContains", "maxContains", "minItems", "maxItems", "uniqueItems",
]);

function removeUnsupportedProviderConstraints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeUnsupportedProviderConstraints);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !unsupportedProviderKeywords.has(key))
      .map(([key, child]) => [key, removeUnsupportedProviderConstraints(child)]),
  );
}

export const deepDiveProviderJsonSchema = removeUnsupportedProviderConstraints(
  z.toJSONSchema(deepDiveSchema),
) as ReturnType<typeof z.toJSONSchema>;

export const deepDiveOutputSchema = jsonSchema<z.infer<typeof deepDiveSchema>>(deepDiveProviderJsonSchema);

export type DeepDiveCandidate = z.infer<typeof deepDiveSchema>;
export type DeepDiveResult = z.infer<typeof deepDiveResultSchema>;

export type DeepDiveSource = {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  published: string;
  doi: string | null;
  url: string;
  abstract: string;
};

export type DeepDiveResponse = {
  source: DeepDiveSource;
  candidate: DeepDiveCandidate;
  model: string;
  verificationStatus: "abstract-only";
  cache: CacheMetadata;
};

export { defaultAbstractExtractorInstructions as deepDiveInstructions } from "./agent-prompts.ts";
