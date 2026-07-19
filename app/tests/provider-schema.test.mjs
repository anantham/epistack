import assert from "node:assert/strict";
import test from "node:test";
import {
  createFallbackDecomposition,
  decompositionProviderJsonSchema,
  decompositionSchema,
} from "../lib/decomposition-server.ts";
import { readFile } from "node:fs/promises";

const unsupportedStructuredOutputKeywords = new Set([
  "minLength", "maxLength", "pattern", "format",
  "minimum", "maximum", "multipleOf",
  "patternProperties", "unevaluatedProperties", "propertyNames", "minProperties", "maxProperties",
  "unevaluatedItems", "contains", "minContains", "maxContains", "minItems", "maxItems", "uniqueItems",
]);

function collectUnsupportedKeywords(value, path = "$", findings = []) {
  if (!value || typeof value !== "object") return findings;
  for (const [key, child] of Object.entries(value)) {
    if (unsupportedStructuredOutputKeywords.has(key)) findings.push(`${path}.${key}`);
    if (child && typeof child === "object") collectUnsupportedKeywords(child, `${path}.${key}`, findings);
  }
  return findings;
}

test("the provider schema contains only Azure-supported constraint keywords", () => {
  assert.deepEqual(
    collectUnsupportedKeywords(decompositionProviderJsonSchema),
    [],
    "Provider JSON Schema must omit constraints Azure structured outputs do not support",
  );
});

test("semantic cardinality checks still run after provider generation", () => {
  const complete = createFallbackDecomposition(
    "Are eggs good to eat? Bad to eat? Great in moderation? How can we tell? Does it vary across people?",
  );
  assert.equal(decompositionSchema.safeParse(complete).success, true);
  assert.equal(decompositionSchema.safeParse({ ...complete, axes: complete.axes.slice(0, 1) }).success, false);
});

test("context elicitation offers concrete answer handles", async () => {
  const [serverSource, typeSource] = await Promise.all([
    readFile(new URL("../lib/decomposition-server.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/decomposition.ts", import.meta.url), "utf8"),
  ]);
  assert.match(serverSource, /options: z\.array/);
  assert.match(typeSource, /options: string\[\]/);
});
