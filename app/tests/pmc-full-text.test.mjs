import assert from "node:assert/strict";
import test from "node:test";
import { bioCToPlainText, jatsToPlainText } from "../lib/pmc-full-text.ts";

test("PMC BioC passages become readable full text without inventing content", () => {
  const payload = [{
    source: "PMC",
    documents: [{
      passages: [
        { infons: { type: "title_1" }, text: "Egg consumption and health" },
        { infons: { section: "INTRO" }, text: "The study compared two breakfast patterns." },
      ],
    }],
  }];
  assert.equal(
    bioCToPlainText(payload),
    "Egg consumption and health\n\nThe study compared two breakfast patterns.",
  );
});

test("PMC JATS and BioC artifacts use the same plain-text passage contract", () => {
  assert.equal(jatsToPlainText("<article><sec><title>Results</title><p>A &amp; B</p></sec></article>"), "Results\n\nA & B");
  assert.equal(bioCToPlainText([{ documents: [{ passages: [{ text: "Results" }, { text: "A & B" }] }] }]), "Results\n\nA & B");
});
