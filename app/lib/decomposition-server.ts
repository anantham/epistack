import { z } from "zod";
import { jsonSchema } from "ai";
import type {
  DecompositionCluster,
  DecompositionArtifact,
  QuestionHighlight,
  ContextQuestion,
} from "./decomposition";

export const decompositionSchema = z.object({
  caseTitle: z.string().min(3).max(90),
  summary: z.string().min(12).max(320),
  highlights: z.array(z.object({
    quote: z.string().min(1).max(180),
    label: z.string().min(2).max(80),
    why: z.string().min(4).max(220),
    clusterId: z.string().min(1).max(48),
  })).min(2).max(8),
  clusters: z.array(z.object({
    id: z.string().min(1).max(48),
    label: z.string().min(2).max(90),
    highlightQuotes: z.array(z.string().min(1).max(180)).min(1).max(5),
    latentVariable: z.string().min(2).max(140),
    rationale: z.string().min(4).max(280),
    ingestionRequirements: z.object({
      requiredFields: z.array(z.string().min(2).max(100)).min(2).max(8),
      searchConcepts: z.array(z.string().min(2).max(100)).min(2).max(8),
      mismatchRisks: z.array(z.string().min(2).max(140)).min(1).max(6),
    }),
    contextQuestion: z.object({
      id: z.string().min(1).max(48),
      label: z.string().min(2).max(80),
      question: z.string().min(4).max(220),
      whyItMatters: z.string().min(4).max(260),
      effect: z.enum(["prune", "branch", "match"]),
      options: z.array(z.string().min(1).max(100)).min(2).max(5),
    }),
  })).min(2).max(7),
  claimTemplate: z.string().min(12).max(700),
  knownUnknowns: z.array(z.string().min(4).max(220)).min(3).max(8),
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

export const decompositionProviderJsonSchema = removeUnsupportedProviderConstraints(
  z.toJSONSchema(decompositionSchema),
) as ReturnType<typeof z.toJSONSchema>;

export const decompositionOutputSchema = jsonSchema<z.infer<typeof decompositionSchema>>(
  decompositionProviderJsonSchema,
);

// The live compiler deliberately uses three smaller contracts instead of asking
// one model call to fill the entire persistent artifact. Each specialist can be
// validated, retried, or replaced without discarding the other work.
export const dimensionScoutSchema = z.object({
  caseTitle: z.string().min(3),
  summary: z.string().min(8),
  dimensions: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(2),
  })).min(2).max(7),
});

export const traceAgentSchema = z.object({
  traces: z.array(z.object({
    dimensionId: z.string().min(1),
    label: z.string().min(2),
    quotes: z.array(z.string().min(1)).min(1),
    latentVariable: z.string().min(2),
    rationale: z.string().min(4),
  })).min(2),
});

export const contextAgentSchema = z.object({
  enrichments: z.array(z.object({
    dimensionId: z.string().min(1),
    requiredFields: z.array(z.string().min(1)).min(1),
    searchConcepts: z.array(z.string().min(1)).min(1),
    mismatchRisks: z.array(z.string().min(1)).min(1),
    contextQuestion: z.object({
      id: z.string().min(1),
      label: z.string().min(2),
      question: z.string().min(4),
      whyItMatters: z.string().min(4),
      effect: z.enum(["prune", "branch", "match"]),
      options: z.array(z.string().min(1)).min(1),
    }),
  })).min(1),
  claimTemplate: z.string().min(8),
  knownUnknowns: z.array(z.string().min(2)).min(1),
});

export type DimensionScout = z.infer<typeof dimensionScoutSchema>;
export type TraceAgentResult = z.infer<typeof traceAgentSchema>;
export type ContextAgentResult = z.infer<typeof contextAgentSchema>;

export const dimensionScoutOutputSchema = jsonSchema<DimensionScout>(
  removeUnsupportedProviderConstraints(z.toJSONSchema(dimensionScoutSchema)) as ReturnType<typeof z.toJSONSchema>,
);
export const traceAgentOutputSchema = jsonSchema<TraceAgentResult>(
  removeUnsupportedProviderConstraints(z.toJSONSchema(traceAgentSchema)) as ReturnType<typeof z.toJSONSchema>,
);
export const contextAgentOutputSchema = jsonSchema<ContextAgentResult>(
  removeUnsupportedProviderConstraints(z.toJSONSchema(contextAgentSchema)) as ReturnType<typeof z.toJSONSchema>,
);

export const decompositionInstructions = `You are the question-compilation operator in an epistemic research system.

Turn a vague paragraph into a compact, human-editable interpretation map. Do not answer it and do not retrieve evidence. Expose the substantive sub-questions, hidden decisions, and unknowns that would materially change the answer or the evidence search. Do not produce dictionary senses or cosmetic distinctions.

GRAMMAR GROUNDING
- Begin with roles in the submitted language: frame or modal, subject, verb or action, object, adjective or qualifier, and materially implied terms. Every semantic cluster must trace to one or more exact quoted cues, even when the cues are separated in the sentence.
- Then translate the grammatical cue into a decision-relevant latent variable. "Good", "better", "worth", and "should" usually hide an outcome, value, stakeholder, or trade-off. A verb often hides dose, feasibility, implementation, or a counterfactual. A noun often hides subtype or construct validity.

RECURRING LENSES — check each and use only those that matter:
- frame and values: good or worthwhile by which measure, for whose objective?
- what exactly: which subtype, operational definition, intervention, or scope?
- versus what: the actual counterfactual or feasible comparator, including status quo or do nothing. Include this for causal, comparative, and decision questions.
- who or jurisdiction: for whom, whose decision, which authority, which population?
- where and context of use: setting, geography, market, implementation environment?
- when and time horizon: immediate mechanism, decision horizon, or durable outcome?
- how much: dose, number, frequency, duration, and the threshold where the answer could flip?
- feasibility and failure: can it be done, at what effort, and what happens if it fails?
- cost all-in versus means: financing, incentives, operating cost, opportunity cost, and affordability?
- downside, world model, and personal fit: risks, future assumptions, routine, preferences, and constraints?
- legal or regulatory regime: rights, protections, taxation, lock-in, rules, and authority where relevant.

HARD LESSONS
- OPTIONS ARE BUNDLES. Alternatives are often different real scenarios, not one object with one field changed. Decompose each bundle. A rent-home and the buy-home may differ in location, commute, rights, maintenance, and financial exposure.
- CONSTRAINT CASCADE. Trace variables that force downstream choices: budget → feasible home → neighbourhood → commute; time available → training route → reachable skill → job prospects.
- Concrete beats categorical. Use quantitative or observable branches when possible: one egg/day versus three or more; less than three years versus ten or more; a specific replacement food rather than "moderation".
- Preserve uncertainty. Branches are alternative scopes, not truth hypotheses. Never invent facts absent from the paragraph or known context.

TRANSFER THE METHOD FROM THESE WORKED EXAMPLES — do not copy their nouns into unrelated cases:

"Are eggs good to eat?"
- frame "good" → good for what: cardiovascular events, mortality, diabetes, satiety or weight, protein, micronutrients, ethics.
- object "eggs" → what counts: whole versus whites, standard versus fortified, preparation and production when evidentially relevant.
- verb "eat" → dose, frequency, preparation, and versus what: one/day or three+/day; boiled or fried; replacing refined carbohydrate, meat, or nothing.
- implied subject → for whom: healthy adults, diabetes, high LDL or hyper-response, athlete, child, older adult.

"Should I switch careers into software engineering?"
- frame "should" → goals: income, location freedom, family time, enjoyment, flexibility.
- destination → frontend, backend, data/ML, employee, consultant, startup, large company.
- subject "I" → career capital, transferable skills, education, network, hiring access.
- verb "switch" → time and cost to job-ready, income gap, probability of hire, downside if it fails.
- implied future and fit → the AI-disruption world model and whether the daily work suits the asker.

"Should we build more nuclear power plants?"
- frame "should" → climate, system cost, energy security, safety, waste, public welfare.
- subject "we" → jurisdiction, authority, delivery capability, and historical track record.
- "build more" → baseline fleet, increment, technology, construction time, financing, fuel, and waste.
- implied comparator → coal or gas, renewables plus storage, life extension, demand reduction, or no build.

"Is it better to rent or buy a home?"
- budget is the pivot: rent-budget and buy-budget purchase different bundles, often in different places.
- cascade each bundle into home, neighbourhood, commute, school access, legal rights, maintenance, and total cost.
- compare rent-and-invest-the-difference, transaction costs, taxes, flexibility, and the break-even time horizon.

OUTPUT RULES
- Identify 4–7 decision-relevant dimensions. Avoid exhaustive combinatorics.
- Every highlight quote is an exact, case-sensitive substring of the submitted paragraph and links to a specific dimension (cluster).
- For each dimension, provide a concise audit trace: quoted cues, latent variable, rationale, required evidence fields, search concepts, and mismatch risks.
- Generate exactly ONE contextQuestion per dimension to ground the decision in the user's specific reality (e.g. demographics, location, budget, logistical details, current routine).
- Use stable lowercase kebab-case ids.
- claimTemplate is a grammatical research question using placeholders exactly as {{dimension-id}}.
- knownUnknowns are worth recording but not important enough to become dimensions.
- Be concise, methodologically neutral, and domain-general.`;

export {
  defaultContextRetrievalInstructions as contextAgentInstructions,
  defaultDimensionScoutInstructions as dimensionScoutInstructions,
  defaultTraceSpecialistInstructions as traceAgentInstructions,
} from "./agent-prompts.ts";

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42) || "question";
}


const traceSpecs: Record<string, Omit<DecompositionCluster, "id" | "highlightQuotes" | "contextQuestion">> = {
  subject: {
    label: "Object or construct",
    latentVariable: "The precise object, action, or construct being evaluated",
    rationale: "Everyday nouns often collapse materially different objects that should retrieve different evidence.",
    ingestionRequirements: {
      requiredFields: ["construct definition", "operationalization", "object or intervention subtype"],
      searchConcepts: ["synonyms and taxonomies", "construct-specific terminology"],
      mismatchRisks: ["Evidence about a neighboring construct may be treated as direct evidence."],
    },
  },
  exposure: {
    label: "Dose and frequency",
    latentVariable: "Dose, frequency, duration, preparation, and mode of exposure",
    rationale: "Action words and qualifiers such as moderation jointly determine what the exposure actually is.",
    ingestionRequirements: {
      requiredFields: ["dose or amount", "frequency", "exposure duration", "preparation or delivery mode"],
      searchConcepts: ["daily and weekly exposure terms", "dose-response terminology", "adherence"],
      mismatchRisks: ["Studies with incompatible doses or frequencies may be pooled as if they tested the same exposure."],
    },
  },
  outcome: {
    label: "Outcome construct",
    latentVariable: "The measurable benefit, harm, or success criterion carrying the conclusion",
    rationale: "Evaluative words hide multiple outcomes that can move independently or trade off.",
    ingestionRequirements: {
      requiredFields: ["outcome definition", "measurement instrument", "effect size", "outcome timing"],
      searchConcepts: ["benefit and harm outcomes", "validated outcome measures"],
      mismatchRisks: ["A proxy or rhetorical success claim may substitute for the decision-relevant outcome."],
    },
  },
  population: {
    label: "Population and setting",
    latentVariable: "Who or where the conclusion is intended to generalize to",
    rationale: "Population language signals heterogeneity and transportability constraints.",
    ingestionRequirements: {
      requiredFields: ["eligibility criteria", "baseline characteristics", "geography", "setting"],
      searchConcepts: ["subgroup terms", "effect modifiers", "external validity"],
      mismatchRisks: ["Average results may be transported to a population absent from the source."],
    },
  },
  comparator: {
    label: "Comparator",
    latentVariable: "The baseline or counterfactual against which the subject is evaluated",
    rationale: "A claim cannot be interpreted causally without saying what happens instead.",
    ingestionRequirements: {
      requiredFields: ["comparator definition", "co-interventions", "baseline exposure"],
      searchConcepts: ["versus and comparator terms", "usual care or status quo"],
      mismatchRisks: ["A weak or incomparable baseline can manufacture an apparent advantage."],
    },
  },
  context: {
    label: "Context and implementation",
    latentVariable: "The surrounding conditions under which the relationship is expected to hold",
    rationale: "Implementation and setting can turn the nominally same intervention into a different program.",
    ingestionRequirements: {
      requiredFields: ["implementation details", "setting", "co-exposures"],
      searchConcepts: ["implementation fidelity", "real-world effectiveness"],
      mismatchRisks: ["Nominally identical programs may differ in their active ingredients."],
    },
  },
  horizon: {
    label: "Time horizon",
    latentVariable: "The period over which an outcome must appear and persist",
    rationale: "Immediate mechanisms, short-term outcomes, and durable effects are different claims.",
    ingestionRequirements: {
      requiredFields: ["follow-up duration", "measurement schedule", "attrition by timepoint"],
      searchConcepts: ["short-term and long-term follow-up", "durability"],
      mismatchRisks: ["Short studies may be used to support claims about durable outcomes."],
    },
  },
};

function exactMatches(prompt: string, candidates: string[]) {
  const lower = prompt.toLowerCase();
  return candidates.flatMap((candidate) => {
    const index = lower.indexOf(candidate.toLowerCase());
    return index >= 0 ? [{ quote: prompt.slice(index, index + candidate.length), index, end: index + candidate.length }] : [];
  });
}


export function createFallbackDecomposition(prompt: string, decisionContext = ""): DecompositionArtifact {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  const subject = oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
  const dimensions = [
    {
      id: "subject",
      label: "What exactly is being discussed?",
      question: "Which concrete object, action, policy, or proposition is the real subject?",
    },
    {
      id: "exposure",
      label: "How much, how often, and in what form?",
      question: "What dose, frequency, duration, preparation, or implementation defines the exposure?",
    },
    {
      id: "population",
      label: "For whom or where?",
      question: "What population, jurisdiction, site, or stakeholder should the answer apply to?",
    },
    {
      id: "comparator",
      label: "Compared with what?",
      question: "What alternative, baseline, or counterfactual makes the claim meaningful?",
    },
    {
      id: "outcome",
      label: "What would count as good or bad?",
      question: "Which measurable outcome carries the conclusion?",
    },
  ];

  const stopWords = new Set(["about", "after", "before", "could", "does", "from", "have", "how", "should", "their", "there", "these", "those", "what", "when", "where", "which", "would"]);
  const words = [...prompt.matchAll(/\b[A-Za-z][A-Za-z'-]{1,}\b/g)]
    .map((match) => match[0])
    .filter((word, index, all) => !stopWords.has(word.toLowerCase()) && all.findIndex((candidate) => candidate.toLowerCase() === word.toLowerCase()) === index);

  const clusters = dimensions.map((dim, index) => {
    const quote = words[index] ?? words[index % Math.max(1, words.length)] ?? prompt.slice(0, Math.min(80, prompt.length));
    return {
      id: `${dim.id}-cues`,
      label: compact(dim.label, 90),
      highlightQuotes: [quote],
      latentVariable: compact(dim.question, 140),
      rationale: compact(`The quoted cue leaves ${dim.label.toLowerCase()} underspecified.`, 280),
      ingestionRequirements: genericIngestion(dim.label),
      contextQuestion: {
        id: `context-${dim.id}`,
        label: dim.label,
        question: `Can you provide more details about ${dim.label}?`,
        whyItMatters: "Helps ground the dimension in your reality.",
        effect: "match" as const,
        options: ["Option 1", "Option 2"],
      }
    };
  });

  const highlights = clusters.map(cluster => ({
    quote: cluster.highlightQuotes[0],
    label: cluster.label,
    why: cluster.rationale,
    clusterId: cluster.id,
  }));

  return {
    caseTitle: oneLine.split(/[?.!]/)[0].slice(0, 86) || "Untitled question",
    summary: "A local, domain-general decomposition is shown because a model connection is not configured.",
    highlights,
    clusters,
    claimTemplate: "For {{population}}, does {{exposure}} of {{subject}} lead to {{outcome}}, compared with {{comparator}}?",
    knownUnknowns: [
      "Whether the everyday terms map cleanly to measurable constructs",
      "Whether the available evidence matches the intended population and setting",
      "Whether important outcomes or stakeholder perspectives are missing",
      "What new evidence would be most likely to change the conclusion",
    ],
  };
}
function compact(value: string, maximum: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}


function genericIngestion(label: string) {
  return {
    requiredFields: [
      compact(`${label} operational definition`, 100),
      "measurement, coding, or implementation details",
    ],
    searchConcepts: [compact(label, 100), "related terms or synonyms"],
    mismatchRisks: [compact(`Sources may use a materially different definition of ${label}.`, 140)],
  };
}

function genericTraceForDimensions(prompt: string, dimensions: { id: string; label: string }[]) {
  const stopWords = new Set(["about", "after", "before", "could", "does", "from", "have", "how", "should", "their", "there", "these", "those", "what", "when", "where", "which", "would"]);
  const words = [...prompt.matchAll(/\b[A-Za-z][A-Za-z'-]{1,}\b/g)]
    .map((match) => match[0])
    .filter((word, index, all) => !stopWords.has(word.toLowerCase()) && all.findIndex((candidate) => candidate.toLowerCase() === word.toLowerCase()) === index);
  return dimensions.slice(0, Math.min(7, Math.max(2, words.length))).map((dimension, index) => {
    const quote = words[index] ?? words[index % Math.max(1, words.length)] ?? prompt.slice(0, Math.min(80, prompt.length));
    return {
      id: `${dimension.id}-cues`,
      label: compact(dimension.label, 90),
      highlightQuotes: [quote],
      latentVariable: compact(dimension.label, 140),
      rationale: compact(`The quoted cue leaves ${dimension.label.toLowerCase()} underspecified and changes which scoped claim should be investigated.`, 280),
      ingestionRequirements: genericIngestion(dimension.label),
      contextQuestion: {
        id: `context-${dimension.id}`,
        label: dimension.label,
        question: `Can you provide more details about ${dimension.label}?`,
        whyItMatters: "Helps ground the dimension in your reality.",
        effect: "match",
        options: ["Option 1", "Option 2"],
      }
    } satisfies DecompositionCluster;
  });
}

export function normalizeDimensionScout(scout: DimensionScout): DimensionScout {
  const usedIds = new Set<string>();
  const dimensions = scout.dimensions.slice(0, 7).map((dimension, index) => {
    const baseId = slug(dimension.id || dimension.label || `dimension-${index + 1}`);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId.slice(0, 38)}-${suffix++}`;
    usedIds.add(id);
    return {
      id,
      label: compact(dimension.label, 90),
    };
  });
  return {
    caseTitle: compact(scout.caseTitle, 90),
    summary: compact(scout.summary, 320),
    dimensions,
  };
}

export function assembleDecomposition(
  scout: DimensionScout,
  traceResult: TraceAgentResult | null,
  contextResult: ContextAgentResult | null,
  prompt: string,
  decisionContext = "",
): DecompositionArtifact {
  scout = normalizeDimensionScout(scout);
  const usedDimensionIds = new Set<string>();
  const dimensions = scout.dimensions.slice(0, 7).map((dimension) => {
    usedDimensionIds.add(dimension.id);
    return dimension;
  });

  const enrichmentByDimension = new Map(
    (contextResult?.enrichments ?? [])
      .filter((item) => usedDimensionIds.has(item.dimensionId))
      .map((item) => [item.dimensionId, item]),
  );

  function ingestionFor(dimension: { id: string; label: string }) {
    const proposed = enrichmentByDimension.get(dimension.id);
    if (!proposed) return genericIngestion(dimension.label);
    const fallback = genericIngestion(dimension.label);
    const requiredFields = proposed.requiredFields.map((item) => compact(item, 100)).filter(Boolean).slice(0, 8);
    const searchConcepts = proposed.searchConcepts.map((item) => compact(item, 100)).filter(Boolean).slice(0, 8);
    const mismatchRisks = proposed.mismatchRisks.map((item) => compact(item, 140)).filter(Boolean).slice(0, 6);
    while (requiredFields.length < 2) requiredFields.push(fallback.requiredFields[requiredFields.length]);
    while (searchConcepts.length < 2) searchConcepts.push(fallback.searchConcepts[searchConcepts.length]);
    if (!mismatchRisks.length) mismatchRisks.push(fallback.mismatchRisks[0]);
    return { requiredFields, searchConcepts, mismatchRisks };
  }

  function questionFor(dimension: { id: string; label: string }): ContextQuestion {
    const proposed = enrichmentByDimension.get(dimension.id);
    const q = proposed?.contextQuestion;
    if (q && q.options.length > 0) {
      const options = q.options.map((opt) => compact(opt, 100)).filter(Boolean).slice(0, 5);
      if (options.length === 1) options.push("Something else or not yet decided");
      return {
        id: slug(q.id || `context-${dimension.id}`),
        label: compact(q.label, 80),
        question: compact(q.question, 220),
        whyItMatters: compact(q.whyItMatters, 260),
        effect: q.effect,
        options,
      };
    }
    return {
      id: `context-${dimension.id}`,
      label: dimension.label,
      question: `Can you provide more details about ${dimension.label}?`,
      whyItMatters: "Helps ground the dimension in your reality.",
      effect: "match",
      options: ["Option 1", "Option 2"],
    };
  }

  const seenTraceDimensions = new Set<string>();
  const validTraces = (traceResult?.traces ?? [])
    .map((trace) => ({
      ...trace,
      quotes: Array.from(new Set(trace.quotes))
        .filter((quote) => quote.length > 0 && quote.length <= 180 && prompt.includes(quote)),
    }))
    .filter((trace) => {
      if (!usedDimensionIds.has(trace.dimensionId) || !trace.quotes.length || seenTraceDimensions.has(trace.dimensionId)) return false;
      seenTraceDimensions.add(trace.dimensionId);
      return true;
    })
    .slice(0, 7);
    
  let highlightBudget = 8;
  let clusters: DecompositionCluster[] = validTraces
    .map((trace, index) => {
      const dimension = dimensions.find((candidate) => candidate.id === trace.dimensionId)!;
      const reserved = validTraces.length - index - 1;
      const quotes = trace.quotes.slice(0, Math.min(4, highlightBudget - reserved));
      highlightBudget -= quotes.length;
      return {
        id: `${trace.dimensionId}-cues`,
        label: compact(trace.label, 90),
        highlightQuotes: quotes,
        latentVariable: compact(trace.latentVariable, 140),
        rationale: compact(trace.rationale, 280),
        ingestionRequirements: ingestionFor(dimension),
        contextQuestion: questionFor(dimension),
      };
    })
    .filter((cluster) => cluster.highlightQuotes.length > 0)
    .slice(0, 7);

  const fallback = createFallbackDecomposition(prompt, decisionContext);
  
  if (clusters.length < 2) {
    clusters = fallback.clusters.slice(0, 7);
  }
  clusters = clusters.slice(0, 7);
  
  const highlights = clusters.flatMap((cluster) => cluster.highlightQuotes.map((quote) => ({
    quote,
    label: cluster.label,
    why: cluster.rationale,
    clusterId: cluster.id,
  }))).slice(0, 8);
  
  const usedHighlightQuotes = new Set(highlights.map((highlight) => highlight.quote));
  clusters = clusters
    .map((cluster) => ({ ...cluster, highlightQuotes: cluster.highlightQuotes.filter((quote) => usedHighlightQuotes.has(quote)) }))
    .filter((cluster) => cluster.highlightQuotes.length > 0);

  const knownUnknowns = (contextResult?.knownUnknowns ?? [])
    .map((unknown) => compact(unknown, 220))
    .filter(Boolean)
    .slice(0, 8);
  for (const fallbackUnknown of fallback.knownUnknowns) {
    if (knownUnknowns.length >= 3) break;
    if (!knownUnknowns.includes(fallbackUnknown)) knownUnknowns.push(fallbackUnknown);
  }
  const defaultTemplate = `For the concrete case, how do ${dimensions.slice(0, 5).map((dim) => `{{${dim.id}}}`).join(", ")} change the decision-relevant outcome?`;

  return sanitizeDecomposition({
    caseTitle: compact(scout.caseTitle, 90),
    summary: compact(scout.summary, 320),
    highlights,
    clusters,
    claimTemplate: compact(contextResult?.claimTemplate || defaultTemplate, 700),
    knownUnknowns,
  }, prompt, decisionContext);
}

export function sanitizeDecomposition(
  artifact: DecompositionArtifact,
  prompt: string,
  decisionContext = "",
): DecompositionArtifact {
  const fallback = createFallbackDecomposition(prompt, decisionContext);
  const clusters = artifact.clusters.filter(
    (cluster) => cluster.highlightQuotes.length > 0
      && cluster.highlightQuotes.every((quote) => prompt.includes(quote)),
  );
  const clusterIds = new Set(clusters.map((cluster) => cluster.id));
  const highlights = artifact.highlights.filter(
    (highlight) => prompt.includes(highlight.quote)
      && clusterIds.has(highlight.clusterId),
  );

  if (highlights.length < 2 || clusters.length < 2) return fallback;

  return {
    ...artifact,
    highlights,
    clusters,
  };
}
