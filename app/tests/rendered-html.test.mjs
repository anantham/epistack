import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("build emits the Epistack application", async () => {
  await access(new URL("dist/server/index.js", root));
  await access(new URL("dist/client", root));
});

test("question compiler preserves the human review interactions", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /Turn a vague question into something evidence can answer\./);
  assert.match(page, /Decompose question/);
  assert.match(page, /Interpretation map/);
  assert.match(page, /Keep as active/);
  assert.match(page, /Park branch/);
  assert.match(page, /Add a missing interpretation/);
  assert.match(page, /Create probabilistic claim/);
  assert.match(page, /analysis-neutral placeholder/);
  assert.match(page, /interpretation branches above do not share this probability mass/i);
});

test("starter preview has been removed", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.doesNotMatch(page, /SkeletonPreview|codex-preview|Your site is taking shape/);
  assert.match(layout, /Epistack · Question Compiler/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("evidence corpus keeps discovery separate from assessed evidence", async () => {
  const [page, corpus, discovery] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("data/eggs-weight-corpus.ts", root), "utf8"),
    readFile(new URL("data/pubmed-discovery.json", root), "utf8"),
  ]);
  const discoveryArtifact = JSON.parse(discovery);
  const inventoryRows = corpus.match(/^  study\(/gm) ?? [];

  assert.equal(inventoryRows.length, 32);
  assert.equal(discoveryArtifact.recordsFetched, 164);
  assert.equal(discoveryArtifact.records.length, discoveryArtifact.recordsFetched);
  assert.match(discoveryArtifact.evidencePolicy, /Discovery is not evidence/);
  assert.match(page, /Load-bearing evidence/);
  assert.match(page, /Inspect quality and provenance/);
  assert.match(page, /What would change the answer\?/);
});
