import test from "node:test";
import assert from "node:assert/strict";
import {
  assembleDivergences,
  divergencePairs,
  scopeMatch,
} from "../lib/source-divergence.ts";

const scope = (over = {}) => ({ topic: "egg intake and cardiovascular risk", population: "adults", jurisdiction: "United States", ...over });

test("scopeMatch treats missing fields as wildcards and detects scope differences", () => {
  assert.equal(scopeMatch(scope(), scope()), "same");
  assert.equal(scopeMatch(scope(), scope({ population: "older adults" })), "partial");
  assert.equal(scopeMatch(scope(), scope({ jurisdiction: "European Union" })), "partial");
  assert.equal(scopeMatch(scope(), scope({ topic: "egg intake and diabetes risk" })), "different");
  assert.equal(scopeMatch(scope({ population: "" }), scope({ population: "children" })), "same");
});

test("divergencePairs enumerates unordered pairs", () => {
  const items = ["a", "b", "c"].map((id) => ({ id, sourceClass: "guideline", statement: id, comparisonScope: scope() }));
  assert.equal(divergencePairs(items).length, 3);
});

test("assembleDivergences respects scope and drops unknown ids", () => {
  const a = { id: "a", sourceClass: "guideline", statement: "limit eggs", comparisonScope: scope() };
  const b = { id: "b", sourceClass: "guideline", statement: "eggs are fine", comparisonScope: scope({ topic: "egg intake and diabetes risk" }) };
  const c = { id: "c", sourceClass: "standard", statement: "unrelated", comparisonScope: scope() };
  const assembled = assembleDivergences(
    [a, b, c],
    {
      divergences: [
        { aId: "a", bId: "b", verdict: "contradicts", rationale: "opposite advice" },
        { aId: "a", bId: "ghost", verdict: "consistent", rationale: "no such item" },
        { aId: "a", bId: "c", verdict: "consistent", rationale: "compatible" },
      ],
    },
  );
  assert.equal(assembled.length, 2);
  const ab = assembled.find((entry) => entry.bId === "b");
  assert.equal(ab.scopeMatch, "different");
  assert.equal(ab.verdict, "differs-by-scope");
  const ac = assembled.find((entry) => entry.bId === "c");
  assert.equal(ac.scopeMatch, "same");
  assert.equal(ac.verdict, "consistent");
});
