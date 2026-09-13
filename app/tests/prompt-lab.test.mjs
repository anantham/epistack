import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  agentPromptDefinitions,
  agentPromptPhases,
  decomposeFewShotContext,
  decomposeFewShotQuestion,
  decomposeFewShotScout,
  decomposeFewShotTrace,
  promptOverridesSignature,
  renderAgentPrompt,
  resolveAgentPrompt,
  sanitizeAgentPromptOverrides,
} from "../lib/agent-prompts.ts";
import {
  contextAgentSchema,
  dimensionScoutSchema,
  traceAgentSchema,
} from "../lib/decomposition-server.ts";

test("the prompt registry enumerates every live model specialist", () => {
  assert.deepEqual(agentPromptDefinitions.map((prompt) => prompt.id), [
    "dimension-scout",
    "trace-specialist",
    "context-retrieval",
    "research-brief-compiler",
    "broad-recall-specialist",
    "abstract-extractor",
    "full-paper-extractor",
    "adversarial-reviewer",
    "decision-synthesizer",
  ]);
  for (const prompt of agentPromptDefinitions) {
    assert.ok(prompt.instructions.length > 100);
    assert.ok(prompt.taskTemplate.includes("{{"));
    assert.ok(prompt.outputContract.length > 10);
    assert.ok(agentPromptPhases.some((phase) => phase.id === prompt.phase));
    assert.ok(prompt.runtime === "hosted" || prompt.runtime === "companion");
  }
});

test("the prompt registry groups every specialist by pipeline phase and runtime", () => {
  assert.deepEqual(
    agentPromptDefinitions.filter((prompt) => prompt.phase === "Decompose").map((prompt) => prompt.id),
    ["dimension-scout", "trace-specialist"],
  );
  assert.deepEqual(
    agentPromptDefinitions.filter((prompt) => prompt.phase === "Contextualize").map((prompt) => prompt.id),
    ["context-retrieval"],
  );
  assert.deepEqual(
    agentPromptDefinitions.filter((prompt) => prompt.phase === "Orchestrate").map((prompt) => prompt.id),
    ["research-brief-compiler"],
  );
  assert.deepEqual(
    agentPromptDefinitions.filter((prompt) => prompt.runtime === "hosted").map((prompt) => prompt.id),
    ["dimension-scout", "trace-specialist", "context-retrieval", "abstract-extractor", "decision-synthesizer"],
  );
  assert.deepEqual(
    agentPromptDefinitions.filter((prompt) => prompt.runtime === "companion").map((prompt) => prompt.id),
    ["research-brief-compiler", "broad-recall-specialist", "full-paper-extractor", "adversarial-reviewer"],
  );
});

test("decompose specialists few-shot coffee and hold out the eggs evaluation case", () => {
  assert.deepEqual(dimensionScoutSchema.parse(decomposeFewShotScout), decomposeFewShotScout);
  assert.deepEqual(traceAgentSchema.parse(decomposeFewShotTrace), decomposeFewShotTrace);
  assert.deepEqual(contextAgentSchema.parse(decomposeFewShotContext), decomposeFewShotContext);
  for (const trace of decomposeFewShotTrace.traces) {
    for (const quote of trace.quotes) {
      assert.ok(decomposeFewShotQuestion.includes(quote), `trace quote is not a substring: ${quote}`);
    }
  }
  for (const id of ["dimension-scout", "trace-specialist", "context-retrieval"]) {
    const prompt = resolveAgentPrompt(id);
    const text = [prompt.instructions, prompt.taskTemplate, prompt.repairTemplate ?? ""].join("\n");
    assert.match(text, /Is coffee good to drink\?/);
    assert.doesNotMatch(text, /\beggs?\b/i);
  }
});

test("prompt overrides resolve into runtime text and cache identity", () => {
  const overrides = sanitizeAgentPromptOverrides({
    "dimension-scout": { instructions: "Custom dimension instructions that are deliberately long enough to be retained." },
    ignored: { instructions: "This unknown agent must not be accepted." },
  });
  assert.equal(resolveAgentPrompt("dimension-scout", overrides).instructions, "Custom dimension instructions that are deliberately long enough to be retained.");
  assert.notEqual(promptOverridesSignature({}), promptOverridesSignature(overrides));
  assert.equal(renderAgentPrompt("Question: {{question}}", { question: "Are eggs good?" }), "Question: Are eggs good?");
});

test("the settings link opens an editable Prompt Lab wired into model requests", async () => {
  const [home, lab, settings, decompositionApi, deepDiveApi, dashboard] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/prompts/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/backend-settings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/decompose/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/deep-dive/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/research/research-dashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(home, /BackendSettings/);
  assert.match(settings, /href="\/prompts"/);
  assert.match(settings, /AI agent prompts/);
  assert.match(lab, /Prompt Lab/);
  assert.match(lab, /System instructions/);
  assert.match(lab, /Runtime task template/);
  assert.match(lab, /Save prompt configuration/);
  assert.match(lab, /agentPromptStorageKey/);
  assert.match(lab, /agentPromptPhases/);
  assert.match(lab, /agentPromptRuntimeLabels/);
  assert.match(lab, /prompt-phase-group/);
  assert.match(lab, /Pipeline order/);
  for (const source of [decompositionApi, deepDiveApi]) {
    assert.match(source, /resolveAgentPrompt/);
    assert.match(source, /promptOverridesSignature/);
    assert.match(source, /promptConfig/);
  }
  assert.match(dashboard, /promptOverrides: promptOverrides\(\)/);
  assert.match(dashboard, /\/api\/investigate/);
});
