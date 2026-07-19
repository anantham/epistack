import { z } from "zod";
import { jsonSchema } from "ai";
import type {
  DecompositionCluster,
  DecompositionArtifact,
  InterpretationAxis,
  InterpretationBranch,
  QuestionHighlight,
} from "./decomposition";

const branchSchema = z.object({
  id: z.string().min(1).max(48),
  label: z.string().min(2).max(90),
  value: z.string().min(1).max(220),
  detail: z.string().min(4).max(280),
  why: z.string().min(4).max(280),
  status: z.enum(["kept", "candidate", "parked"]),
  relevance: z.enum(["high", "medium", "low"]),
  origin: z.literal("ai"),
});

const axisSchema = z.object({
  id: z.string().min(1).max(48),
  label: z.string().min(2).max(90),
  question: z.string().min(4).max(240),
  branches: z.array(branchSchema).min(2).max(4),
});

export const decompositionSchema = z.object({
  caseTitle: z.string().min(3).max(90),
  summary: z.string().min(12).max(320),
  highlights: z.array(z.object({
    quote: z.string().min(1).max(180),
    label: z.string().min(2).max(80),
    why: z.string().min(4).max(220),
    axisId: z.string().min(1).max(48),
    clusterId: z.string().min(1).max(48),
  })).min(2).max(8),
  clusters: z.array(z.object({
    id: z.string().min(1).max(48),
    label: z.string().min(2).max(90),
    axisId: z.string().min(1).max(48),
    highlightQuotes: z.array(z.string().min(1).max(180)).min(1).max(5),
    latentVariable: z.string().min(2).max(140),
    rationale: z.string().min(4).max(280),
    ingestionRequirements: z.object({
      requiredFields: z.array(z.string().min(2).max(100)).min(2).max(8),
      searchConcepts: z.array(z.string().min(2).max(100)).min(2).max(8),
      mismatchRisks: z.array(z.string().min(2).max(140)).min(1).max(6),
    }),
  })).min(2).max(7),
  axes: z.array(axisSchema).min(3).max(7),
  claimTemplate: z.string().min(12).max(700),
  knownUnknowns: z.array(z.string().min(4).max(220)).min(3).max(8),
  contextQuestions: z.array(z.object({
    id: z.string().min(1).max(48),
    label: z.string().min(2).max(80),
    question: z.string().min(4).max(220),
    whyItMatters: z.string().min(4).max(260),
    effect: z.enum(["prune", "branch", "match"]),
  })).min(3).max(8),
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

export const decompositionInstructions = `You are the question-compilation operator in an epistemic research system.

Turn a vague paragraph into a compact, human-editable interpretation map. Do not answer the question and do not retrieve evidence. Your job is to expose ambiguity that would materially change what evidence is relevant.

Rules:
- Identify 3–7 decision-relevant axes. Avoid exhaustive combinatorics and cosmetic distinctions.
- Give each axis 2–4 concrete branches. Exactly one branch per axis must have status "kept" as the most ordinary or decision-useful provisional reading. Other branches are "candidate" or "parked".
- Branches are alternative scopes, not mutually exclusive truth hypotheses.
- Preserve uncertainty. Do not invent details the paragraph does not contain.
- Every highlight quote must be an exact, case-sensitive substring of the submitted paragraph. Link it to both an axis id and a semantic cluster id.
- Cluster separate surface cues when they imply the same latent variable. For example, "eat" and "moderation" can belong to one dose/frequency cluster even when they are not adjacent.
- For each cluster, expose an inspectable methodological rationale: the quoted cues, the latent variable inferred from them, the interpretation axis they motivate, and the fields/search concepts/mismatch risks that evidence ingestion must preserve.
- This rationale is a concise audit trace, not private chain-of-thought. State only what a reviewer needs to evaluate the decomposition decision.
- Use stable lowercase kebab-case ids, unique across axes and within each branch list.
- origin is always "ai". Relevance expresses decision relevance, not truth.
- claimTemplate must be a grammatical, concrete research question containing placeholders written exactly as {{axis-id}}. Use the axis ids you generated. It may use an axis once or omit a low-value axis, but must remain understandable after replacement with each kept branch's value.
- knownUnknowns are attributes worth recording but not yet important enough to become axes.
- You may receive a separate block of known decision context. Treat it as a constraint on applicability, not evidence that a general claim is true.
- When context is supplied, visibly transform the interpretation map: park branches the context rules out; keep the branch that best matches the actual case; add or sharpen branches introduced by the person's real exposure, goal, co-exposures, setting, and feasible alternatives; and revise evidence fields, search concepts, and mismatch risks accordingly. Do not merely repeat the context in prose.
- Preserve legitimate expansion as well as pruning. A detail can narrow one axis while creating a new decision-relevant axis or comparator elsewhere.
- contextQuestions must ask only for unresolved facts whose answers would materially change branch pruning, create a decision-relevant branch, or improve evidence matching. Do not re-ask facts already supplied. Prefer questions about the actual exposure, goal, current routine/co-exposures, feasible comparator, population transport, and time horizon over generic demographic collection.
- Label each context question by its main effect: "prune" removes irrelevant scope, "branch" adds a materially distinct claim, and "match" changes evidence inclusion or applicability.
- Be concise, methodologically neutral, and domain-general.`;

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42) || "question";
}

function branch(
  id: string,
  label: string,
  value: string,
  detail: string,
  why: string,
  status: InterpretationBranch["status"],
  relevance: InterpretationBranch["relevance"],
): InterpretationBranch {
  return { id, label, value, detail, why, status, relevance, origin: "ai" };
}

const traceSpecs: Record<string, Omit<DecompositionCluster, "id" | "axisId" | "highlightQuotes">> = {
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

function fallbackTrace(prompt: string, axes: InterpretationAxis[]) {
  const cueGroups = [
    { axisId: "subject", candidates: ["eggs", "private cars", "cars", "policy", "program", "treatment", "AI"] },
    { axisId: "exposure", candidates: ["eat", "moderation", "how often", "how much", "daily", "weekly", "ban", "use"] },
    { axisId: "outcome", candidates: ["good", "bad", "great", "worked", "effective", "safe", "better", "worse", "successful"] },
    { axisId: "population", candidates: ["across people", "for whom", "people", "cities", "children", "adults", "women", "men"] },
    { axisId: "comparator", candidates: ["compared with", "versus", "instead of", "than"] },
    { axisId: "context", candidates: ["geographically", "centers", "at home", "in schools", "where"] },
    { axisId: "horizon", candidates: ["over time", "long term", "short term"] },
  ];
  const clusters: DecompositionCluster[] = [];
  const occupied = new Set<number>();
  for (const group of cueGroups) {
    const axis = axes.find((item) => item.id === group.axisId);
    const spec = traceSpecs[group.axisId];
    if (!axis || !spec) continue;
    const matches = exactMatches(prompt, group.candidates)
      .filter((item) => !occupied.has(item.index))
      .sort((a, b) => a.index - b.index || (b.end - b.index) - (a.end - a.index))
      .filter((item, index, all) => !all.slice(0, index).some(
        (prior) => item.index < prior.end && item.end > prior.index,
      ))
      .slice(0, 3);
    if (!matches.length) continue;
    matches.forEach((item) => occupied.add(item.index));
    clusters.push({
      id: `${group.axisId}-cues`,
      axisId: group.axisId,
      highlightQuotes: matches.map((item) => item.quote),
      ...spec,
    });
  }

  if (clusters.length < 2) {
    const stopWords = new Set(["about", "after", "before", "could", "does", "from", "have", "should", "their", "there", "these", "those", "what", "when", "where", "which", "would"]);
    const content = [...prompt.matchAll(/\b[A-Za-z][A-Za-z'-]{4,}\b/g)]
      .filter((match) => !stopWords.has(match[0].toLowerCase()))
      .slice(0, 3);
    for (const [index, match] of content.entries()) {
      const axisId = index === 0 ? "subject" : index === 1 ? "outcome" : "context";
      if (clusters.some((cluster) => cluster.axisId === axisId)) continue;
      clusters.push({
        id: `${axisId}-cues`,
        axisId,
        highlightQuotes: [match[0]],
        ...traceSpecs[axisId],
      });
    }
  }

  const limitedClusters = clusters.slice(0, 7);
  const highlights: QuestionHighlight[] = limitedClusters
    .flatMap((cluster) => cluster.highlightQuotes.map((quote) => ({
      quote,
      label: cluster.label,
      why: cluster.rationale,
      axisId: cluster.axisId,
      clusterId: cluster.id,
    })))
    .slice(0, 8);
  const usedQuotes = new Set(highlights.map((highlight) => highlight.quote));
  return {
    highlights,
    clusters: limitedClusters.map((cluster) => ({
      ...cluster,
      highlightQuotes: cluster.highlightQuotes.filter((quote) => usedQuotes.has(quote)),
    })).filter((cluster) => cluster.highlightQuotes.length > 0),
  };
}

export function createFallbackDecomposition(prompt: string, decisionContext = ""): DecompositionArtifact {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  const subject = oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
  const axes: InterpretationAxis[] = [
    {
      id: "subject",
      label: "What exactly is being discussed?",
      question: "Which concrete object, action, policy, or proposition is the real subject?",
      branches: [
        branch("literal-subject", "Literal reading", subject, "Use the subject exactly as the question states it.", "This preserves the submitted wording before adding narrower constructs.", "kept", "high"),
        branch("narrow-construct", "Narrow construct", "a precisely defined version of the subject", "Replace the everyday label with a measurable construct.", "Evidence can only match a construct that has operational boundaries.", "candidate", "high"),
        branch("broader-system", "Broader system", "the surrounding system that contains the subject", "Treat the named subject as one component of a larger system.", "System context may dominate the named component.", "parked", "medium"),
      ],
    },
    {
      id: "exposure",
      label: "How much, how often, and in what form?",
      question: "What dose, frequency, duration, preparation, or implementation defines the exposure?",
      branches: [
        branch("ordinary-exposure", "Ordinary repeated exposure", "the ordinary repeated form of the exposure implied by the question", "Use the most familiar recurring version as the provisional scope.", "This supplies a concrete starting point without pretending the wording specified a dose.", "kept", "high"),
        branch("low-exposure", "Lower or occasional exposure", "a lower-dose or occasional form of the exposure", "Separate sporadic or low-dose exposure from a routine pattern.", "Dose and frequency can change both mechanism and outcome.", "candidate", "high"),
        branch("high-exposure", "Higher or sustained exposure", "a higher-dose or sustained form of the exposure", "Represent the stronger end of the plausible exposure range.", "Evidence at one exposure level should not silently generalize to another.", "candidate", "high"),
      ],
    },
    {
      id: "population",
      label: "For whom or where?",
      question: "What population, jurisdiction, site, or stakeholder should the answer apply to?",
      branches: [
        branch("named-population", "Most directly named group", "the population or setting most directly implied by the question", "Use the narrowest group supported by the wording.", "This avoids silent universalization.", "kept", "high"),
        branch("general-population", "General population", "a broad general population", "Ask whether the answer travels beyond the implied group.", "Broader transport requires additional evidence.", "candidate", "medium"),
        branch("high-risk-group", "High-impact subgroup", "a plausibly higher-impact or higher-risk subgroup", "Surface a subgroup for whom the decision has different stakes.", "Average effects can hide consequential heterogeneity.", "candidate", "high"),
      ],
    },
    {
      id: "comparator",
      label: "Compared with what?",
      question: "What alternative, baseline, or counterfactual makes the claim meaningful?",
      branches: [
        branch("status-quo", "Status quo", "the current or ordinary alternative", "Use the ordinary baseline implied by the question.", "Most practical questions compare against what happens otherwise.", "kept", "high"),
        branch("no-action", "No action or exposure", "no action, exposure, or intervention", "Use absence as the counterfactual.", "This isolates whether the named subject changes outcomes at all.", "candidate", "high"),
        branch("best-alternative", "Strong alternative", "the strongest plausible alternative", "Compare with a serious competing option.", "A weak comparator can make a mediocre option look good.", "candidate", "high"),
      ],
    },
    {
      id: "outcome",
      label: "What would count as good or bad?",
      question: "Which measurable outcome carries the conclusion?",
      branches: [
        branch("decision-outcome", "Decision-relevant outcome", "a measurable outcome that directly matters to the decision", "Prefer an outcome tied to the user's decision.", "Proxy improvements may not change what anyone should do.", "kept", "high"),
        branch("proximal-outcome", "Near-term proxy", "a nearer-term proxy or mechanism", "Measure an earlier signal on the causal path.", "Useful for mechanism, but not equivalent to the final outcome.", "candidate", "medium"),
        branch("unintended-effects", "Unintended effects", "important benefits, harms, and distributional effects", "Include outcomes outside the intended target.", "Net value can reverse when omitted effects are counted.", "candidate", "high"),
      ],
    },
    {
      id: "context",
      label: "Under what conditions?",
      question: "Which surrounding conditions, implementation details, or co-exposures may change the answer?",
      branches: [
        branch("ordinary-context", "Ordinary conditions", "ordinary real-world conditions", "Start with the context most readers would assume.", "This makes the first claim recognizable and testable.", "kept", "high"),
        branch("controlled-context", "Controlled conditions", "controlled or ideal implementation conditions", "Ask about efficacy under tighter control.", "Efficacy and real-world effectiveness are different claims.", "candidate", "medium"),
        branch("adverse-context", "Adverse conditions", "plausibly adverse or failure-prone conditions", "Stress-test the claim under credible failure conditions.", "Robust conclusions should name where they break.", "candidate", "high"),
      ],
    },
    {
      id: "horizon",
      label: "Over what time?",
      question: "What time horizon is long enough for the outcome and short enough to study?",
      branches: [
        branch("decision-horizon", "Decision horizon", "a time horizon relevant to the decision", "Use the period over which action would actually be evaluated.", "Immediate and durable effects should not be conflated.", "kept", "high"),
        branch("short-term", "Short term", "the short term", "Focus on immediate response or feasibility.", "Short studies can establish mechanism without durability.", "candidate", "medium"),
        branch("long-term", "Long term", "the long term", "Focus on persistence, adaptation, and delayed effects.", "Some important outcomes only emerge after adaptation.", "candidate", "high"),
      ],
    },
  ];

  const trace = fallbackTrace(prompt, axes);
  return {
    caseTitle: oneLine.split(/[?.!]/)[0].slice(0, 86) || "Untitled question",
    summary: "A local, domain-general decomposition is shown because a model connection is not configured. It is editable and preserves the same artifact contract as an AI-generated map.",
    highlights: trace.highlights,
    clusters: trace.clusters,
    axes,
    claimTemplate: "For {{population}}, does {{exposure}} of {{subject}}, under {{context}}, lead to {{outcome}} over {{horizon}}, compared with {{comparator}}?",
    knownUnknowns: [
      "Whether the everyday terms map cleanly to measurable constructs",
      "Whether the available evidence matches the intended population and setting",
      "Whether important outcomes or stakeholder perspectives are missing",
      "Whether sources share data, incentives, or assumptions",
      "What new evidence would be most likely to change the conclusion",
    ],
    contextQuestions: [
      {
        id: "target-outcome",
        label: "Decision target",
        question: "Which concrete outcome would make you act differently?",
        whyItMatters: "A specific target prunes outcomes that are interesting but not decision-relevant.",
        effect: "prune",
      },
      {
        id: "current-exposure",
        label: "Current exposure",
        question: "What amount, frequency, preparation, and surrounding routine are you considering?",
        whyItMatters: "These details determine whether a source studies the same exposure.",
        effect: "match",
      },
      {
        id: "feasible-comparator",
        label: "Real alternative",
        question: "What would you realistically do, eat, or choose instead?",
        whyItMatters: "A feasible counterfactual can create a different and more actionable causal claim.",
        effect: "branch",
      },
      {
        id: "applicability",
        label: "Applicability",
        question: decisionContext
          ? "Which remaining health, setting, or routine differences might make published study populations unlike this case?"
          : "What person, place, baseline, or routine should the answer apply to?",
        whyItMatters: "Applicability depends on whether evidence transports to the actual decision context.",
        effect: "match",
      },
    ],
  };
}

export function sanitizeDecomposition(
  artifact: DecompositionArtifact,
  prompt: string,
  decisionContext = "",
): DecompositionArtifact {
  const axisIds = new Set(artifact.axes.map((axis) => axis.id));
  const fallback = createFallbackDecomposition(prompt, decisionContext);
  const clusters = artifact.clusters.filter(
    (cluster) => axisIds.has(cluster.axisId)
      && cluster.highlightQuotes.length > 0
      && cluster.highlightQuotes.every((quote) => prompt.includes(quote)),
  );
  const clusterIds = new Set(clusters.map((cluster) => cluster.id));
  const highlights = artifact.highlights.filter(
    (highlight) => prompt.includes(highlight.quote)
      && axisIds.has(highlight.axisId)
      && clusterIds.has(highlight.clusterId),
  );
  const axes = artifact.axes.map((axis) => {
    let keptSeen = false;
    const branches = axis.branches.map((item, index) => {
      const keep = item.status === "kept" && !keptSeen;
      if (keep) keptSeen = true;
      return {
        ...item,
        status: keep ? "kept" as const : item.status === "kept" ? "candidate" as const : item.status,
        origin: "ai" as const,
        id: item.id || `${slug(axis.id)}-${index + 1}`,
      };
    });
    if (!keptSeen && branches[0]) branches[0] = { ...branches[0], status: "kept" };
    return { ...axis, branches };
  });

  if (highlights.length < 2 || clusters.length < 2) return fallback;

  return {
    ...artifact,
    axes,
    highlights,
    clusters,
  };
}
