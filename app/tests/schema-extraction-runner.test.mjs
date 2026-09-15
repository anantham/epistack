import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { runSchemaExtractionWithFallback } from "../lib/schema-extraction-runner.ts";

const schema = z.object({ answer: z.string().min(2) });
const outage = () => Object.assign(new Error("gateway unavailable"), { code: "backend-unreachable" });

test("uses the alternate provider only for a classified backend outage", async () => {
  const calls = [];
  const result = await runSchemaExtractionWithFallback({
    schema,
    instructions: "Return an answer.",
    task: "Answer the question.",
    primary: async () => {
      calls.push("primary");
      throw outage();
    },
    fallback: async () => {
      calls.push("fallback");
      return JSON.stringify({ answer: "recovered" });
    },
    isBackendUnreachable: (error) => error?.code === "backend-unreachable",
  });

  assert.deepEqual(result, { answer: "recovered" });
  assert.deepEqual(calls, ["primary", "fallback"]);
});

test("keeps repair on the provider that produced the malformed response", async () => {
  const calls = [];
  const result = await runSchemaExtractionWithFallback({
    schema,
    instructions: "Return an answer.",
    task: "Answer the question.",
    primary: async (task) => {
      calls.push({ provider: "primary", task });
      return calls.length === 1 ? JSON.stringify({ answer: 7 }) : JSON.stringify({ answer: "repaired" });
    },
    fallback: async () => {
      calls.push({ provider: "fallback" });
      return JSON.stringify({ answer: "wrong provider" });
    },
    isBackendUnreachable: () => false,
  });

  assert.deepEqual(result, { answer: "repaired" });
  assert.deepEqual(calls.map((call) => call.provider), ["primary", "primary"]);
  assert.match(calls[1].task, /PREVIOUS ATTEMPT/);
});

test("does not hide a non-connectivity error behind the fallback", async () => {
  const failure = new Error("provider rejected the prompt");
  let fallbackCalls = 0;
  await assert.rejects(
    runSchemaExtractionWithFallback({
      schema,
      instructions: "Return an answer.",
      task: "Answer the question.",
      primary: async () => { throw failure; },
      fallback: async () => { fallbackCalls += 1; return JSON.stringify({ answer: "no" }); },
      isBackendUnreachable: () => false,
    }),
    failure,
  );
  assert.equal(fallbackCalls, 0);
});
