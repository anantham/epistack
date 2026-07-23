import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeRecallLane,
  recallLaneDraftSchema,
  recallLeadDraftSchema,
  recallRequestSchema,
} from "../lib/broad-recall.ts";
import { resolveAgentPrompt } from "../lib/agent-prompts.ts";
import { extractRecallToolTraceEvents } from "../scripts/local-claude-agents.mjs";

const observedAt = "2026-07-23T08:00:00.000Z";
const claim = {
  id: "egg-ldl-response",
  statement: "Eating two eggs daily changes LDL cholesterol versus the feasible egg-free breakfast.",
  population: "Resistance-trained adults",
  exposure: "Two eggs daily",
  comparator: "A feasible egg-free breakfast",
  outcome: "LDL cholesterol",
  timeHorizon: "Twelve weeks",
  decisionLeverage: "A large adverse change would alter whether the actor begins the breakfast experiment.",
  applicabilityFields: ["baseline LDL", "egg dose", "training status"],
};

function laneDraft() {
  return {
    searchSummary: "The lane searched for direct, disconfirming, and boundary-setting sources.",
    unsearchedBoundaries: ["Paywalled supplements were not accessible."],
    leads: [{
      claimIds: [claim.id],
      source: {
        url: "https://example.org/systematic-review",
        title: "Egg intake and cardiovascular markers: a systematic review",
        type: "systematic-review",
      },
      whyRelevant: "It may bound the expected lipid response and identifies trials for full-text acquisition.",
      disconfirming: true,
      limitation: "The review must not substitute for extracting its included trials.",
      reportedQuery: "egg intake LDL randomized systematic review",
      status: "lead-only",
    }],
  };
}

test("lead discovery contracts keep web discoveries outside the evidence graph", () => {
  assert.equal(recallLaneDraftSchema.parse(laneDraft()).leads[0].status, "lead-only");
  assert.equal(recallLeadDraftSchema.safeParse({ ...laneDraft().leads[0], status: "evidence" }).success, false);
  assert.equal(recallRequestSchema.parse({
    question: "Are eggs good to eat for this person?",
    claims: [claim],
  }).applicabilityProfile.populationTerms.length, 0);
});

test("actual Claude WebSearch and WebFetch invocations become bounded tool traces", () => {
  const pending = new Map();
  const requested = extractRecallToolTraceEvents({
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: "tool-search-1", name: "WebSearch", input: { query: "egg intake LDL randomized systematic review" } },
        { type: "tool_use", id: "tool-fetch-1", name: "WebFetch", input: { url: "https://example.org/systematic-review" } },
      ],
    },
  }, "broad-recall", pending, observedAt);
  const completed = extractRecallToolTraceEvents({
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "tool-search-1", content: "omitted from trace" },
        { type: "tool_result", tool_use_id: "tool-fetch-1", content: "omitted from trace" },
      ],
    },
  }, "broad-recall", pending, "2026-07-23T08:00:01.000Z");
  assert.deepEqual(requested.map((event) => [event.tool, event.state]), [
    ["WebSearch", "requested"],
    ["WebFetch", "requested"],
  ]);
  assert.ok(completed.every((event) => event.state === "completed"));
  assert.ok(requested.every((event) => !("content" in event)));

  const normalized = normalizeRecallLane("broad-recall", laneDraft(), [...requested, ...completed]);
  assert.equal(normalized.leads[0].status, "lead-only");
  assert.equal(normalized.leads[0].discovery.queryObserved, true);
  assert.equal(normalized.leads[0].discovery.sourceFetchObserved, true);
  assert.equal(normalized.leads[0].discovery.observability, "cli-observed");
  assert.equal(normalized.lane.leadIds[0], normalized.leads[0].id);
});

test("the specialist prompt and local endpoint name the lead-only boundary", async () => {
  const prompt = resolveAgentPrompt("broad-recall-specialist");
  assert.match(prompt.instructions, /do not create evidence records/i);
  assert.match(prompt.instructions, /broad-recall/);
  assert.match(prompt.instructions, /applicability/);
  assert.match(prompt.instructions, /status "lead-only"/);

  const server = await readFile(new URL("../scripts/local-claude-agents.mjs", import.meta.url), "utf8");
  assert.match(server, /request\.url === "\/recall"/);
  assert.match(server, /--output-format", "stream-json"/);
  assert.match(server, /extractRecallToolTraceEvents/);
  assert.match(server, /RECALL_DISCOVERY_FAILURE/);
});
