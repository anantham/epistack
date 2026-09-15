import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInvestigationJson } from "../lib/investigation-json.ts";
import { chunkExtractionSchema } from "../lib/chunked-full-text.ts";

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

test("normalization adapts the observed legacy native result shape conservatively", () => {
  const value = JSON.parse(normalizeInvestigationJson(JSON.stringify({
    artifactHash: "a".repeat(64),
    chunkRead: true,
    sectionsRead: { methods: true, results: true, tables: false, interpretation: true, supplementaryMaterial: false },
    results: [{
      resultIndex: 0,
      claimFrame: "egg-cardiometabolic-risk",
      resultType: "between-condition biomarker",
      resultText: "LDL-C decreased less during the Egg condition than during the Non-Egg condition.",
      exactExcerpt: "LDL-C decreased less during the Egg condition than during the Non-Egg condition.",
      locator: "Results section",
      estimate: "2.9% versus 6.0% reduction",
      comparator: "Energy-matched non-egg breakfast",
      relationPolarity: "egg_less_favorable",
      applicability: {
        age: "Indirect: mean age 54.1 years versus target age 31 years.",
        dose: "2 eggs/day for 6 days/week matches the proposed egg frequency.",
      },
    }],
    inspectionNote: "The bounded artifact segment was inspected.",
  })));

  const parsed = chunkExtractionSchema.parse(value);
  const result = parsed.results[0];
  assert.equal(result.claimFrameId, "egg-cardiometabolic-risk");
  assert.equal(result.analysisType, "between-condition biomarker");
  assert.equal(result.resultRole, "secondary");
  assert.equal(result.relation, "qualifies");
  assert.equal(result.scopeMatch, "indirect");
  assert.equal(result.applicability.distance, "indeterminate");
  assert.ok(result.applicability.mismatched.some((item) => item.includes("mean age")));
});
