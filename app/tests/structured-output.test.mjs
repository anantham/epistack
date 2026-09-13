import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  extractJsonSlice,
  formatZodIssues,
  parseStructured,
  parseStructuredWithRepair,
  StructuredOutputError,
} from "../lib/structured-output.ts";

const schema = z.object({ name: z.string().min(2), count: z.number().int().min(1) });

test("extractJsonSlice pulls a balanced object out of surrounding prose", () => {
  const text = 'Sure! Here is the JSON:\n{"name":"eggs","count":2}\nLet me know.';
  assert.equal(extractJsonSlice(text), '{"name":"eggs","count":2}');
});

test("extractJsonSlice ignores braces inside strings and handles nesting", () => {
  const text = '```json\n{"name":"a } b","count":1,"nested":{"x":1}}\n```';
  const slice = extractJsonSlice(text);
  assert.deepEqual(JSON.parse(slice), { name: "a } b", count: 1, nested: { x: 1 } });
});

test("extractJsonSlice returns null when no JSON is present", () => {
  assert.equal(extractJsonSlice("no structured output here"), null);
});

test("parseStructured tolerates markdown fences", () => {
  assert.deepEqual(parseStructured('```json\n{"name":"ok","count":3}\n```', schema), { name: "ok", count: 3 });
});

test("parseStructured reports schema issues with paths and keeps the raw text", () => {
  assert.throws(() => parseStructured('{"name":"x","count":0}', schema), (error) => {
    assert.ok(error instanceof StructuredOutputError);
    assert.match(error.issues, /name: /);
    assert.match(error.issues, /count: /);
    assert.match(error.raw, /"count":0/);
    return true;
  });
});

test("parseStructuredWithRepair recovers when the repair returns valid JSON", async () => {
  let calls = 0;
  const value = await parseStructuredWithRepair({
    text: '{"name":"x","count":0}',
    schema,
    repair: async ({ issues }) => {
      calls += 1;
      assert.match(issues, /count/);
      return '{"name":"fixed","count":4}';
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(value, { name: "fixed", count: 4 });
});

test("parseStructuredWithRepair gives up after the repair budget", async () => {
  let calls = 0;
  await assert.rejects(
    parseStructuredWithRepair({
      text: "not json at all",
      schema,
      repair: async () => {
        calls += 1;
        return "still not json";
      },
    }),
    (error) => error instanceof StructuredOutputError,
  );
  assert.equal(calls, 1);
});

test("formatZodIssues renders the failing paths", () => {
  const result = schema.safeParse({ name: "x", count: 0 });
  assert.equal(result.success, false);
  const text = formatZodIssues(result.error);
  assert.match(text, /name/);
  assert.match(text, /count/);
});