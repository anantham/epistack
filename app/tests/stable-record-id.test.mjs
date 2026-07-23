import test from "node:test";
import assert from "node:assert/strict";
import { promotedResultSemanticKey } from "../lib/stable-record-id.ts";

const first = {
  sourceId: "pubmed-12345",
  claimFrameId: "claim-a",
  analysisLabel: "Primary analysis",
  analysisType: "intention-to-treat",
  outcome: "Hunger score",
  timeHorizon: "Four hours",
  resultRole: "primary",
  estimate: "-1.2 points",
  exactExcerpt: "The mean hunger score was 1.2 points lower.",
  locator: "Table 2, row Hunger score",
};

test("promoted result identity is semantic rather than array-position based", async () => {
  const id = await promotedResultSemanticKey(first);
  const reorderedRunId = await promotedResultSemanticKey({ ...first });
  assert.equal(id, reorderedRunId);
  assert.match(id, /^[a-f0-9]{20}$/);
});

test("one atomic result keeps one identity when it bears on multiple claims", async () => {
  const firstClaim = await promotedResultSemanticKey(first);
  const secondClaim = await promotedResultSemanticKey({
    ...first,
    claimFrameId: "claim-b",
  });
  assert.equal(firstClaim, secondClaim);
});

test("materially different result records do not share an identity", async () => {
  const id = await promotedResultSemanticKey(first);
  const changed = await promotedResultSemanticKey({
    ...first,
    outcome: "LDL cholesterol",
    exactExcerpt: "LDL cholesterol did not differ between groups.",
  });
  assert.notEqual(id, changed);
});

test("the same words at a materially different source locus stay distinct", async () => {
  const id = await promotedResultSemanticKey(first);
  const changed = await promotedResultSemanticKey({
    ...first,
    locator: "Supplementary Table 9, sensitivity analysis",
  });
  assert.notEqual(id, changed);
});
