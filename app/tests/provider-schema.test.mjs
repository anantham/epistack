import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleDecomposition,
  contextAgentOutputSchema,
  createFallbackDecomposition,
  decompositionProviderJsonSchema,
  decompositionSchema,
  dimensionScoutOutputSchema,
  traceAgentOutputSchema,
} from "../lib/decomposition-server.ts";
import { readFile } from "node:fs/promises";

const unsupportedStructuredOutputKeywords = new Set([
  "minLength", "maxLength", "pattern", "format",
  "minimum", "maximum", "multipleOf",
  "patternProperties", "unevaluatedProperties", "propertyNames", "minProperties", "maxProperties",
  "unevaluatedItems", "contains", "minContains", "maxContains", "minItems", "maxItems", "uniqueItems",
]);

function collectUnsupportedKeywords(value, path = "$", findings = []) {
  if (!value || typeof value !== "object") return findings;
  for (const [key, child] of Object.entries(value)) {
    if (unsupportedStructuredOutputKeywords.has(key)) findings.push(`${path}.${key}`);
    if (child && typeof child === "object") collectUnsupportedKeywords(child, `${path}.${key}`, findings);
  }
  return findings;
}

test("the provider schema contains only Azure-supported constraint keywords", () => {
  for (const schema of [decompositionProviderJsonSchema, dimensionScoutOutputSchema, traceAgentOutputSchema, contextAgentOutputSchema]) {
    assert.deepEqual(
      collectUnsupportedKeywords(schema),
      [],
      "Provider JSON Schema must omit constraints Azure structured outputs do not support",
    );
  }
});

test("specialist outputs merge into a valid artifact for the exact eggs question", () => {
  const prompt = "Are eggs good to eat? Bad to eat? Great in moderation? How can we tell? Does it vary across people, and what predicts this? What else should we be paying attention to here?";
  const scout = {
    caseTitle: "Whether and how to eat eggs",
    summary: "Separate the outcome, exposure, comparator, population, and evidence standard before searching.",
    dimensions: [
      { id: "outcome", label: "Good or bad for what?", question: "Which benefit or harm carries the decision?", resolutions: ["weight and satiety", "LDL and cardiovascular risk", "protein and micronutrients"] },
      { id: "egg-form", label: "Which eggs and preparation?", question: "What food object and preparation is being tested?", resolutions: ["whole hen eggs", "egg whites", "boiled versus fried"] },
      { id: "dose", label: "How much and how often?", question: "Which dose, frequency, and duration define eating eggs?", resolutions: ["about one per day", "two per day", "occasional intake"] },
      { id: "comparator", label: "Replacing what?", question: "What would the person eat instead?", resolutions: ["refined-carbohydrate breakfast", "processed meat", "no dietary change"] },
      { id: "population", label: "For whom?", question: "Which baseline risk and response modifiers matter?", resolutions: ["healthy active adults", "people with diabetes", "LDL hyper-responders"] },
    ],
  };
  const trace = {
    traces: [
      { axisId: "outcome", label: "Outcome frame", quotes: ["good", "Bad", "Great"], latentVariable: "Decision-relevant benefit or harm", rationale: "The evaluative words leave the outcome unspecified." },
      { axisId: "egg-form", label: "Food object", quotes: ["eggs"], latentVariable: "Egg type and preparation", rationale: "The food label can hide materially different exposures." },
      { axisId: "dose", label: "Dose", quotes: ["eat", "moderation"], latentVariable: "Dose, frequency, and duration", rationale: "Eating and moderation do not specify a measurable exposure." },
      { axisId: "population", label: "Heterogeneity", quotes: ["across people"], latentVariable: "Population and effect modification", rationale: "The question explicitly asks whether effects vary." },
    ],
  };
  const context = {
    enrichments: scout.dimensions.map((axis) => ({
      axisId: axis.id,
      requiredFields: ["operational definition", "measurement timing"],
      searchConcepts: [axis.label, axis.question],
      mismatchRisks: ["A neighboring construct may be treated as direct evidence."],
    })),
    claimTemplate: "For {{population}}, does {{dose}} of {{egg-form}} change {{outcome}} compared with {{comparator}}?",
    knownUnknowns: ["Long-term outcomes may not follow short-term biomarkers", "Published populations may not match the asker", "Several sources may reuse the same cohort"],
    contextQuestions: [
      { id: "goal", label: "Goal", question: "Which outcome would change your next purchase?", whyItMatters: "It prunes unrelated outcome branches.", effect: "prune", options: ["Weight or satiety", "Lipids", "Performance"] },
      { id: "routine", label: "Routine", question: "How many eggs are you considering and how often?", whyItMatters: "It determines exposure match.", effect: "match", options: ["Occasional", "One daily", "Two daily"] },
      { id: "replacement", label: "Replacement", question: "What would breakfast be instead?", whyItMatters: "It defines the actionable counterfactual.", effect: "branch", options: ["Bread or cereal", "Meat", "No breakfast"] },
    ],
  };
  const artifact = assembleDecomposition(scout, trace, context, prompt);
  assert.equal(decompositionSchema.safeParse(artifact).success, true);
  assert.ok(artifact.highlights.every((highlight) => prompt.includes(highlight.quote)));
  assert.equal(artifact.axes.length, 5);
  assert.equal(artifact.contextQuestions.length, 3);
});

test("semantic cardinality checks still run after provider generation", () => {
  const complete = createFallbackDecomposition(
    "Are eggs good to eat? Bad to eat? Great in moderation? How can we tell? Does it vary across people?",
  );
  assert.equal(decompositionSchema.safeParse(complete).success, true);
  assert.equal(decompositionSchema.safeParse({ ...complete, axes: complete.axes.slice(0, 1) }).success, false);
});

test("context elicitation offers concrete answer handles", async () => {
  const [serverSource, typeSource] = await Promise.all([
    readFile(new URL("../lib/decomposition-server.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/decomposition.ts", import.meta.url), "utf8"),
  ]);
  assert.match(serverSource, /options: z\.array/);
  assert.match(typeSource, /options: string\[\]/);
});
