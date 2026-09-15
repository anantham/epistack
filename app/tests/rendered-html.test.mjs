import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("build emits the Epistack application", async () => {
  await access(new URL("dist/server/index.js", root));
  await access(new URL("dist/client", root));
});

test("question compiler stages AI reading before the editable map", async () => {
  const [frame, styles, map, api, promptRegistry, packageJson, decomposeRoute, navigation] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/map/page.tsx", root), "utf8"),
    readFile(new URL("app/api/decompose/route.ts", root), "utf8"),
    readFile(new URL("lib/agent-prompts.ts", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("app/decompose/page.tsx", root), "utf8"),
    readFile(new URL("app/components/case-navigation.tsx", root), "utf8"),
  ]);

  assert.doesNotMatch(styles, /\.intro-surface\s*\{[^}]*visibility:\s*hidden/);
  assert.doesNotMatch(frame, /aria-hidden=\{!introComplete\}/);
  assert.doesNotMatch(styles, /font-size 1700ms/);
  assert.doesNotMatch(styles, /left 1700ms/);
  assert.doesNotMatch(styles, /@keyframes brand-arrive/);
  assert.doesNotMatch(map, /Compile another question/);
  assert.match(api, /generateText/);
  assert.match(api, /Output\.object/);
  assert.match(api, /dimensionScoutOutputSchema/);
  assert.match(api, /traceAgentOutputSchema/);
  assert.match(api, /contextAgentOutputSchema/);
  assert.match(api, /Promise\.allSettled/);
  assert.match(api, /assembleDecomposition/);
  assert.match(api, /decompositionSchema\.safeParse/);
  assert.match(api, /https:\/\/openrouter\.ai\/api\/v1/);
  assert.match(api, /OpenRouter ·/);
  assert.match(api, /openRouterFailureFromThrown/);
  assert.match(api, /openRouterProvenance/);
  assert.match(api, /specialistFailureReason/);
  assert.match(frame, /Decomposition provider and model provenance/);
  assert.match(frame, /searchParams\.get\("resume"\) === "1"/);
  assert.match(frame, /The root route is the question composer/);
  assert.match(decomposeRoute, /export \{ default \} from "\.\.\/page"/);
  assert.match(navigation, /href: "\/decompose"/);
  assert.match(api, /anthropic\/claude-opus-4\.8/);
  assert.match(promptRegistry, /maxOutputTokens: 5000/);
  assert.match(promptRegistry, /maxOutputTokens: 3500/);
  assert.match(promptRegistry, /maxOutputTokens: 6500/);
  assert.match(api, /for \(let attempt = 0; attempt < 2 && !scout; attempt \+= 1\)/);
  assert.match(promptRegistry, /REPAIR: Return every required field/);
  assert.match(api, /status: 401/);
  assert.match(api, /mode: "local-fallback"/);
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
  assert.match(layout, /template: "%s · Epistack"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("evidence corpus keeps discovery separate and decomposes sources into results", async () => {
  const [evidencePage, evidenceBrowser, matrixPage, synthesisPage, discoveryPage, corpus, ledger, discovery] = await Promise.all([
    readFile(new URL("app/evidence/page.tsx", root), "utf8"),
    readFile(new URL("app/evidence/evidence-browser.tsx", root), "utf8"),
    readFile(new URL("app/matrix/page.tsx", root), "utf8"),
    readFile(new URL("app/synthesis/page.tsx", root), "utf8"),
    readFile(new URL("app/discoveries/page.tsx", root), "utf8"),
    readFile(new URL("data/eggs-weight-corpus.ts", root), "utf8"),
    readFile(new URL("data/eggs-result-ledger.ts", root), "utf8"),
    readFile(new URL("data/pubmed-discovery.json", root), "utf8"),
  ]);
  const discoveryArtifact = JSON.parse(discovery);
  const inventoryRows = corpus.match(/^  study\(/gm) ?? [];

  assert.equal(inventoryRows.length, 32);
  assert.equal(discoveryArtifact.recordsFetched, 164);
  assert.equal(discoveryArtifact.records.length, discoveryArtifact.recordsFetched);
  assert.match(discoveryArtifact.evidencePolicy, /Discovery is not evidence/);
  assert.match(evidencePage, /A paper can disagree with itself/);
  assert.match(evidenceBrowser, /Source → study → analysis → result → claim relationship/);
  assert.match(evidenceBrowser, /Grouped, not another vote/);
  assert.match(matrixPage, /Do not count marks as votes/);
  assert.match(matrixPage, /Independence register/);
  assert.match(ledger, /sourceRelationshipSummary/);
  assert.match(ledger, /vander-wal-free-living-weight/);
  assert.match(ledger, /keogh-within-arm-loss/);
  assert.match(ledger, /emrani-heterogeneity/);
  assert.match(synthesisPage, /DecisionWorkbench/);
  assert.match(synthesisPage, /Highest-value next information/);
  assert.match(synthesisPage, /Versioned accepted evidence/);
  assert.match(synthesisPage, /human-compiled action space/);
  assert.match(discoveryPage, /Keep discovery separate from evidence/);
});

test("the investigation is split into focused navigable routes", async () => {
  const [frame, map, navigation, research, matrix, inventory, discoveries, synthesis] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/map/page.tsx", root), "utf8"),
    readFile(new URL("app/components/case-navigation.tsx", root), "utf8"),
    readFile(new URL("app/research/page.tsx", root), "utf8"),
    readFile(new URL("app/matrix/page.tsx", root), "utf8"),
    readFile(new URL("app/inventory/page.tsx", root), "utf8"),
    readFile(new URL("app/discoveries/page.tsx", root), "utf8"),
    readFile(new URL("app/synthesis/page.tsx", root), "utf8"),
  ]);

  assert.match(navigation, /href: "\/research"/);
  assert.match(navigation, /href: "\/evidence"/);
  assert.match(navigation, /href: "\/matrix"/);
  assert.match(navigation, /href: "\/inventory"/);
  assert.match(navigation, /Decompose · dimensions/);
  assert.match(navigation, /className="stage-home"/);
  assert.match(navigation, /onHome\?: \(\) => void/);
  assert.match(navigation, /Contextualize · action space/);
  assert.match(navigation, /Investigate · agents & ingestion/);
  assert.match(navigation, /href: "\/artifact"/);
  assert.match(navigation, /Artifact · live accepted evidence/);
  assert.doesNotMatch(navigation, /Stage 5/);
  assert.match(navigation, /stage-tooltip/);
  assert.match(navigation, /aria-label={`Stage \${index \+ 1}: \${stage\.label}`}/);
  assert.doesNotMatch(navigation, /className="wordmark"/);
  assert.doesNotMatch(navigation, /Discovery queue<\/Link>/);
  assert.match(research, /ResearchDashboard/);
  assert.match(inventory, /controlled-trial records/);
  assert.match(matrix, /Claim matrix|Cross-examine claims/);
  assert.match(discoveries, /Evidence intake/);
  assert.match(synthesis, /Decision episode/);
});

test("persistent schema separates documents, studies, analyses, results, and decisions", async () => {
  const schema = await readFile(new URL("db/schema.ts", root), "utf8");
  assert.match(schema, /export const claimFrames/);
  assert.match(schema, /export const studies/);
  assert.match(schema, /export const analyses/);
  assert.match(schema, /export const resultRecords/);
  assert.match(schema, /export const evidenceRelations/);
  assert.match(schema, /export const dependenceGroups/);
  assert.match(schema, /export const decisionEpisodes/);
  assert.match(schema, /export const protocols/);
  assert.match(schema, /export const observations/);
  assert.match(schema, /export const updateEvents/);
});

test("arbitrary questions use hosted elicitation while legacy provider access remains explicit", async () => {
  const [frame, server, api, envExample] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/decomposition-server.ts", root), "utf8"),
    readFile(new URL("app/api/decompose/route.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);

  assert.match(api, /OPENROUTER_API_KEY/);
  assert.match(api, /EPISTACK_OPENROUTER_MODEL/);
  assert.match(envExample, /EPISTACK_OPENROUTER_MODEL=anthropic\/claude-opus-4\.8/);
  assert.doesNotMatch(envExample, /OPENAI_API_KEY/);
});

test("brief compilation keeps a fast OpenRouter model available when the primary times out", async () => {
  const [route, map] = await Promise.all([
    readFile(new URL("app/api/compile-brief/route.ts", root), "utf8"),
    readFile(new URL("app/map/page.tsx", root), "utf8"),
  ]);
  assert.match(route, /const primaryModelId = config\.EPISTACK_OPENROUTER_MODEL/);
  assert.match(route, /const repairModelId = config\.EPISTACK_OPENROUTER_REPAIR_MODEL/);
  assert.match(route, /for \(const modelId of modelIds\)/);
  assert.match(route, /AbortSignal\.timeout\(30000\)/);
  assert.match(map, /function backToInterview\(\) \{\s*window\.localStorage\.removeItem\(briefCompileStorageKey\);/);
});

test("hosted investigation and recall survive an Astra outage with strict provider labels", async () => {
  const [investigate, recall, dashboard] = await Promise.all([
    readFile(new URL("app/api/investigate/route.ts", root), "utf8"),
    readFile(new URL("app/api/recall/route.ts", root), "utf8"),
    readFile(new URL("app/research/research-dashboard.tsx", root), "utf8"),
  ]);
  assert.match(investigate, /runOpenRouterStructured/);
  assert.match(investigate, /type: "json_schema"/);
  assert.match(investigate, /type: "json_object"/);
  assert.match(investigate, /normalizeInvestigationJson/);
  assert.match(investigate, /OpenRouter · \$\{openRouterModel\(role, roleModels\)\}/);
  assert.match(investigate, /role !== "repair" && lyraConfigured\(\)/);
  assert.match(investigate, /AbortSignal\.timeout\(reasoning === "none" \? 60_000 : 120_000\)/);
  assert.match(investigate, /hostedTextCap = 32_000/);
  assert.match(investigate, /runChunkedExtraction/);
  assert.match(investigate, /runChunkedReview/);
  assert.match(investigate, /planChunkedPrompts/);
  assert.match(investigate, /extractor timeout fallback/);
  assert.match(investigate, /repairInstruction\(fullPaperExtractionSchema, issues\)/);
  assert.match(investigate, /maxRepairs: 2/);
  assert.match(recall, /parseStructuredWithRepair/);
  assert.match(recall, /openRouterJson/);
  assert.match(dashboard, /Hosted evidence backend/);
  assert.doesNotMatch(dashboard, /Local Claude companion/);
});

test("hosted recall accepts a useful partial lane result", async () => {
  const [schema, route] = await Promise.all([
    readFile(new URL("lib/broad-recall.ts", root), "utf8"),
    readFile(new URL("app/api/recall/route.ts", root), "utf8"),
  ]);
  assert.match(schema, /lanes: z\.array\(recallLaneResultSchema\)\.min\(1\)/);
  assert.match(route, /Promise\.allSettled\(tasks\)/);
});

test("settings validate the key, credits, and model with distinct failures", async () => {
  const [frame, validation, failures, api] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/openrouter/validate/route.ts", root), "utf8"),
    readFile(new URL("lib/openrouter-errors.ts", root), "utf8"),
    readFile(new URL("app/api/decompose/route.ts", root), "utf8"),
  ]);

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

test("device-local settings and investigation state survive reloads", async () => {
  const [frame, map] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/map/page.tsx", root), "utf8"),
  ]);

});
