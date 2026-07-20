import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  agentPromptDefinitions,
  promptOverridesSignature,
  renderAgentPrompt,
  resolveAgentPrompt,
  sanitizeAgentPromptOverrides,
} from "../lib/agent-prompts.ts";

test("the prompt registry enumerates every live model specialist", () => {
  assert.deepEqual(agentPromptDefinitions.map((prompt) => prompt.id), [
    "dimension-scout",
    "trace-specialist",
    "context-retrieval",
    "research-brief-compiler",
    "abstract-extractor",
    "full-paper-extractor",
    "adversarial-reviewer",
  ]);
  for (const prompt of agentPromptDefinitions) {
    assert.ok(prompt.instructions.length > 100);
    assert.ok(prompt.taskTemplate.includes("{{"));
    assert.ok(prompt.outputContract.length > 10);
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
  const [home, lab, decompositionApi, deepDiveApi, dashboard] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/prompts/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/decompose/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/deep-dive/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/research/research-dashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(home, /href="\/prompts"/);
  assert.match(home, /AI agent prompts/);
  assert.match(lab, /Prompt Lab/);
  assert.match(lab, /System instructions/);
  assert.match(lab, /Runtime task template/);
  assert.match(lab, /Save prompt configuration/);
  assert.match(lab, /agentPromptStorageKey/);
  for (const source of [decompositionApi, deepDiveApi]) {
    assert.match(source, /resolveAgentPrompt/);
    assert.match(source, /promptOverridesSignature/);
    assert.match(source, /promptConfig/);
  }
  assert.match(dashboard, /promptOverrides: promptOverrides\(\)/);
  assert.match(dashboard, /localClaudeCompanionUrl/);
});
