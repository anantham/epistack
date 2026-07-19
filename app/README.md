# Epistack Question Compiler

A browser prototype of the first Epistack operator: collaborative decomposition of a vague question into a human-approved, probabilistically assessable claim.

The included case uses the competition prompt about whether eggs are good to eat and narrows it to one question about weight loss.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

## What to try

1. Decompose the starting eggs paragraph.
2. Select any interpretation branch to inspect the model's rationale.
3. Keep a different branch, park one, or edit its meaning.
4. Add an interpretation the model missed.
5. Watch the concrete question update from the selected path.
6. Create an explicitly labeled probability placeholder.
7. Continue to the dedicated Evidence page and filter deep source extractions by relationship to the claim.
8. Expand a source to inspect funding, risk of bias, provenance, and limitations.
9. Use the separate Assess page for the complete 32-study trial inventory.
10. Screen the 164-record Discovery Queue without confusing search matches for assessed evidence.
11. Open Synthesize to inspect the provisional read, load-bearing evidence, and cruxes.
12. Save a revision or export the complete framing artifact as JSON.

## Current boundary

This is a UX and data-model slice with a real evidence corpus. Question decomposition remains a deterministic offline fixture. The evidence section uses a 2023 systematic review as its study spine, adds claim-matched deep extractions, and records a reproducible PubMed discovery search.

It currently implements:

- visible AI-proposed branches;
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

- `/` — frame and compile the question;
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

- `app/page.tsx` — framing interaction and eggs fixture
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
