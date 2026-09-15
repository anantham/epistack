import { test, expect } from "@playwright/test";

function decomposition(caseId = "case-e2e-a") {
  const cluster = (id, label, question) => ({
    id,
    label,
    highlightQuotes: [],
    latentVariable: `${label} latent variable`,
    rationale: `${label} can change the decision and should be scoped before research.`,
    ingestionRequirements: { requiredFields: ["population"], searchConcepts: [label], mismatchRisks: [] },
    contextQuestion: {
      id: `${id}-question`,
      label,
      question,
      whyItMatters: `This answer changes how the evidence should be applied to ${label}.`,
      effect: "branch",
      options: ["Option A", "Option B"],
    },
  });
  return {
    caseId,
    mode: "ai",
    model: "Astra/Lyra · test fixture",
    provenance: { path: "hosted-primary", provider: "Astra/Lyra", model: "test-fixture", stages: [] },
    warning: null,
    prompt: "Are eggs useful in this diet?",
    decisionContext: "",
    decomposition: {
      caseTitle: "Egg decision",
      summary: "A scoped decision fixture.",
      highlights: [],
      clusters: [
        cluster("dose", "Usual intake", "How many eggs do you usually eat, and how often?"),
        cluster("budget", "Budget and access", "What budget and local food options should the research respect?"),
      ],
      claimTemplate: "For this person and context, compare the relevant options.",
      knownUnknowns: ["Long-term outcome uncertainty"],
    },
    cache: { status: "miss", layer: "d1", createdAt: null, expiresAt: null },
  };
}

function brief(caseId) {
  const claim = (id, label, outcome) => ({
    id,
    shortLabel: label,
    statement: `${label} should be compared for the person's stated decision context.`,
    kind: "effectiveness",
    population: "adults making an ordinary food decision",
    exposure: "the proposed food choice",
    comparator: "the current practical alternative",
    outcome,
    timeHorizon: "the next twelve weeks",
    modality: "associational",
    priority: 3,
    budgetShare: 34,
    decisionLeverage: `This result would change the practical choice about ${label}.`,
    axisIds: ["dose"],
    queryUsesAxisIds: ["dose"],
    applicabilityUsesAxisIds: ["budget"],
    retrieval: {
      searchQuery: `${label} practical food decision evidence`,
      inclusionRule: "Evidence that reports the named outcome in adults.",
      exclusionSignals: ["marketing"],
      relaxationOrder: ["broaden the food terms"],
    },
    applicabilityFields: ["population", "frequency"],
  });
  return {
    schemaVersion: "0.2.0",
    briefId: "brief-e2e-a",
    caseId,
    originalQuestion: "Are eggs useful in this diet?",
    compiledQuestion: "For this person, compare a practical egg choice with the current breakfast.",
    decisionContext: "Two eggs with breakfast; budget and access matter.",
    stakeholderProfile: {
      summary: "An adult deciding whether a regular egg breakfast fits their routine.",
      objectives: ["Make a practical food choice"],
      hardConstraints: ["Respect the available budget"],
      preferences: ["Keep preparation simple"],
      localOnlyFacts: ["Local food access"],
    },
    actionSpace: {
      decision: "Choose a realistic breakfast option.",
      currentAction: "Current breakfast",
      options: [
        { id: "eggs", label: "Eat eggs", description: "Include eggs at breakfast.", feasibility: "available-now" },
        { id: "current", label: "Keep current breakfast", description: "Continue the current alternative.", feasibility: "available-now" },
      ],
      decisionHorizon: "the next twelve weeks",
      measurementPlan: ["Track routine, cost, and relevant outcomes."],
    },
    claims: [
      claim("dose-outcome", "Egg frequency", "practical outcome"),
      claim("budget-outcome", "Food cost", "weekly food cost"),
      claim("routine-outcome", "Breakfast fit", "routine adherence"),
    ],
    parkedDimensions: [],
    gapTriggers: [],
    dimensionAssignments: [
      { axisId: "dose", label: "Usual intake", selectedBranchId: null, selectedValue: null, role: "decision-active", rationale: "Dose changes the decision.", searchConcepts: ["egg frequency"], requiredEvidenceFields: ["frequency"], mismatchRisks: [] },
      { axisId: "budget", label: "Budget and access", selectedBranchId: null, selectedValue: null, role: "decision-active", rationale: "Access changes the practical option.", searchConcepts: ["food cost"], requiredEvidenceFields: ["price"], mismatchRisks: [] },
    ],
    contextualization: [
      { axisId: "dose", label: "Usual intake", question: "How many eggs do you usually eat, and how often?", whyItMatters: "Dose changes how evidence applies.", effect: "branch", selectedValues: [], typedAnswer: "two eggs daily", researchConsequence: "Keep retrieval focused on the stated frequency." },
      { axisId: "budget", label: "Budget and access", question: "What budget and local food options should the research respect?", whyItMatters: "Access changes which option is feasible.", effect: "prune", selectedValues: [], typedAnswer: "local affordable eggs", researchConsequence: "Compare evidence against the available budget." },
    ],
    claimCoverage: [],
    privacy: { localContextPolicy: "Keep personal answers private by default.", outboundQueryPolicy: "Send only compact search concepts.", shareContextInArtifact: false },
    generatedAt: "2026-09-15T00:00:00.000Z",
    compiledBy: "test fixture",
  };
}

test("public stages load without localhost calls or page errors", async ({ page }) => {
  const consoleErrors = [];
  const forbiddenRequests = [];
  const httpErrors = [];
  const baseOrigin = new URL(process.env.EPISTACK_E2E_BASE_URL || "http://localhost:4173").origin;
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("[vite]")) consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (/https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(request.url()) && !request.url().startsWith(baseOrigin)) {
      forbiddenRequests.push(request.url());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });

  for (const path of ["/", "/decompose", "/map", "/research"]) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), path).toBe(200);
    await expect(page.locator("h1").first(), path).toBeAttached();
  }

  expect(forbiddenRequests).toEqual([]);
  expect(httpErrors, httpErrors.join("\n")).toEqual([]);
  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});

test("a stale interview session cannot resume a different decomposition case", async ({ page }) => {
  const current = decomposition("case-current");
  await page.addInitScript((payload) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("epistack:decomposition:v1", JSON.stringify(payload.current));
    sessionStorage.setItem("epistack:contextualize:v1", JSON.stringify({
      caseId: "case-old",
      elicitationIndex: 1,
      contextAnswers: { "budget-question": "stale answer" },
      contextSelections: {},
    }));
  }, { current });

  await page.goto("/map", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /How many eggs do you usually eat/ })).toBeVisible();
  await expect(page.getByText("1 / 2")).toBeVisible();
  await expect(page.locator('input[value="stale answer"]')).toHaveCount(0);
});

test("fixture-backed browser flow reaches the research-claim confirmation", async ({ page }) => {
  const decompositionFixture = decomposition("case-flow");
  const briefFixture = brief("case-flow");
  let decompositionPolls = 0;
  let compilePolls = 0;

  await page.route("**/api/decompose-live", async (route) => {
    const body = route.request().postDataJSON();
    if (!body?.id) {
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: "case-flow", token: "decompose-token", status: "queued", stage: 0, stages: ["one", "two", "three"] }) });
      return;
    }
    decompositionPolls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "case-flow",
        status: "completed",
        stage: 3,
        question: decompositionFixture.prompt,
        decisionContext: "",
        artifact: decompositionFixture.decomposition,
        model: decompositionFixture.model,
        provenance: decompositionFixture.provenance,
      }),
    });
  });

  await page.route("**/api/compile-brief", async (route) => {
    const body = route.request().postDataJSON();
    if (!body?.id) {
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: "brief-flow", token: "brief-token", status: "queued" }) });
      return;
    }
    compilePolls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "completed", brief: briefFixture }) });
  });

  await page.route("**/api/cases", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    } else {
      await route.continue();
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const composer = page.getByLabel("Research question");
  await composer.waitFor();
  await page.waitForTimeout(300);
  await composer.fill("Are eggs useful in this diet?");
  await expect(composer).toHaveValue("Are eggs useful in this diet?");
  await expect(page.getByRole("button", { name: "Decompose question" })).toBeEnabled();
  await page.getByRole("button", { name: "Decompose question" }).click();
  await expect(page.getByRole("heading", { name: "Decomposition" })).toBeVisible();
  await expect(page.getByText("Astra/Lyra · test fixture")).toBeVisible();
  expect(decompositionPolls).toBe(1);

  await page.getByRole("button", { name: /Proceed to Contextualize/ }).click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole("heading", { name: /How many eggs do you usually eat/ })).toBeVisible();
  await page.getByLabel(/How many eggs do you usually eat/).fill("two eggs daily");
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.getByRole("heading", { name: /What budget and local food options/ })).toBeVisible();
  await page.getByLabel(/What budget and local food options/).fill("local affordable eggs");
  await page.getByRole("button", { name: "Finish and compile" }).click();

  await expect(page.getByRole("heading", { name: "Confirm the research claims" })).toBeVisible({ timeout: 15_000 });
  expect(compilePolls).toBe(1);
  await expect(page.getByText("How your answers changed the investigation")).toBeVisible();
  await expect(page.getByText("two eggs daily").first()).toBeVisible();
});
