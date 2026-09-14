import assert from "node:assert/strict";
import test from "node:test";
import { buildContextualizationImpact } from "../lib/contextualization-impact.ts";

test("contextualization impact links answers to claims, options, constraints, and gaps", () => {
  const impact = buildContextualizationImpact({
    contextualization: [
      {
        axisId: "dose",
        label: "Egg intake",
        question: "How often?",
        whyItMatters: "Dose changes the comparison.",
        effect: "prune",
        selectedValues: ["about 1/day"],
        typedAnswer: "",
        researchConsequence: "Narrow retrieval around daily intake.",
      },
      {
        axisId: "replacement",
        label: "What changes",
        question: "What does it replace?",
        whyItMatters: "The comparator changes the estimand.",
        effect: "branch",
        selectedValues: [],
        typedAnswer: "processed meat",
        researchConsequence: "Keep substitution paths separate.",
      },
    ],
    claims: [
      { axisIds: ["dose"], shortLabel: "Daily intake claim" },
      { axisIds: ["replacement"], shortLabel: "Substitution claim" },
    ],
    stakeholderProfile: { hardConstraints: ["Budget under $20"] },
    actionSpace: { options: [{ label: "Buy eggs" }, { label: "Keep current breakfast" }] },
    parkedDimensions: [{ axisId: "production", reason: "No decision leverage yet" }],
    gapTriggers: [{ question: "What is baseline LDL?", expectedDecisionValue: "high" }],
  });

  assert.equal(impact.totalQuestions, 2);
  assert.equal(impact.answeredQuestions, 2);
  assert.deepEqual(impact.scopedClaimLabels, ["Daily intake claim", "Substitution claim"]);
  assert.deepEqual(impact.constraints, ["Budget under $20"]);
  assert.deepEqual(impact.options, ["Buy eggs", "Keep current breakfast"]);
  assert.deepEqual(impact.unresolved, ["production: No decision leverage yet", "What is baseline LDL? (high decision value)"]);
  assert.deepEqual(impact.entries[0].changedFields, ["claim scope", "retrieval and screening"]);
});
