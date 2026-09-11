# Epistack Question Compiler

The deployed homepage now runs decomposition through the server-side Lyra Responses adapter. Configure `LYRA_PUBLIC_GATEWAY_URL` and `LYRA_API_KEY` as hosted secrets. Browser requests contain the question, context, and prompt overrides; the Lyra key never enters the browser. Jobs retain three independent specialist stages in D1 and can resume from the browser receipt. `/decompose-live` remains an alternate inspector. Legacy OpenRouter endpoints and the local research companion remain separate.

A browser prototype of an Epistack investigation loop: collaboratively decompose a vague question, ground it in a real stakeholder and action space, compile a typed research brief, direct live evidence agents, and turn only accepted result records into a versioned, reversible decision.

The included evidence case uses the competition prompt about whether eggs are good to eat, while the framing operator can now decompose arbitrary submitted questions.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run agents
```

In a second terminal:

```bash
npm run dev
```

Open the local URL printed by the development server.

`npm run agents` starts a loopback companion on `127.0.0.1:4317`. It requires an installed and authenticated Claude Code CLI. Opus first compiles the edited interpretation map into a durable research brief. Its `/recall` stream runs separate broad-recall and applicability searches, records observable WebSearch/WebFetch invocation metadata, and returns lead-only candidates that cannot bypass evidence ingestion. During ingestion, a fresh Opus process extracts result-level records from preserved PMC full text and a fresh Sonnet process adversarially reviews them. A hosted UI can reach this companion only when its exact origin is explicitly allow-listed with `EPISTACK_ALLOWED_BROWSER_ORIGINS`; arbitrary web origins remain blocked. Override aliases or cost ceilings with `EPISTACK_PRIMARY_CLAUDE_MODEL`, `EPISTACK_ADVERSARY_CLAUDE_MODEL`, `EPISTACK_COMPILER_MAX_USD`, `EPISTACK_RECALL_MAX_USD`, `EPISTACK_PRIMARY_MAX_USD`, and `EPISTACK_ADVERSARY_MAX_USD`.

For decomposition, open the settings icon and paste an OpenRouter API key. The bring-your-own key is cached only in that browser so reloads do not require retyping; it is excluded from case artifacts and the database. You can instead copy `.env.example` to `.env.local` and set `OPENROUTER_API_KEY` for a server-configured connection. Normalized question/context/model/prompt combinations are retained in a bounded multi-entry browser cache and a 30-day shared D1 operation cache. The app checks both caches before it asks for a key; without a key or a reusable hit, decomposition stops with an explicit settings error.

## What to try

1. Watch `epistack` type one character at a time, settle into the top-left corner, and reveal the question composer half a second later.
2. Open the settings icon, add the key, and enter any vague question or paragraph.
3. Answer the AI's one-question-at-a-time context interview. Hover the `?` to see whether an answer prunes scope, creates a branch, or changes evidence matching.
4. The AI recompiles the question using those constraints, visibly parking ruled-out branches and introducing distinctions implied by the real case.
5. Scroll into each cluster. Its related words activate together in the pinned question and fly into the current evidence-contract card while later clusters remain dim.
6. Approve the scope and follow the paced transition to the separate Interpretation Map page.
7. Select any interpretation branch to inspect the model's rationale.
8. Keep a different branch, park one, or edit its meaning.
9. Add an interpretation the model missed and watch the claim template recompile.
10. Route each dimension: claim-driving, applicability-only, monitored unknown, or parked/no-budget.
11. Create an explicitly labeled probability placeholder, then compile the research brief with the local companion.
12. Inspect the generated 3–7 claim portfolio, realistic action space, budget shares, privacy boundary, editable PubMed queries, and constraint-relaxation order.
13. Multi-select the claims worth spending recall tokens on. Launch the broad-recall and applicability specialists, inspect their actual WebSearch/WebFetch invocation metadata, and keep every return explicitly `lead-only`.
14. Run a deterministic PubMed lane, acquire full text, and inspect each atomic result's applicability-distance vector and adversarial verdict.
15. Open the live Artifact to navigate only records that crossed a declared promotion policy, including uncovered claims, exact loci, source hashes, verification, and dependence families.
16. Open the decision workbench. Its specialist reads the accepted D1 graph—not the discovery queue—then cites the exact result and family IDs carrying the action, exposes flip conditions, and persists the decision against an evidence snapshot.
17. Export a private decision bundle or a stripped evidence skeleton for another investigator to extend.

## Current boundary

This is a working vertical slice with schema-validated decomposition, context compilation, broad-recall leads, deterministic PubMed discovery, full-text dual-model review, a persistent accepted graph, and graph-grounded decision synthesis. Decomposition requires an explicit model key; it never silently substitutes a precomputed result. The legacy evidence, matrix, inventory, and discovery pages retain the curated eggs corpus as an inspectable reference case, while `/artifact` and `/synthesis` operate on promoted D1 records for any compiled question.

It currently implements:

- visible AI-proposed branches;
- a timed center-to-corner brand intro before the question input;
- a clean composer with settings and methodological help hidden behind icons and hover tooltips;
- a paced decision-context interview kept distinct from evidence about the claim;
- model-generated, high-information follow-up questions labeled by whether they prune, branch, or improve evidence matching;
- exact-phrase highlighting controlled by the reader's scroll position;
- semantic clustering of non-adjacent cues such as `eat` and `moderation`;
- physical cue-to-cluster motion from a pinned question with a reduced-motion fallback;
- a scroll-led derivation that progressively reveals each inference step;
- a reviewable cues → latent variable → axis → branch trace;
- evidence-ingestion fields, search concepts, and mismatch risks derived from that trace;
- arbitrary-question decomposition through OpenRouter;
- request-scoped OpenRouter credentials that are excluded from saved and exported artifacts;
- an explicit missing-key or provider error instead of a silent fallback;
- human selection, editing, addition, and reversible parking;
- authorship and rationale;
- question compilation;
- four-way human routing of dimensions into claims, applicability checks, monitored gaps, or parked scope;
- a typed, locally persisted `ResearchBrief` containing stakeholder profile, feasible actions, 3–7 prioritized claims, retrieval contracts, relaxation order, gap triggers, and a 100-point research budget;
- dynamic research lanes generated from that brief rather than from the curated eggs fixture;
- two parallel local recall specialists—broad/disconfirming and applicability/transportability—with multi-claim human focus controls, actual CLI tool-event telemetry, and a schema-enforced lead-only boundary;
- privacy-minimized discovery that sends only the editable query and publication filters to PubMed while retaining the full personal context locally;
- probability semantics;
- JSON export;
- D1-backed, chained artifact snapshots;
- a normalized `live-artifact.v1` projection over accepted D1 claim, source, study, analysis, result, relation, and dependence-family records;
- explicit empty, collecting, ready, stale, unavailable, and degraded artifact states rather than fixture substitution;
- stable atomic-result IDs that survive extraction ordering and retain multiple claim-specific relations;
- registration-based cross-publication dependence families when a stable registration is reported, plus explicit unresolved dependency identifiers for reviews and follow-ups;
- a decision synthesizer that validates every cited result, relation, claim, family, and contextualized option, separates human-supplied values from model assumptions, and exposes broad-versus-applicable evidence, cruxes, gaps, and sensitivity;
- automatic decision invalidation and update events whenever accepted evidence changes;
- cached synthesis bound to the evidence version and editable Prompt Lab configuration;
- private and stripped shareable JSON exports;
- a 32-publication controlled-trial inventory;
- result-level decomposition of key sources into studies, analyses, estimates, author interpretations, and typed claim relationships;
- explicit evidence families that prevent multiple endpoints and meta-analyses from masquerading as independent votes;
- a claim × source matrix implemented as a projection over the result ledger rather than the canonical record;
- decision episodes, options, outcomes, protocols, observations, and update events in the persistent schema;
- 11 broader claim-matched source extractions with funding, provenance, limitations, and risk-of-bias fields;
- 164 PubMed discovery records; and
- normalized schema for sources, evidence, assessments, and beliefs.

The interface is organized as a case workspace rather than one long report:

- `/` — submit the question and inspect its ambiguous wording;
- `/map` — edit the generated interpretation map and compile the claim;
- `/research` — direct the generated claim portfolio, retrieval queries, full-text agents, applicability checks, and promotion gate;
- `/artifact` — navigate the live accepted result graph, claim coverage, provenance, dependence, integrity, and staleness;
- `/evidence` — inspect result-level relationships, locators, scope, and dependence inside each source;
- `/matrix` — cross-examine scoped claims against source containers without vote-counting;
- `/inventory` — search and assess the controlled-trial inventory;
- `/discoveries` — screen the unassessed PubMed intake queue; and
- `/synthesis` — synthesize and persist a concrete, reversible decision from the accepted graph and human-compiled action space.

Discovery is intentionally not treated as evidence. For a PubMed record linked to open PMC full text, the local companion saves JATS XML and plain text under `.epistack/sources`, records the source hash, runs specialized extraction and adversarial-review processes, literally checks accepted excerpts against the saved text, and caches the full run by source hash, compiled claims, applicability profile, prompts, question context, and model pair. At promotion time the server independently resolves PMID→PMCID, refetches the public JATS artifact, recomputes its hash, and verifies every accepted excerpt. Only results that pass the declared `dual-model-pmc-full-text-v2` policy enter the accepted graph. Human-checked abstract extractions are persisted as provisional intake records; they cannot satisfy accepted claim coverage or carry a final decision.

“AI cross-checked full text” is deliberately not labeled human-verified. The server now verifies the public artifact and passages, but it does not prove that the model’s methodological judgment is correct. Broad-web discoveries are leads, not evidence, and there is not yet a general acquisition adapter for every non-PubMed source. Registration IDs improve cross-publication grouping, but unresolved dependencies still need a human merge/review operator. The app also does not yet acquire paywalled PDFs, independently reproduce statistical analyses, subscribe to retractions, merge multi-investigator artifacts, or aggregate contributed personal observations.

## Commands

```bash
npm run dev
npm run agents
npm run build
npm test
npm run db:generate
npm run evidence:discover
```

## Main files

- `app/page.tsx` — animated phrase-highlighting and transition flow
- `app/map/page.tsx` — editable interpretation map and claim compilation
- `lib/research-brief.ts` — Stage 2→3 contract, role routing, claim portfolio schema, budget normalization, and dynamic lanes
- `app/research/research-dashboard.tsx` — generated investigation cockpit and local-agent control surface
- `lib/broad-recall.ts` — lead-only recall, applicability, and observable tool-trace contracts
- `app/api/decompose/route.ts` — AI SDK structured decomposition endpoint
- `scripts/local-claude-agents.mjs` — local PMC acquisition, two-process Claude orchestration, cache, and passage checks
- `lib/dual-review.ts` — adversarial-review contracts and deterministic promotion policy
- `lib/decomposition-server.ts` — schema, elicitation method prompt, sanitization, and test fixture fallback
- `app/components/case-navigation.tsx` — persistent stage and evidence-view navigation
- `app/api/artifact/route.ts` and `lib/live-artifact-store.ts` — canonical accepted-graph read boundary
- `app/artifact/` — arbitrary-question live artifact navigator
- `app/api/synthesize/route.ts` and `lib/decision-synthesis.ts` — reference-checked, cached, persisted decision synthesis
- `app/evidence/` — deep source review
- `app/matrix/` — result-level claim × source projection
- `app/inventory/` — controlled-trial assessment
- `app/discoveries/` — unassessed search intake
- `app/synthesis/` — live decision episode, cruxes, stability, gaps, protocol, and export
- `app/globals.css` — responsive interface
- `app/api/cases/route.ts` — save and retrieve snapshots
- `data/eggs-weight-corpus.ts` — assessed sources and 32-study review inventory
- `data/eggs-result-ledger.ts` — scoped claims, atomic results, typed relations, and evidence families
- `data/pubmed-discovery.json` — reproducible discovery output
- `scripts/discover-pubmed.mjs` — PubMed discovery collector
- `db/schema.ts` — relational epistemic artifact model
- `drizzle/` — generated database migrations
