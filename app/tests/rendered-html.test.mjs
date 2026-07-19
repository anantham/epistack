import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("build emits the Epistack application", async () => {
  await access(new URL("dist/server/index.js", root));
  await access(new URL("dist/client", root));
});

test("question compiler stages AI reading before the editable map", async () => {
  const [frame, map, api, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/map/page.tsx", root), "utf8"),
    readFile(new URL("app/api/decompose/route.ts", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(frame, /Let the AI show you what your question is hiding\./);
  assert.match(frame, /locateHighlights/);
  assert.match(frame, /AI is reading/);
  assert.match(frame, /Decomposition trace/);
  assert.match(frame, /exact language/);
  assert.match(frame, /Hidden variable/);
  assert.match(frame, /Evidence contract/);
  assert.match(frame, /semantic clusters/);
  assert.match(frame, /question-cue/);
  assert.match(frame, /Inference chain/);
  assert.match(frame, /Next inference/);
  assert.match(frame, /activeTraceStep/);
  assert.match(frame, /window\.location\.assign\("\/map"\)/);
  assert.match(map, /Interpretation map/);
  assert.match(map, /decompositionTrace/);
  assert.match(map, /axis-trace/);
  assert.match(map, /Keep as active/);
  assert.match(map, /Park branch/);
  assert.match(map, /Add a missing interpretation/);
  assert.match(map, /Create probabilistic claim/);
  assert.match(map, /analysis-neutral placeholder/);
  assert.match(map, /interpretation branches above do not share this probability mass/i);
  assert.match(api, /generateText/);
  assert.match(api, /Output\.object/);
  assert.match(api, /gpt-5\.6-terra/);
  assert.match(packageJson, /"ai"/);
  assert.match(packageJson, /"@ai-sdk\/openai"/);
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
  const [evidencePage, evidenceBrowser, synthesisPage, discoveryPage, corpus, discovery] = await Promise.all([
    readFile(new URL("app/evidence/page.tsx", root), "utf8"),
    readFile(new URL("app/evidence/evidence-browser.tsx", root), "utf8"),
    readFile(new URL("app/synthesis/page.tsx", root), "utf8"),
    readFile(new URL("app/discoveries/page.tsx", root), "utf8"),
    readFile(new URL("data/eggs-weight-corpus.ts", root), "utf8"),
    readFile(new URL("data/pubmed-discovery.json", root), "utf8"),
  ]);
  const discoveryArtifact = JSON.parse(discovery);
  const inventoryRows = corpus.match(/^  study\(/gm) ?? [];

  assert.equal(inventoryRows.length, 32);
  assert.equal(discoveryArtifact.recordsFetched, 164);
  assert.equal(discoveryArtifact.records.length, discoveryArtifact.recordsFetched);
  assert.match(discoveryArtifact.evidencePolicy, /Discovery is not evidence/);
  assert.match(evidencePage, /Inspect the evidence, one source at a time/);
  assert.match(evidenceBrowser, /Inspect quality and provenance/);
  assert.match(synthesisPage, /Load-bearing evidence/);
  assert.match(synthesisPage, /What would change the answer\?/);
  assert.match(discoveryPage, /Keep discovery separate from evidence/);
});

test("the investigation is split into focused navigable routes", async () => {
  const [frame, map, navigation, inventory, discoveries, synthesis] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/map/page.tsx", root), "utf8"),
    readFile(new URL("app/components/case-navigation.tsx", root), "utf8"),
    readFile(new URL("app/inventory/page.tsx", root), "utf8"),
    readFile(new URL("app/discoveries/page.tsx", root), "utf8"),
    readFile(new URL("app/synthesis/page.tsx", root), "utf8"),
  ]);

  assert.doesNotMatch(frame, /className="evidence-section"/);
  assert.doesNotMatch(frame, /className="map-section"/);
  assert.match(map, /decompositionSessionKey/);
  assert.match(map, /claimTemplate/);
  assert.match(navigation, /href: "\/evidence"/);
  assert.match(navigation, /href: "\/inventory"/);
  assert.match(navigation, /href: "\/synthesis"/);
  assert.match(inventory, /controlled-trial records/);
  assert.match(discoveries, /Evidence intake/);
  assert.match(synthesis, /Provisional synthesis/);
});

test("arbitrary questions have a transparent domain-general fallback", async () => {
  const [server, api, envExample] = await Promise.all([
    readFile(new URL("lib/decomposition-server.ts", root), "utf8"),
    readFile(new URL("app/api/decompose/route.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);

  assert.match(server, /createFallbackDecomposition/);
  assert.match(server, /Branches are alternative scopes/);
  assert.match(server, /exact, case-sensitive substring/);
  assert.match(server, /"eat", "moderation"/);
  assert.match(server, /Dose and frequency/);
  assert.match(server, /ingestionRequirements/);
  assert.match(server, /mismatchRisks/);
  assert.match(server, /concise audit trace, not private chain-of-thought/);
  assert.match(api, /mode: "local-fallback"/);
  assert.match(api, /OPENAI_API_KEY/);
  assert.match(envExample, /EPISTACK_DECOMPOSITION_MODEL=gpt-5\.6-terra/);
});
