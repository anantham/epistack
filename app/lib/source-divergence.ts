import { z } from "zod";

export const comparisonScopeSchema = z.object({
  topic: z.string().min(2).max(200),
  population: z.string().min(2).max(220),
  jurisdiction: z.string().min(2).max(160),
  effectiveFrom: z.string().max(60).optional(),
  effectiveTo: z.string().max(60).optional(),
});

export type ComparisonScope = z.infer<typeof comparisonScopeSchema>;

export const divergenceVerdictSchema = z.enum(["contradicts", "differs-by-scope", "consistent", "indeterminate"]);
export type DivergenceVerdict = z.infer<typeof divergenceVerdictSchema>;

export type DivergenceItem = {
  id: string;
  sourceClass: string;
  statement: string;
  comparisonScope: ComparisonScope;
};

export type Divergence = {
  aId: string;
  bId: string;
  scopeMatch: "same" | "partial" | "different";
  verdict: DivergenceVerdict;
  rationale: string;
};

function normalize(value: string | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// "same" requires topic, population, and jurisdiction to match (an empty field is
// treated as a wildcard). "partial" means same topic but a different population or
// jurisdiction — i.e. a difference of scope, not necessarily a contradiction.
export function scopeMatch(a: ComparisonScope, b: ComparisonScope): "same" | "partial" | "different" {
  const equal = (x: string | undefined, y: string | undefined) => {
    const left = normalize(x);
    const right = normalize(y);
    return !left || !right || left === right;
  };
  if (!equal(a.topic, b.topic)) return "different";
  if (equal(a.population, b.population) && equal(a.jurisdiction, b.jurisdiction)) return "same";
  return "partial";
}

export function divergencePairs(items: DivergenceItem[]): Array<[DivergenceItem, DivergenceItem]> {
  const pairs: Array<[DivergenceItem, DivergenceItem]> = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) pairs.push([items[i], items[j]]);
  }
  return pairs;
}

export function buildDivergencePrompt(items: DivergenceItem[]) {
  const pairs = divergencePairs(items).map(([a, b]) => ({
    a: { id: a.id, sourceClass: a.sourceClass, statement: a.statement, scope: a.comparisonScope },
    b: { id: b.id, sourceClass: b.sourceClass, statement: b.statement, scope: b.comparisonScope },
    scopeMatch: scopeMatch(a.comparisonScope, b.comparisonScope),
  }));
  return [
    "You compare normative and descriptive sources for divergence. This is context, never causal evidence.",
    "For each pair decide:",
    "- contradicts: the recommendations genuinely conflict for the same topic, population, and jurisdiction.",
    "- differs-by-scope: they differ because population, jurisdiction, or effective dates differ (not a true contradiction).",
    "- consistent: they agree or are compatible.",
    "- indeterminate: the supplied statements are insufficient to tell.",
    "Always respect scopeMatch: 'different' or 'partial' scope can be contradicts only if the statements clearly conflict despite the scope difference.",
    "Return only JSON matching this schema. No markdown fences.",
    JSON.stringify(z.toJSONSchema(divergenceResponseSchema)),
    JSON.stringify(pairs),
  ].join("\n");
}

export const divergenceResponseSchema = z.object({
  divergences: z.array(z.object({
    aId: z.string().min(1).max(120),
    bId: z.string().min(1).max(120),
    verdict: divergenceVerdictSchema,
    rationale: z.string().min(8).max(480),
  })).max(60),
});

// Merge the model verdicts with the deterministic scope match, dropping pairs the
// model omitted and coercing scope-driven differences to "differs-by-scope".
export function assembleDivergences(items: DivergenceItem[], model: z.infer<typeof divergenceResponseSchema>): Divergence[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return model.divergences.flatMap((entry) => {
    const a = byId.get(entry.aId);
    const b = byId.get(entry.bId);
    if (!a || !b) return [];
    const match = scopeMatch(a.comparisonScope, b.comparisonScope);
    const verdict: DivergenceVerdict = match === "different" && entry.verdict === "contradicts"
      ? "differs-by-scope"
      : entry.verdict;
    return [{ aId: entry.aId, bId: entry.bId, scopeMatch: match, verdict, rationale: entry.rationale }];
  });
}

// Context-only comparison; these verdicts are never causal evidence.
export async function computeDivergence(items: DivergenceItem[]): Promise<Divergence[]> {
  if (items.length < 2) return [];

  // Load the Workers runtime only when a hosted comparison is requested.
  const { runLyraStage } = await import("./lyra-stage.ts");
  const text = await runLyraStage({
    model: "lyra-chatgpt-pro",
    effort: "medium",
    input: buildDivergencePrompt(items),
  });
  let parsed: z.infer<typeof divergenceResponseSchema>;
  try {
    const json = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = divergenceResponseSchema.parse(JSON.parse(json));
  } catch {
    throw new Error("The divergence model returned invalid JSON or a response that does not match the divergence schema.");
  }
  return assembleDivergences(items, parsed);
}
