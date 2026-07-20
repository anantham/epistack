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
    options: z.array(z.string().min(1).max(100)).min(2).max(5),
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

// The live compiler deliberately uses three smaller contracts instead of asking
// one model call to fill the entire persistent artifact. Each specialist can be
// validated, retried, or replaced without discarding the other work.
export const dimensionScoutSchema = z.object({
  caseTitle: z.string().min(3),
  summary: z.string().min(8),
  dimensions: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(2),
    question: z.string().min(4),
    resolutions: z.array(z.string().min(1)).min(2),
  })).min(3),
});

export const traceAgentSchema = z.object({
  traces: z.array(z.object({
    axisId: z.string().min(1),
    label: z.string().min(2),
    quotes: z.array(z.string().min(1)).min(1),
    latentVariable: z.string().min(2),
    rationale: z.string().min(4),
  })).min(2),
});

export const contextAgentSchema = z.object({
  enrichments: z.array(z.object({
    axisId: z.string().min(1),
    requiredFields: z.array(z.string().min(1)).min(1),
    searchConcepts: z.array(z.string().min(1)).min(1),
    mismatchRisks: z.array(z.string().min(1)).min(1),
  })).min(1),
  claimTemplate: z.string().min(8),
  knownUnknowns: z.array(z.string().min(2)).min(1),
  contextQuestions: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(2),
    question: z.string().min(4),
    whyItMatters: z.string().min(4),
    effect: z.enum(["prune", "branch", "match"]),
    options: z.array(z.string().min(1)).min(1),
  })).min(1),
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
- Identify 4–7 decision-relevant axes. Avoid exhaustive combinatorics.
- Give each axis 2–4 concrete branches. Exactly one is "kept" as the most ordinary or decision-useful provisional reading; others are "candidate" or "parked".
- Every highlight quote is an exact, case-sensitive substring of the submitted paragraph and links to both an axis and semantic cluster.
- For each cluster, provide a concise audit trace, not private chain-of-thought: quoted cues, latent variable, rationale, required evidence fields, search concepts, and mismatch risks.
- Use stable lowercase kebab-case ids. origin is always "ai". Relevance means decision relevance, not truth.
- claimTemplate is a grammatical research question using placeholders exactly as {{axis-id}}. It must remain readable after substituting kept branch values.
- knownUnknowns are worth recording but not important enough to become axes.
- Treat known decision context as an applicability constraint, never as evidence. Park branches the context rules out, keep matching branches, add newly relevant axes, and revise evidence requirements. Do not merely repeat it.
- Preserve legitimate expansion as well as pruning: one answer may collapse an axis while creating a new comparator or risk.
- Ask 3–5 contextQuestions, ordered by expected value of information: first ask the fact most likely to collapse branches or change evidence inclusion. Do not re-ask supplied facts. Each question gets 2–5 short, concrete answer options that are useful handles, while still permitting free text.
- Label each question's main effect: "prune" removes scope, "branch" creates a materially different claim, and "match" changes evidence inclusion or transportability.
- Be concise, methodologically neutral, and domain-general.`;

export const dimensionScoutInstructions = `You are the DIMENSION SCOUT in a question-compilation team.

Do one job only: turn a vague paragraph into 4–7 substantive dimensions that would change the answer or the evidence search. Do not answer the question, retrieve evidence, write provenance metadata, or design the context interview.

Ground dimensions in the submitted language, then check the useful recurring lenses: outcome/value, exact object, dose/frequency, feasible counterfactual, population, setting, time horizon, implementation, downside, and personal fit. Always include a real comparator for causal or decision questions. Options are bundles, not isolated word senses. Trace constraint cascades. Prefer concrete or quantitative resolutions over labels such as “moderation.”

Each dimension needs 2–5 short, mutually distinct resolutions. Use stable lowercase kebab-case ids. Keep the output compact.

Worked calibration:
“Are eggs good to eat?” can separate: good for which outcome; what kind/preparation of egg; how many and how often; replacing what; and for which population. “Is it better to rent or buy?” must compare two different home-location-rights-cost bundles, not the same house with a payment-method swap.`;

export const traceAgentInstructions = `You are the TRACE SPECIALIST in a question-compilation team.

Given a submitted paragraph and a fixed list of dimensions, map only the exact words that make each dimension relevant. Every quote must be an exact, case-sensitive substring of the paragraph. Use short non-overlapping quotes where possible. Do not invent new dimensions, branches, evidence, or context questions.

For each trace, name the observable latent variable and give a concise audit rationale. This is an inspectable derivation trace, not private chain-of-thought. Return traces only for supplied axis ids.`;

export const contextAgentInstructions = `You are the CONTEXT AND RETRIEVAL SPECIALIST in a question-compilation team.

Given a submitted paragraph, fixed dimensions, and any known decision context, do three jobs only:
1. Specify the metadata an evidence collector must capture for each dimension, useful search concepts, and construct-mismatch risks.
2. Write a readable scoped claim template using placeholders exactly as {{axis-id}}.
3. Ask 3–5 high-value questions about the asker, ordered by how much they prune the search, create a materially different claim, or change evidence applicability.

Do not answer the substantive question. Do not re-ask facts already present in known context. Keep answer options short and concrete while allowing free text. Treat context as an applicability constraint, never as evidence. Preserve both pruning and newly relevant branches.`;

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
        options: ["Health risk", "Weight or satiety", "Performance", "Cost or convenience"],
      },
      {
        id: "current-exposure",
        label: "Current exposure",
        question: "What amount, frequency, preparation, and surrounding routine are you considering?",
        whyItMatters: "These details determine whether a source studies the same exposure.",
        effect: "match",
        options: ["Occasional or low exposure", "About daily", "Several times daily", "Not decided yet"],
      },
      {
        id: "feasible-comparator",
        label: "Real alternative",
        question: "What would you realistically do, eat, or choose instead?",
        whyItMatters: "A feasible counterfactual can create a different and more actionable causal claim.",
        effect: "branch",
        options: ["Keep the status quo", "Choose the nearest substitute", "Do nothing", "I have several realistic alternatives"],
      },
      {
        id: "applicability",
        label: "Applicability",
        question: decisionContext
          ? "Which remaining health, setting, or routine differences might make published study populations unlike this case?"
          : "What person, place, baseline, or routine should the answer apply to?",
        whyItMatters: "Applicability depends on whether evidence transports to the actual decision context.",
        effect: "match",
        options: ["Healthy general population", "A specific health or risk group", "A specific place or system", "My personal routine"],
      },
    ],
  };
}

function compact(value: string, maximum: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function genericIngestion(axis: InterpretationAxis) {
  return {
    requiredFields: [
      compact(`${axis.label} operational definition`, 100),
      "measurement, coding, or implementation details",
    ],
    searchConcepts: [compact(axis.label, 100), compact(axis.question, 100)],
    mismatchRisks: [compact(`Sources may use a materially different definition of ${axis.label}.`, 140)],
  };
}

function genericTraceForAxes(prompt: string, axes: InterpretationAxis[]) {
  const stopWords = new Set(["about", "after", "before", "could", "does", "from", "have", "how", "should", "their", "there", "these", "those", "what", "when", "where", "which", "would"]);
  const words = [...prompt.matchAll(/\b[A-Za-z][A-Za-z'-]{1,}\b/g)]
    .map((match) => match[0])
    .filter((word, index, all) => !stopWords.has(word.toLowerCase()) && all.findIndex((candidate) => candidate.toLowerCase() === word.toLowerCase()) === index);
  return axes.slice(0, Math.min(7, Math.max(2, words.length))).map((axis, index) => {
    const quote = words[index] ?? words[index % Math.max(1, words.length)] ?? prompt.slice(0, Math.min(80, prompt.length));
    return {
      id: `${axis.id}-cues`,
      label: compact(axis.label, 90),
      axisId: axis.id,
      highlightQuotes: [quote],
      latentVariable: compact(axis.question, 140),
      rationale: compact(`The quoted cue leaves ${axis.label.toLowerCase()} underspecified and changes which scoped claim should be investigated.`, 280),
      ingestionRequirements: genericIngestion(axis),
    } satisfies DecompositionCluster;
  });
}

export function normalizeDimensionScout(scout: DimensionScout): DimensionScout {
  const usedIds = new Set<string>();
  const dimensions = scout.dimensions.slice(0, 7).map((dimension, index) => {
    const baseId = slug(dimension.id || dimension.label || `axis-${index + 1}`);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId.slice(0, 38)}-${suffix++}`;
    usedIds.add(id);
    return {
      id,
      label: compact(dimension.label, 90),
      question: compact(dimension.question, 240),
      resolutions: dimension.resolutions.map((resolution) => compact(resolution, 220)).filter(Boolean).slice(0, 5),
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
  const usedAxisIds = new Set<string>();
  const axes = scout.dimensions.slice(0, 7).map((dimension, dimensionIndex) => {
    const baseId = slug(dimension.id || dimension.label || `axis-${dimensionIndex + 1}`);
    let axisId = baseId;
    let suffix = 2;
    while (usedAxisIds.has(axisId)) axisId = `${baseId.slice(0, 38)}-${suffix++}`;
    usedAxisIds.add(axisId);
    const seenResolutions = new Set<string>();
    const resolutions = dimension.resolutions
      .map((resolution) => compact(resolution, 220))
      .filter((resolution) => {
        const key = resolution.toLowerCase();
        if (!resolution || seenResolutions.has(key)) return false;
        seenResolutions.add(key);
        return true;
      })
      .slice(0, 4);
    while (resolutions.length < 2) resolutions.push(resolutions.length ? "Another materially different scope" : "Ordinary real-world scope");
    const branches = resolutions.map((resolution, resolutionIndex) => branch(
      `${axisId}-${slug(resolution).slice(0, 24) || resolutionIndex + 1}`,
      compact(resolution, 90),
      resolution,
      compact(`Treat “${resolution}” as one concrete reading of this dimension.`, 280),
      compact(`Changing this reading changes the scoped claim or the evidence that can bear on it.`, 280),
      resolutionIndex === 0 ? "kept" : resolutionIndex === resolutions.length - 1 && resolutions.length > 3 ? "parked" : "candidate",
      resolutionIndex < 2 ? "high" : "medium",
    ));
    return {
      id: axisId,
      label: compact(dimension.label, 90),
      question: compact(dimension.question, 240),
      branches,
    } satisfies InterpretationAxis;
  });

  const enrichmentByAxis = new Map(
    (contextResult?.enrichments ?? [])
      .filter((item) => usedAxisIds.has(item.axisId))
      .map((item) => [item.axisId, item]),
  );
  function ingestionFor(axis: InterpretationAxis) {
    const proposed = enrichmentByAxis.get(axis.id);
    if (!proposed) return genericIngestion(axis);
    const fallback = genericIngestion(axis);
    const requiredFields = proposed.requiredFields.map((item) => compact(item, 100)).filter(Boolean).slice(0, 8);
    const searchConcepts = proposed.searchConcepts.map((item) => compact(item, 100)).filter(Boolean).slice(0, 8);
    const mismatchRisks = proposed.mismatchRisks.map((item) => compact(item, 140)).filter(Boolean).slice(0, 6);
    while (requiredFields.length < 2) requiredFields.push(fallback.requiredFields[requiredFields.length]);
    while (searchConcepts.length < 2) searchConcepts.push(fallback.searchConcepts[searchConcepts.length]);
    if (!mismatchRisks.length) mismatchRisks.push(fallback.mismatchRisks[0]);
    return { requiredFields, searchConcepts, mismatchRisks };
  }

  let highlightBudget = 8;
  let clusters: DecompositionCluster[] = (traceResult?.traces ?? [])
    .filter((trace) => usedAxisIds.has(trace.axisId) && highlightBudget > 0)
    .map((trace) => {
      const axis = axes.find((candidate) => candidate.id === trace.axisId)!;
      const quotes = Array.from(new Set(trace.quotes))
        .filter((quote) => prompt.includes(quote))
        .map((quote) => compact(quote, 180))
        .slice(0, Math.min(4, highlightBudget));
      highlightBudget -= quotes.length;
      return {
        id: `${trace.axisId}-cues`,
        label: compact(trace.label, 90),
        axisId: trace.axisId,
        highlightQuotes: quotes,
        latentVariable: compact(trace.latentVariable, 140),
        rationale: compact(trace.rationale, 280),
        ingestionRequirements: ingestionFor(axis),
      };
    })
    .filter((cluster) => cluster.highlightQuotes.length > 0)
    .slice(0, 7);

  if (clusters.length < 2) {
    const existingFallback = fallbackTrace(prompt, axes).clusters.map((cluster) => ({
      ...cluster,
      ingestionRequirements: ingestionFor(axes.find((axis) => axis.id === cluster.axisId) ?? axes[0]),
    }));
    clusters = existingFallback.length >= 2
      ? existingFallback
      : genericTraceForAxes(prompt, axes).map((cluster) => ({
        ...cluster,
        ingestionRequirements: ingestionFor(axes.find((axis) => axis.id === cluster.axisId) ?? axes[0]),
      }));
  }
  clusters = clusters.slice(0, 7);
  const highlights = clusters.flatMap((cluster) => cluster.highlightQuotes.map((quote) => ({
    quote,
    label: cluster.label,
    why: cluster.rationale,
    axisId: cluster.axisId,
    clusterId: cluster.id,
  }))).slice(0, 8);
  const usedHighlightQuotes = new Set(highlights.map((highlight) => highlight.quote));
  clusters = clusters
    .map((cluster) => ({ ...cluster, highlightQuotes: cluster.highlightQuotes.filter((quote) => usedHighlightQuotes.has(quote)) }))
    .filter((cluster) => cluster.highlightQuotes.length > 0);

  const fallback = createFallbackDecomposition(prompt, decisionContext);
  const contextQuestions = (contextResult?.contextQuestions ?? [])
    .map((question, index) => ({
      id: slug(question.id || `context-${index + 1}`),
      label: compact(question.label, 80),
      question: compact(question.question, 220),
      whyItMatters: compact(question.whyItMatters, 260),
      effect: question.effect,
      options: question.options.map((option) => compact(option, 100)).filter(Boolean).slice(0, 5),
    }))
    .filter((question) => question.options.length > 0)
    .slice(0, 5);
  for (const fallbackQuestion of fallback.contextQuestions) {
    if (contextQuestions.length >= 3) break;
    if (!contextQuestions.some((question) => question.id === fallbackQuestion.id)) contextQuestions.push(fallbackQuestion);
  }
  for (const question of contextQuestions) {
    if (question.options.length === 1) question.options.push("Something else or not yet decided");
  }

  const knownUnknowns = (contextResult?.knownUnknowns ?? [])
    .map((unknown) => compact(unknown, 220))
    .filter(Boolean)
    .slice(0, 8);
  for (const fallbackUnknown of fallback.knownUnknowns) {
    if (knownUnknowns.length >= 3) break;
    if (!knownUnknowns.includes(fallbackUnknown)) knownUnknowns.push(fallbackUnknown);
  }
  const defaultTemplate = `For the concrete case, how do ${axes.slice(0, 5).map((axis) => `{{${axis.id}}}`).join(", ")} change the decision-relevant outcome?`;

  return sanitizeDecomposition({
    caseTitle: compact(scout.caseTitle, 90),
    summary: compact(scout.summary, 320),
    axes,
    highlights,
    clusters,
    claimTemplate: compact(contextResult?.claimTemplate || defaultTemplate, 700),
    knownUnknowns,
    contextQuestions,
  }, prompt, decisionContext);
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
