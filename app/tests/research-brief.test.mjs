import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDimensionAssignments,
  buildClaimCoverage,
  completeDimensionRoles,
  normalizeResearchBriefDraft,
  projectResearchBriefForArtifact,
  researchBriefDraftSchema,
  researchBriefSchema,
  researchLanesFromBrief,
} from "../lib/research-brief.ts";

const axes = [
  {
    id: "outcome",
    label: "Good for what?",
    question: "Which outcome carries the decision?",
    branches: [{ id: "weight", label: "Body fat", value: "lower body fat", detail: "Measured body fat", why: "Decision target", status: "kept", relevance: "high", origin: "human" }],
  },
  {
    id: "population",
    label: "For whom?",
    question: "Which person must the evidence transport to?",
    branches: [{ id: "actor", label: "Active adult", value: "a resistance-trained adult", detail: "Local actor", why: "Applicability", status: "kept", relevance: "high", origin: "human" }],
  },
  {
    id: "production",
    label: "Chicken feed",
    question: "What did the chicken eat?",
    branches: [{ id: "unknown", label: "Unknown feed", value: "feed is unknown", detail: "Not certified", why: "Possible mismatch", status: "candidate", relevance: "low", origin: "ai" }],
  },
];


const clusters = [
  {
    id: "outcome",
    label: "Good for what?",
    highlightQuotes: ["outcome"],
    latentVariable: "Which outcome carries the decision?",
    rationale: "This is a public audit trace for the selected dimension.",
    contextQuestion: { id: "outcome-q", question: "q", options: ["a"], whyItMatters: "w", effect: "e" },
    ingestionRequirements: {
      requiredFields: ["outcome field"],
      searchConcepts: ["outcome concept"],
      mismatchRisks: ["outcome mismatch"],
    },
  },
  {
    id: "population",
    label: "For whom?",
    highlightQuotes: ["population"],
    latentVariable: "Which person must the evidence transport to?",
    rationale: "This is a public audit trace for the selected dimension.",
    contextQuestion: { id: "pop-q", question: "q", options: ["a"], whyItMatters: "w", effect: "e" },
    ingestionRequirements: {
      requiredFields: ["population field"],
      searchConcepts: ["population concept"],
      mismatchRisks: ["population mismatch"],
    },
  },
  {
    id: "production",
    label: "Chicken feed",
    highlightQuotes: ["production"],
    latentVariable: "What did the chicken eat?",
    rationale: "This is a public audit trace for the selected dimension.",
    contextQuestion: { id: "prod-q", question: "q", options: ["a"], whyItMatters: "w", effect: "e" },
    ingestionRequirements: {
      requiredFields: ["production field"],
      searchConcepts: ["production concept"],
      mismatchRisks: ["production mismatch"],
    },
  },
];


function claim(id, budgetShare, axisIds) {
  return {
    id,
    shortLabel: id.replaceAll("-", " "),
    statement: `A sufficiently scoped proposition for ${id} that can be tested against evidence.`,
    kind: "effectiveness",
    population: "Resistance-trained adults",
    exposure: "Two eggs with breakfast",
    comparator: "A feasible egg-free breakfast",
    outcome: "Body-fat change",
    timeHorizon: "Twelve weeks",
    modality: "causal",
    priority: 1,
    budgetShare,
    decisionLeverage: "This result would change whether the actor buys and eats the eggs next week.",
    axisIds,
    queryUsesAxisIds: ["outcome"],
    applicabilityUsesAxisIds: ["population"],
    retrieval: {
      searchQuery: "egg breakfast body composition randomized trial",
      inclusionRule: "Comparative human studies reporting body composition after a quantified egg exposure.",
      exclusionSignals: ["No explicit comparator"],
      relaxationOrder: ["Relax training status before relaxing the outcome or comparator"],
    },
    applicabilityFields: ["training status", "baseline body composition", "egg dose"],
  };
}

test("human role assignments deterministically route dimensions into the research contract", () => {
  const roles = completeDimensionRoles(clusters, { production: "parked" });
  assert.equal(roles.outcome, "decision-active");
  assert.equal(roles.population, "applicability-only");
  assert.equal(roles.production, "parked");
  const assignments = buildDimensionAssignments({ clusters, dimensionRoles: roles });
  assert.equal(assignments.find((item) => item.axisId === "outcome").label, "Good for what?");
  assert.deepEqual(assignments.find((item) => item.axisId === "population").requiredEvidenceFields, ["population field"]);
});

test("claim coverage records dedicated, merged, and omitted dimensions", () => {
  const assignments = [
    { axisId: "outcome", label: "Outcome", role: "decision-active" },
    { axisId: "population", label: "Population", role: "applicability-only" },
    { axisId: "production", label: "Production", role: "decision-active" },
  ];
  const coverage = buildClaimCoverage({
    dimensionAssignments: assignments,
    claims: [
      { id: "outcome-claim", shortLabel: "Outcome", axisIds: ["outcome", "population"] },
    ],
    parkedDimensions: [],
  });

  assert.deepEqual(coverage.map((item) => item.status), ["merged", "merged", "parked"]);
  assert.match(coverage[0].reason, /Covered jointly/);
  assert.deepEqual(coverage[2].claimIds, []);
  assert.match(coverage[2].reason, /No compiled claim references/);
});

test("the compiler contract normalizes a small claim portfolio to a 100-point budget", () => {
  const raw = researchBriefDraftSchema.parse({
    stakeholderProfile: {
      summary: "A local actor deciding whether a feasible egg breakfast helps a body-composition goal.",
      objectives: ["Reduce body fat"],
      hardConstraints: ["Use foods locally available"],
      preferences: ["Simple breakfast"],
      localOnlyFacts: ["Exact home location"],
    },
    actionSpace: {
      decision: "Whether to buy twelve eggs next week and eat two on training mornings.",
      currentAction: "Continue the current egg-free breakfast",
      options: [
        { id: "buy-eggs", label: "Buy eggs", description: "Eat two eggs on training mornings.", feasibility: "available-now" },
        { id: "status-quo", label: "Keep breakfast", description: "Continue the current breakfast.", feasibility: "available-now" },
      ],
      decisionHorizon: "One week to start; twelve weeks to measure",
      measurementPlan: ["Track body weight and waist measurement"],
    },
    claims: [claim("direct-effect", 7, ["outcome", "population"]), claim("important-harm", 2, ["population"]), claim("real-comparator", 1, ["outcome"])],
    parkedDimensions: [{ axisId: "production", reason: "No current evidence of decision leverage.", reactivationTrigger: "Reactivate if composition evidence suggests a material production effect." }],
    gapTriggers: [{ question: "What is the actor's baseline LDL?", expectedDecisionValue: "high", rationale: "It could change the safety boundary.", launchWhen: "Ask before acting if the harm lane remains sensitive to baseline risk." }],
  });
  const normalized = normalizeResearchBriefDraft(raw, axes.map((axis) => axis.id));
  assert.equal(normalized.claims.reduce((sum, item) => sum + item.budgetShare, 0), 100);
  assert.ok(normalized.claims.every((item) => item.axisIds.every((axisId) => axes.some((axis) => axis.id === axisId))));

  const lanes = researchLanesFromBrief({
    ...normalized,
    schemaVersion: "0.2.0",
    briefId: "brief-test-contract",
    caseId: "case-test",
    originalQuestion: "Are eggs good to eat for this actor?",
    compiledQuestion: "Do two eggs improve body composition versus the available breakfast?",
    decisionContext: "Local context stays on device.",
    dimensionAssignments: buildDimensionAssignments({ axes, clusters, dimensionRoles: completeDimensionRoles(clusters, { production: "parked" }) }),
    contextualization: [{
      axisId: "population",
      label: "For whom?",
      question: "Who are you?",
      whyItMatters: "Applicability changes transportability.",
      effect: "match",
      selectedValues: ["a resistance-trained adult"],
      typedAnswer: "I train four days per week.",
      researchConsequence: "Use the answer as a fit check, not as a query term.",
    }],
    privacy: { localContextPolicy: "Keep personal context local to the companion.", outboundQueryPolicy: "Send only compact scientific search concepts to PubMed." },
    generatedAt: "2026-07-20T00:00:00.000Z",
    compiledBy: "local Claude · opus",
  });
  assert.equal(lanes.length, 3);
  assert.equal(lanes[0].defaultQuery, "egg breakfast body composition randomized trial");
  assert.equal(lanes[0].applicabilityFields[0], "training status");
  assert.equal(lanes[0].contextualization[0].axisId, "population");
  assert.match(lanes[0].contextualization[0].answer, /resistance-trained adult/);
});

test("the shareable artifact projection keeps research consequences while honoring the privacy choice", () => {
  const brief = researchBriefSchema.parse({
    ...normalizeResearchBriefDraft({
      stakeholderProfile: {
        summary: "A person deciding whether a concrete egg breakfast fits their routine.",
        objectives: ["Choose a breakfast"],
        hardConstraints: ["Keep it affordable"],
        preferences: ["Sunny-side up"],
        localOnlyFacts: ["Private address"],
      },
      actionSpace: {
        decision: "Whether to eat one or two eggs with breakfast.",
        currentAction: "Eat the usual breakfast",
        options: [
          { id: "eggs", label: "Eat eggs", description: "Add one or two eggs.", feasibility: "available-now" },
          { id: "usual", label: "Keep the usual breakfast", description: "Do not add eggs.", feasibility: "available-now" },
        ],
        decisionHorizon: "Two weeks",
        measurementPlan: ["Track satiety and cost"],
      },
      claims: [claim("direct-effect", 7, ["outcome", "population"]), claim("important-harm", 2, ["population"]), claim("real-comparator", 1, ["outcome"])],
      parkedDimensions: [],
      gapTriggers: [],
    }, ["outcome", "population"]),
    schemaVersion: "0.2.0",
    briefId: "brief-share-test",
    caseId: "case-share-test",
    originalQuestion: "Are eggs good to eat?",
    compiledQuestion: "Should I eat one or two eggs with breakfast?",
    decisionContext: "Private answer: two eggs with toast in Kerala.",
    dimensionAssignments: buildDimensionAssignments({ clusters, dimensionRoles: completeDimensionRoles(clusters) }),
    contextualization: [{ axisId: "outcome", label: "Goal", question: "What matters?", whyItMatters: "It changes the outcome.", effect: "match", selectedValues: ["satiety"], typedAnswer: "I train often", researchConsequence: "Search satiety and performance outcomes." }],
    privacy: { localContextPolicy: "Keep local.", outboundQueryPolicy: "Send compact concepts." },
    generatedAt: "2026-07-20T00:00:00.000Z",
    compiledBy: "Astra",
  });
  const projected = projectResearchBriefForArtifact(brief);
  assert.equal(projected.privacy.shareContextInArtifact, false);
  assert.equal(projected.compiledQuestion, projected.originalQuestion);
  assert.equal(projected.contextualization[0].typedAnswer, "");
  assert.match(projected.contextualization[0].researchConsequence, /satiety/);
  assert.deepEqual(projected.stakeholderProfile.localOnlyFacts, []);
  const shared = projectResearchBriefForArtifact(brief, true);
  assert.equal(shared.compiledQuestion, brief.compiledQuestion);
  assert.equal(shared.contextualization[0].typedAnswer, "I train often");
});
