import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalHumanSuppliedValues,
  decisionGraphProjection,
  decisionSynthesisSchema,
  privacyMinimizedDecisionBrief,
  validateDecisionOptionCoverage,
  validateDecisionReferences,
} from "../lib/decision-synthesis.ts";

function fixture() {
  return decisionSynthesisSchema.parse({
    schemaVersion: "0.2.0",
    recommendation: {
      stance: "conditional",
      optionId: "option-a",
      headline: "Run the reversible option only under the stated comparator.",
      action: "Choose option-a for one week if it replaces the named breakfast and the safety constraint is already resolved.",
    },
    broadVsApplicable: "The broad evidence is mixed; the directly applicable evidence is narrower and does not establish a universal advantage.",
    options: [
      {
        optionId: "option-a",
        label: "Try the intervention",
        feasibility: "available-now",
        outcomeReads: [{
          outcome: "Adherence",
          direction: "favors",
          claimFrameIds: ["claim-1"],
          basisResultIds: ["result-1"],
          basisRelationIds: ["relation-1"],
          interpretation: "The accepted result supports a short-term adherence benefit under this comparator.",
          applicabilityCaveat: "The represented population is only a near match.",
        }],
        tradeoffs: ["Requires preparation time."],
      },
      {
        optionId: "option-b",
        label: "Keep the current action",
        feasibility: "available-now",
        outcomeReads: [{
          outcome: "Adherence",
          direction: "uncertain",
          claimFrameIds: ["claim-1"],
          basisResultIds: [],
          basisRelationIds: [],
          interpretation: "No accepted result directly compares this exact option.",
          applicabilityCaveat: "This is an explicit evidence gap.",
        }],
        tradeoffs: ["Preserves the current routine."],
      },
    ],
    loadBearingResultIds: ["result-1"],
    loadBearingFamilyIds: ["family-1"],
    cruxes: [{
      question: "What does the intervention replace?",
      whyItMatters: "The comparator changes the estimand.",
      wouldFlipDecisionIf: "The intervention is added rather than substituted.",
      resolvability: "personally-measurable",
    }],
    stability: {
      label: "conditional",
      survives: ["Small preference changes."],
      flipsUnder: ["A safety constraint or different comparator."],
    },
    valuesAndConstraints: {
      humanSupplied: ["The option must be feasible next week."],
      modelAssumptions: ["Short-term adherence is decision-relevant."],
    },
    missingEvidence: [{
      gap: "Direct evidence for the exact comparator.",
      whyDecisionRelevant: "It could reverse the direction of the practical effect.",
      nextAction: "Run the comparator-specific search lane.",
    }],
    observationProtocol: {
      title: "One-week usability check",
      purpose: "Measure adherence and tolerance.",
      duration: "Seven days",
      measurements: ["Adherence", "Tolerance"],
      stoppingConditions: ["Stop for adverse symptoms."],
      cannotEstablish: ["Long-term clinical benefit."],
    },
  });
}

test("decision synthesis accepts only known result and family references", () => {
  const synthesis = fixture();
  assert.deepEqual(
    validateDecisionReferences(
      synthesis,
      ["result-1"],
      ["family-1"],
      { "result-1": "family-1" },
      ["claim-1"],
      { "relation-1": { resultId: "result-1", claimFrameId: "claim-1", relation: "supports" } },
    ),
    {
      valid: true,
      unknownResultIds: [],
      unknownFamilyIds: [],
      unknownRelationIds: [],
      unknownClaimFrameIds: [],
      mismatchedResultRelationIds: [],
      mismatchedClaimRelationIds: [],
      ungroundedBasisResultIds: [],
      missingLoadBearingFamilyIds: [],
      unbackedLoadBearingFamilyIds: [],
    },
  );
  synthesis.options[0].outcomeReads[0].basisResultIds.push("invented-result");
  const invalid = validateDecisionReferences(
    synthesis,
    ["result-1"],
    ["family-1"],
    { "result-1": "family-1" },
    ["claim-1"],
    { "relation-1": { resultId: "result-1", claimFrameId: "claim-1", relation: "supports" } },
  );
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.unknownResultIds, ["invented-result"]);
});

test("decision synthesis keeps empirical outcomes separate from model assumptions", () => {
  const synthesis = fixture();
  assert.equal(synthesis.options[0].outcomeReads[0].basisResultIds[0], "result-1");
  assert.match(synthesis.valuesAndConstraints.modelAssumptions[0], /decision-relevant/i);
  assert.equal("confidence" in synthesis, false);
  assert.equal("probability" in synthesis, false);
});

test("directional outcomes require both result and relation grounding", () => {
  const synthesis = fixture();
  synthesis.options[0].outcomeReads[0].basisRelationIds = [];
  assert.equal(decisionSynthesisSchema.safeParse(synthesis).success, false);
  synthesis.options[0].outcomeReads[0].basisRelationIds = ["relation-1"];
  synthesis.options[0].outcomeReads[0].basisResultIds = [];
  assert.equal(decisionSynthesisSchema.safeParse(synthesis).success, false);
});

test("a real result attached to the wrong claim is rejected", () => {
  const synthesis = fixture();
  synthesis.options[0].outcomeReads[0].claimFrameIds = ["claim-2"];
  const validation = validateDecisionReferences(
    synthesis,
    ["result-1"],
    ["family-1"],
    { "result-1": "family-1" },
    ["claim-1", "claim-2"],
    { "relation-1": { resultId: "result-1", claimFrameId: "claim-1", relation: "supports" } },
  );
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.mismatchedClaimRelationIds, ["relation-1"]);
});

test("decision validation requires the exact contextualized action space", () => {
  const brief = {
    stakeholderProfile: {
      objectives: ["Maintain training performance"],
      hardConstraints: ["Breakfast must take under 15 minutes"],
      preferences: ["Prefer locally available food"],
    },
    actionSpace: {
      currentAction: "Keep the current breakfast",
      decisionHorizon: "next week",
      options: [
        { id: "keep", label: "Keep", feasibility: "available-now" },
        { id: "swap", label: "Swap", feasibility: "available-now" },
      ],
    },
  };
  const synthesis = fixture();
  synthesis.options = [
    { ...synthesis.options[0], optionId: "keep", label: "Keep" },
    { ...synthesis.options[1], optionId: "swap", label: "Swap" },
  ];
  synthesis.recommendation.optionId = "keep";
  assert.equal(validateDecisionOptionCoverage(synthesis, brief).valid, true);
  synthesis.options[1].optionId = "invented";
  const invalid = validateDecisionOptionCoverage(synthesis, brief);
  assert.deepEqual(invalid.unknownOptionIds, ["invented"]);
  assert.deepEqual(invalid.missingOptionIds, ["swap"]);
  assert.deepEqual(canonicalHumanSuppliedValues(brief), [
    "Maintain training performance",
    "Breakfast must take under 15 minutes",
    "Prefer locally available food",
    "Current action: Keep the current breakfast",
    "Decision horizon: next week",
  ]);
});

test("decision projection preserves IDs and family structure without promoting counts to evidence", () => {
  const projection = decisionGraphProjection({
    contractVersion: "live-artifact.v1",
    caseId: "case-1",
    latestEvidenceAt: "2026-07-23T00:00:00.000Z",
    latestEvidenceSnapshot: {
      id: "snapshot-1",
      parentId: null,
      actor: "review",
      operation: "autopromote-full-text-results",
      createdAt: "2026-07-23T00:00:00.000Z",
    },
    integrityWarnings: [],
    missingClaims: [],
    graph: {
      claimFrames: [],
      sources: [],
      studies: [],
      analyses: [],
      results: [{
        id: "result-1",
        analysisId: "analysis-1",
        dependenceGroupId: "family-1",
        resultRole: "primary",
        resultText: "A result",
        estimate: {},
        locator: "Table 1",
        excerpt: "x".repeat(900),
        verificationStatus: "full-text",
        details: {
          applicability: {
            matched: ["private exact match"],
            mismatched: ["private mismatch"],
            unknown: ["private unknown"],
            constraintRelaxations: ["private relaxation"],
            distance: "near",
          },
          private: "ignored",
        },
      }],
      evidenceRelations: [{
        id: "relation-1",
        caseId: "case-1",
        resultId: "result-1",
        claimFrameId: "claim-1",
        relation: "supports",
        scopeMatch: "partial",
        rationale: "The result bears on the claim.",
        assessor: "review",
        status: "accepted-by-dual-model-review",
        createdAt: "2026-07-23T00:00:00.000Z",
      }],
      dependenceGroups: [{
        id: "family-1",
        label: "One sample",
        reason: "Correlated endpoints",
        dependsOn: [],
      }],
    },
  });
  assert.equal(projection.evidenceVersion, "snapshot-1");
  assert.equal(projection.results[0].excerpt.length, 800);
  assert.deepEqual(projection.results[0].applicability, {
    distance: "near",
    matchedFieldCount: 1,
    mismatchedFieldCount: 1,
    unknownFieldCount: 1,
    constraintRelaxationCount: 1,
  });
  assert.doesNotMatch(JSON.stringify(projection), /private exact match|private mismatch|private unknown|private relaxation/);
  assert.equal("counts" in projection, false);
});

test("abstract-only accepted records remain in the artifact but are excluded from decision synthesis", () => {
  const artifact = {
    contractVersion: "live-artifact.v1",
    caseId: "case-1",
    latestEvidenceAt: "2026-07-23T00:00:00.000Z",
    latestEvidenceSnapshot: null,
    integrityWarnings: [],
    missingClaims: [],
    graph: {
      claimFrames: [],
      sources: [],
      studies: [],
      analyses: [],
      results: [{
        id: "abstract-result",
        analysisId: "analysis-1",
        dependenceGroupId: "family-1",
        resultRole: "primary",
        resultText: "Abstract result",
        estimate: {},
        locator: "Abstract",
        excerpt: "Abstract excerpt",
        verificationStatus: "abstract-only",
        details: {},
      }],
      evidenceRelations: [{
        id: "abstract-relation",
        resultId: "abstract-result",
        claimFrameId: "claim-1",
        relation: "supports",
        status: "accepted-pending-full-text",
      }],
      dependenceGroups: [],
    },
  };
  const projection = decisionGraphProjection(artifact);
  assert.deepEqual(projection.results, []);
  assert.deepEqual(projection.relations, []);
  assert.deepEqual(projection.eligibility.excludedAcceptedResultIds, ["abstract-result"]);
});

test("privacy-minimized decision brief excludes local-only context and the raw rant", () => {
  const projected = privacyMinimizedDecisionBrief({
    schemaVersion: "0.2.0",
    briefId: "brief-123",
    caseId: "case-1",
    originalQuestion: "raw question",
    compiledQuestion: "compiled decision",
    decisionContext: "private free-text rant",
    stakeholderProfile: {
      summary: "private summary",
      objectives: ["Improve adherence"],
      hardConstraints: ["Available next week"],
      preferences: ["Prefer reversible actions"],
      localOnlyFacts: ["Exact home address"],
    },
    actionSpace: {
      decision: "Choose an action",
      currentAction: "Keep",
      options: [
        { id: "keep", label: "Keep", description: "Keep current action", feasibility: "available-now" },
        { id: "swap", label: "Swap", description: "Try alternative", feasibility: "plausible" },
      ],
      decisionHorizon: "next week",
      measurementPlan: ["Track adherence"],
    },
    claims: [],
    parkedDimensions: [],
    gapTriggers: [],
    dimensionAssignments: [],
    privacy: {
      localContextPolicy: "Keep local facts local.",
      outboundQueryPolicy: "Use shareable concepts only.",
    },
    generatedAt: "2026-07-23T00:00:00.000Z",
    compiledBy: "test",
  });
  const serialized = JSON.stringify(projected);
  assert.doesNotMatch(serialized, /private free-text rant|Exact home address|private summary|raw question/);
  assert.match(serialized, /compiled decision|Improve adherence|Try alternative/);
});
