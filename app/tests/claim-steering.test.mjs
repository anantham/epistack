import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  defaultBriefSteering,
  fitContext,
  isShareableFact,
  nextSocket,
  parseBriefSteering,
  queryFromChips,
  recallSteering,
  searchTerms,
  steeringNoteLimit,
  steeringPlanSummary,
  strongestEffort,
} from "../lib/claim-steering.ts";

const claim = (id, priority, budgetShare, routing = {}) => ({
  id,
  priority,
  budgetShare,
  axisIds: ["outcome", "population", "sourcing"],
  queryUsesAxisIds: [],
  applicabilityUsesAxisIds: [],
  ...routing,
});

const brief = {
  briefId: "brief-steering-test",
  claims: [
    claim("cooking-method", 2, 20),
    claim("eggs-and-ldl", 1, 70, { queryUsesAxisIds: ["outcome"], applicabilityUsesAxisIds: ["population"] }),
    claim("yogurt-swap", 3, 10),
  ],
  contextualization: [
    { axisId: "outcome", label: "Good for what?", selectedValues: ["LDL cholesterol"], typedAnswer: "worried about heart risk" },
    { axisId: "population", label: "For whom?", selectedValues: ["healthy adult"], typedAnswer: "" },
    { axisId: "sourcing", label: "Where from?", selectedValues: ["Quatre Bornes market stall"], typedAnswer: "" },
  ],
  dimensionAssignments: [
    { axisId: "outcome", role: "decision-active" },
    { axisId: "population", role: "applicability-only" },
    { axisId: "sourcing", role: "parked" },
  ],
  parkedDimensions: [],
  stakeholderProfile: { localOnlyFacts: ["Shops at the Quatre Bornes market stall every Sunday"] },
};

const socketsFor = (steering, claimId) =>
  Object.fromEntries(steering.claims[claimId].facts.map((fact) => [fact.value, fact.socket]));

test("defaults keep every claim, hunt both ways, and spend Thorough only on the top-priority claim", () => {
  const steering = defaultBriefSteering(brief);
  assert.deepEqual(
    Object.fromEntries(Object.entries(steering.claims).map(([id, value]) => [id, [value.parked, value.hunt, value.effort]])),
    {
      "cooking-method": [false, "either", "standard"],
      "eggs-and-ldl": [false, "either", "thorough"],
      "yogurt-swap": [false, "either", "standard"],
    },
  );
});

test("answers follow the brief's routing, and typed or private answers never default to Search", () => {
  const steering = defaultBriefSteering(brief);
  assert.deepEqual(socketsFor(steering, "eggs-and-ldl"), {
    "LDL cholesterol": "search",
    "worried about heart risk": "fit",
    "healthy adult": "fit",
    "Quatre Bornes market stall": "ignore",
  });
  assert.deepEqual(socketsFor(steering, "cooking-method")["LDL cholesterol"], "fit");
  assert.deepEqual(searchTerms(steering.claims["eggs-and-ldl"]), ["LDL cholesterol"]);
  assert.deepEqual(
    fitContext(steering.claims["eggs-and-ldl"]).map((fact) => fact.value),
    ["LDL cholesterol", "worried about heart risk", "healthy adult"],
  );
});

test("a local-only or identifying answer cannot be switched into Search", () => {
  assert.equal(isShareableFact("Quatre Bornes market stall", brief.stakeholderProfile.localOnlyFacts), false);
  assert.equal(isShareableFact("reach me at someone@example.com", []), false);
  assert.equal(isShareableFact("12 Royal Road", []), false);
  assert.equal(isShareableFact("31-year-old man", []), true);
  assert.equal(nextSocket("fit", false), "ignore");
  assert.equal(nextSocket("ignore", false), "fit");
  assert.equal(nextSocket("ignore"), "search");

  const saved = defaultBriefSteering(brief);
  const privateFact = saved.claims["eggs-and-ldl"].facts.find((fact) => !fact.shareable);
  privateFact.socket = "search";
  const restored = parseBriefSteering(JSON.stringify(saved), brief);
  assert.equal(restored.claims["eggs-and-ldl"].facts.find((fact) => fact.id === privateFact.id).socket, "fit");
  assert.equal(searchTerms(restored.claims["eggs-and-ldl"]).includes(privateFact.value), false);
});

test("saved steering restores onto the same brief only, with notes capped", () => {
  const saved = defaultBriefSteering(brief);
  saved.claims["yogurt-swap"].parked = true;
  saved.claims["eggs-and-ldl"].hunt = "disconfirm";
  saved.claims["eggs-and-ldl"].note = "x".repeat(400);
  saved.claims["eggs-and-ldl"].facts[0].socket = "ignore";
  saved.claims["eggs-and-ldl"].facts[0].value = "tampered value";

  const restored = parseBriefSteering(JSON.stringify(saved), brief);
  assert.equal(restored.claims["yogurt-swap"].parked, true);
  assert.equal(restored.claims["eggs-and-ldl"].hunt, "disconfirm");
  assert.equal(restored.claims["eggs-and-ldl"].note.length, steeringNoteLimit);
  assert.equal(restored.claims["eggs-and-ldl"].facts[0].socket, "ignore");
  assert.equal(restored.claims["eggs-and-ldl"].facts[0].value, "LDL cholesterol");

  assert.equal(parseBriefSteering(JSON.stringify({ ...saved, briefId: "another-brief" }), brief).claims["yogurt-swap"].parked, false);
  assert.equal(parseBriefSteering("{not json", brief).claims["yogurt-swap"].parked, false);
  assert.equal(steeringPlanSummary(brief.claims, restored), "Web and PubMed for 2 claims · 1 parked");
});

test("the query offer only reflects chips the person moved, and keeps hand edits", () => {
  const steering = defaultBriefSteering(brief).claims["eggs-and-ldl"];
  const handEdited = '(egg OR eggs) AND "LDL cholesterol" AND randomized';
  assert.equal(queryFromChips(handEdited, steering), null);

  const moved = {
    ...steering,
    facts: steering.facts.map((fact) => fact.value === "LDL cholesterol"
      ? { ...fact, socket: "fit" }
      : fact.value === "healthy adult" ? { ...fact, socket: "search" } : fact),
  };
  const offer = queryFromChips(handEdited, moved);
  assert.deepEqual(offer, {
    query: '(egg OR eggs) AND randomized AND "healthy adult"',
    added: ["healthy adult"],
    removed: ["LDL cholesterol"],
  });
  assert.deepEqual(recallSteering(moved).searchTerms, ["healthy adult"]);
});

test("a shared lane searches at the strongest effort among its claims", () => {
  assert.equal(strongestEffort(["quick", "thorough", "standard"]), "thorough");
  assert.equal(strongestEffort(["quick"]), "quick");
  assert.equal(strongestEffort([]), "standard");
});

test("recall sends search answers and hunt direction, never fit-only answers", async () => {
  const recall = await readFile(new URL("../app/api/recall/route.ts", import.meta.url), "utf8");
  assert.match(recall, /hunt: \$\{huntInstructions\[steering\.hunt\]\}/);
  assert.match(recall, /person-specific search terms \(shareable\)/);
  assert.match(recall, /profile: laneBudget\(claims\)/);
  assert.doesNotMatch(recall, /fitContext|localApplicabilityProfile/);

  const dashboard = await readFile(new URL("../app/research/research-dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /steering: recallSteering\(/);
  assert.match(dashboard, /answers: brief\.claims\.flatMap/);
  assert.doesNotMatch(dashboard, /Run this lane|Editable PubMed query|recallSelectedClaimIds/);
});
