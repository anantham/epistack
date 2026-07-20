# Epistack Question Compiler

A browser prototype of the first Epistack operator: collaborative decomposition of a vague question into a human-approved, probabilistically assessable claim.

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

`npm run agents` starts a localhost-only companion on `127.0.0.1:4317`. It requires an installed and authenticated Claude Code CLI. By default, a fresh `claude -p` Opus process extracts result-level records from preserved PMC full text and a fresh Sonnet process adversarially reviews them. Override the aliases or cost ceilings with `EPISTACK_PRIMARY_CLAUDE_MODEL`, `EPISTACK_ADVERSARY_CLAUDE_MODEL`, `EPISTACK_PRIMARY_MAX_USD`, and `EPISTACK_ADVERSARY_MAX_USD`.

For decomposition, open the settings icon and paste an OpenRouter API key. It is sent through Epistack for the request and is never written to browser storage, the case artifact, or the database. You can also copy `.env.example` to `.env.local` and set `OPENROUTER_API_KEY` for a server-configured connection. Without a key, decomposition stops with an explicit settings error.

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
10. Create an explicitly labeled probability placeholder.
11. For the eggs fixture, continue to Evidence and inspect atomic results inside each source.
12. Open the Claim Matrix to cross-examine scoped claims without treating multiple endpoints as independent votes.
13. Use Assess for the 32-study inventory and the Discovery Queue for unassessed matches.
14. Open Decide to inspect the conditional policy, outcome coverage, next information, and draft observation protocol.
15. Save a revision or export the complete framing artifact as JSON.

## Current boundary

This is a UX and data-model slice with a schema-validated decomposition endpoint and a real eggs evidence corpus. Decomposition requires an explicit model key; it never silently substitutes a precomputed result. The evidence pages use a 2023 systematic review as their study spine, add claim-matched deep extractions, and record a reproducible PubMed discovery search.

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
- probability semantics;
- JSON export;
- D1-backed artifact snapshots;
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
- `/evidence` — inspect result-level relationships, locators, scope, and dependence inside each source;
- `/matrix` — cross-examine scoped claims against source containers without vote-counting;
- `/inventory` — search and assess the controlled-trial inventory;
- `/discoveries` — screen the unassessed PubMed intake queue; and
- `/synthesis` — use the evidence graph for a concrete, reversible decision and measurement plan.

Discovery is intentionally not treated as evidence. For a PubMed record linked to open PMC full text, the local companion saves JATS XML and plain text under `.epistack/sources`, records the source hash, runs specialized extraction and adversarial-review processes, literally checks accepted excerpts against the saved text, and caches the full run by source hash, prompts, question context, and model pair. Only results that pass the declared `dual-model-pmc-full-text-v1` policy are auto-promoted; rejected proposals remain in the review snapshot. Abstract-only extraction is an explicit fallback and still requires human promotion.

“AI cross-checked full text” is deliberately not labeled human-verified. The current local trust boundary assumes the browser, companion, and app server belong to one investigator; the companion payload is not yet cryptographically signed against a malicious local client. The app also does not yet acquire paywalled PDFs, independently reproduce statistical analyses, subscribe to retractions, or aggregate contributed personal observations.

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
- `app/api/decompose/route.ts` — AI SDK structured decomposition endpoint
- `scripts/local-claude-agents.mjs` — local PMC acquisition, two-process Claude orchestration, cache, and passage checks
- `lib/dual-review.ts` — adversarial-review contracts and deterministic promotion policy
- `lib/decomposition-server.ts` — schema, elicitation method prompt, sanitization, and test fixture fallback
- `app/components/case-navigation.tsx` — persistent stage and evidence-view navigation
- `app/evidence/` — deep source review
- `app/matrix/` — result-level claim × source projection
- `app/inventory/` — controlled-trial assessment
- `app/discoveries/` — unassessed search intake
- `app/synthesis/` — provisional synthesis and cruxes
- `app/globals.css` — responsive interface
- `app/api/cases/route.ts` — save and retrieve snapshots
- `data/eggs-weight-corpus.ts` — assessed sources and 32-study review inventory
- `data/eggs-result-ledger.ts` — scoped claims, atomic results, typed relations, and evidence families
- `data/pubmed-discovery.json` — reproducible discovery output
- `scripts/discover-pubmed.mjs` — PubMed discovery collector
- `db/schema.ts` — relational epistemic artifact model
- `drizzle/` — generated database migrations
