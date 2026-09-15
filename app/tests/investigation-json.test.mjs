import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInvestigationJson } from "../lib/investigation-json.ts";

/* Test intent
 * - Normalize common model aliases before the shared Zod schema sees them.
 * - Convert unsupported applicability/conclusion enum text to explicit
 *   unknown values, never to an invented positive semantic.
 * - Preserve the existing JSON extraction behavior for fenced responses.
 */

test("normalization fails closed for unsupported applicability and conclusion values", () => {
  const normalized = normalizeInvestigationJson(`\`\`\`json
  {
    "results": [{
      "rationale": ["The population was reported.", "The comparison was reported."],
      "applicability": { "distance": "not applicable", "rationale": { "text": "The setting was not described." } }
    }],
    "conclusionFit": "not available"
  }
  \`\`\``);
  const value = JSON.parse(normalized);

  assert.equal(value.results[0].applicability.distance, "indeterminate");
  assert.equal(value.results[0].rationale, "The population was reported. The comparison was reported.");
  assert.equal(value.results[0].applicability.rationale, "The setting was not described.");
  assert.equal(value.conclusionFit, "not-stated");
});

test("normalization keeps known aliases semantically intact", () => {
  const value = JSON.parse(normalizeInvestigationJson(JSON.stringify({
    results: [{
      applicability: { distance: "near exact" },
      resultRole: "primary result",
      scopeMatch: "exact match",
    }],
    conclusionFit: "broader than result",
  })));

  assert.equal(value.results[0].applicability.distance, "near");
  assert.equal(value.results[0].resultRole, "primary");
  assert.equal(value.results[0].scopeMatch, "direct");
  assert.equal(value.conclusionFit, "broader-than-results");
});
