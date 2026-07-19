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

  assert.doesNotMatch(frame, /Let the AI show you what your question is hiding\./);
  assert.doesNotMatch(frame, /Question compiler · AI-assisted framing/);
  assert.doesNotMatch(frame, /Starting question/);
  assert.doesNotMatch(frame, /OpenRouter · bring your key/);
  assert.match(frame, /locateHighlights/);
  assert.match(frame, /Decomposition/);
  assert.match(frame, /Exact language/);
  assert.match(frame, /Hidden variable/);
  assert.match(frame, /Evidence contract/);
  assert.match(frame, /semantic clusters/);
  assert.match(frame, /Inference chain/);
  assert.match(frame, /animateStoryClusterFlight/);
  assert.match(frame, /flying-cue/);
  assert.match(frame, /brand-intro/);
  assert.match(frame, /brandCharacters/);
  assert.match(frame, /3300/);
  assert.match(frame, /placeholder="what is your question\?"/);
  assert.match(frame, /settings-trigger/);
  assert.match(frame, /data-tooltip="Settings"/);
  assert.match(frame, /question-composer/);
  assert.match(frame, /composer-submit/);
  assert.match(frame, /decompose-icon/);
  assert.match(frame, /phase === "eliciting"/);
  assert.match(frame, /currentContextQuestion/);
  assert.match(frame, /advanceElicitation/);
  assert.match(frame, /revealedClusters/);
  assert.match(frame, /Scroll slowly to reveal the inference chain/);
  assert.match(frame, /story-step/);
  assert.match(frame, /IntersectionObserver/);
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
  assert.match(api, /decompositionOutputSchema/);
  assert.match(api, /decompositionSchema\.safeParse/);
  assert.match(api, /https:\/\/openrouter\.ai\/api\/v1/);
  assert.match(api, /OpenRouter ·/);
  assert.match(api, /openRouterFailureFromThrown/);
  assert.match(api, /Add an OpenRouter key in Settings/);
  assert.match(api, /status: 401/);
  assert.doesNotMatch(api, /mode: "local-fallback"/);
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
  assert.match(navigation, /stage-tooltip/);
  assert.match(navigation, /aria-label={`Stage \${index \+ 1}: \${stage\.label}`}/);
  assert.doesNotMatch(navigation, /className="wordmark"/);
  assert.doesNotMatch(navigation, /Discovery queue<\/Link>/);
  assert.match(inventory, /controlled-trial records/);
  assert.match(discoveries, /Evidence intake/);
  assert.match(synthesis, /Provisional synthesis/);
});

test("arbitrary questions use a key-gated elicitation and refinement path", async () => {
  const [frame, server, api, envExample] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
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
  assert.match(server, /contextQuestions/);
  assert.match(server, /prune/);
  assert.match(server, /feasible comparator/);
  assert.match(server, /park branches the context rules out/i);
  assert.match(server, /Preserve legitimate expansion as well as pruning/);
  assert.match(server, /OPTIONS ARE BUNDLES/);
  assert.match(server, /CONSTRAINT CASCADE/);
  assert.match(server, /legal or regulatory regime/);
  assert.match(server, /value of information/i);
  assert.match(server, /rent-home and the buy-home/i);
  assert.match(server, /switch careers into software engineering/i);
  assert.match(server, /build more nuclear power plants/i);
  assert.match(frame, /Context interview/);
  assert.match(frame, /type your answer/);
  assert.match(frame, /currentContextQuestion\.options\.map/);
  assert.match(frame, /loadingSteps/);
  assert.match(frame, /analysisDurationsKey/);
  assert.match(frame, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(frame, /composerInputRef/);
  assert.match(frame, /refineWithContext/);
  assert.match(frame, /decisionContext: contextForRequest/);
  assert.match(frame, /Add an OpenRouter key in Settings/);
  assert.match(frame, /aria-label="Model settings"/);
  assert.match(frame, /aria-label="Key privacy"/);
  assert.match(frame, /openRouterApiKey: openRouterKey\.trim\(\)/);
  assert.match(frame, /openRouterModel: openRouterModel\.trim\(\)/);
  assert.doesNotMatch(frame, /sessionStorage\.setItem\([^\n]*openRouterKey/);
  assert.match(api, /OPENROUTER_API_KEY/);
  assert.match(api, /EPISTACK_OPENROUTER_MODEL/);
  assert.match(envExample, /EPISTACK_OPENROUTER_MODEL=anthropic\/claude-sonnet-4\.6/);
  assert.doesNotMatch(envExample, /OPENAI_API_KEY/);
});

test("settings validate the key, credits, and model with distinct failures", async () => {
  const [frame, validation, failures, api] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/openrouter/validate/route.ts", root), "utf8"),
    readFile(new URL("lib/openrouter-errors.ts", root), "utf8"),
    readFile(new URL("app/api/decompose/route.ts", root), "utf8"),
  ]);

  assert.match(frame, /validateConnection/);
  assert.match(frame, /onSubmit/);
  assert.match(frame, /Press Enter to validate/);
  assert.match(frame, /Checking key, credits, and model/);
  assert.match(frame, /connection-status/);
  assert.match(validation, /openrouter\.ai\/api\/v1/);
  assert.match(validation, /\/key/);
  assert.match(validation, /\/model\//);
  assert.match(failures, /That API key is invalid, disabled, or revoked/);
  assert.match(failures, /insufficient credits/);
  assert.match(failures, /model ID is not available/);
  assert.match(failures, /rate-limiting/);
  assert.match(failures, /provider_name/);
  assert.match(failures, /providerMessage/);
  assert.match(failures, /without a specific reason/);
  assert.doesNotMatch(failures, /message: rawMessage \|\|/);
  assert.match(api, /X-OpenRouter-Metadata/);
});
