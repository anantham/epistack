# Epistack Question Compiler

A browser prototype of the first Epistack operator: collaborative decomposition of a vague question into a human-approved, probabilistically assessable claim.

The included evidence case uses the competition prompt about whether eggs are good to eat, while the framing operator can now decompose arbitrary submitted questions.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

For model-backed decomposition, copy `.env.example` to `.env.local` and set `OPENAI_API_KEY`. Without it, the app uses a clearly labeled domain-general local fallback so the interaction and artifact remain testable.

## What to try

1. Enter any vague research question or paragraph.
2. Watch the compiler highlight exact phrases and explain which hidden choice each phrase carries.
3. Follow the paced transition to the separate Interpretation Map page.
4. Select any interpretation branch to inspect the model's rationale.
5. Keep a different branch, park one, or edit its meaning.
6. Add an interpretation the model missed and watch the claim template recompile.
7. Create an explicitly labeled probability placeholder.
8. For the eggs fixture, continue to Evidence and inspect the existing claim-matched corpus.
9. Use Assess for the 32-study inventory and the Discovery Queue for unassessed matches.
10. Open Synthesize to inspect the provisional read, load-bearing evidence, and cruxes.
11. Save a revision or export the complete framing artifact as JSON.

## Current boundary

This is a UX and data-model slice with an AI SDK decomposition endpoint and a real eggs evidence corpus. The endpoint uses schema-validated structured output and falls back transparently when no model key is configured. The evidence pages use a 2023 systematic review as their study spine, add claim-matched deep extractions, and record a reproducible PubMed discovery search.

It currently implements:

- visible AI-proposed branches;
- exact-phrase highlighting before map generation;
- arbitrary-question decomposition through the AI SDK;
- a domain-general local fallback with an explicit warning;
- human selection, editing, addition, and reversible parking;
- authorship and rationale;
- question compilation;
- probability semantics;
- JSON export;
- D1-backed artifact snapshots;
- a 32-publication controlled-trial inventory;
- 11 claim-matched source extractions with funding, provenance, limitations, and risk-of-bias fields;
- 164 PubMed discovery records; and
- normalized schema for sources, evidence, assessments, and beliefs.

The interface is organized as a case workspace rather than one long report:

- `/` — submit the question and inspect its ambiguous wording;
- `/map` — edit the generated interpretation map and compile the claim;
- `/evidence` — inspect claim-matched deep source extractions;
- `/inventory` — search and assess the controlled-trial inventory;
- `/discoveries` — screen the unassessed PubMed intake queue; and
- `/synthesis` — audit the provisional conclusion and its cruxes.

Discovery is intentionally not treated as evidence. The app does not yet automatically verify full text, extract passages, perform entailment checks, independently reproduce the meta-analysis, or update the claim probability. Those steps require model assistance plus human review.

## Commands

```bash
npm run dev
npm run build
npm test
npm run db:generate
npm run evidence:discover
```

## Main files

- `app/page.tsx` — animated phrase-highlighting and transition flow
- `app/map/page.tsx` — editable interpretation map and claim compilation
- `app/api/decompose/route.ts` — AI SDK structured decomposition endpoint
- `lib/decomposition-server.ts` — schema, method prompt, sanitization, and transparent fallback
- `app/components/case-navigation.tsx` — persistent stage and evidence-view navigation
- `app/evidence/` — deep source review
- `app/inventory/` — controlled-trial assessment
- `app/discoveries/` — unassessed search intake
- `app/synthesis/` — provisional synthesis and cruxes
- `app/globals.css` — responsive interface
- `app/api/cases/route.ts` — save and retrieve snapshots
- `data/eggs-weight-corpus.ts` — assessed sources and 32-study review inventory
- `data/pubmed-discovery.json` — reproducible discovery output
- `scripts/discover-pubmed.mjs` — PubMed discovery collector
- `db/schema.ts` — relational epistemic artifact model
- `drizzle/` — generated database migrations
