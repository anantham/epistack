# Epistack work queue

This is the durable queue for requests that span code, documentation, deployment, and live verification. A checked item means the source or environment was verified; a deployment item is not complete until the live site was checked.

## Now

- [x] **Provider provenance in the decomposition header.** The response contract now carries stage-level provider/model/status data and safe failure reasons; the homepage and inspector render it instead of the old hard-coded Astra label.
- [x] **Root reload returns to the composer.** `/` keeps the saved question editable after a normal refresh; saved decomposition results require an explicit `?resume=1` request.
- [x] **Back up and integrate the current source work.** Canonical `main` is pushed to GitHub, including the explicit `/decompose` route and research budget/model settings. The last verified Sites release is version 81; the newer source still needs to be published.
- [x] **Live deployment smoke verification.** On 2026-09-14, `/`, `/map`, and `/research` returned 200. The deployed homepage showed `OpenRouter · deepseek/deepseek-v4.1-flash`; no loopback reference appeared in the rendered runtime. Console warnings were limited to a browser wallet extension; no site error was observed.
- [ ] **Fresh browser E2E after release.** Submit the eggs question from a clean case and verify Decompose → Contextualize → brief → Research → Artifact, including Settings health and the hosted fallback path.
- [ ] **Ready for review (Claude, branch `feat/investigate-claim-steering` at `c39fcbf`, based on `3a47985`): claim-card steering on Investigate.** One card per claim with Keep/Park, hunt direction (Support/Disconfirm/Either), and per-claim effort (Thorough for the top-priority claim, Standard for the rest). Interview answers appear as chips switchable between Search, Fit only, and Ignore; defaults follow the brief's routing, typed answers never default to Search, and answers matching local-only facts or identifier patterns can never be searched. The query stays editable, with an explicit update offer that never overwrites a hand edit, plus a 160-character steering note. One Search button runs web recall and PubMed for kept claims and locks the cards while it runs; per-lead "Use this query" and "Park this claim" write back to the cards. Fit-only answers reach only the paper reader. Backend status, capability rail, and publication filters moved into an Advanced disclosure. Verified locally, not deployed: `npm test` (typecheck, build, 136/136); browser pass at 1440px and 390px with a seeded eggs brief, including persistence across reload and the captured Search payload (both APIs were intercepted, so no live search ran). Not yet built: a "hunt disconfirming next" follow-up from results, human overturn of reviewer rejects, and the Artifact coverage display. Please keep avoiding overlapping edits to `app/api/recall`, `research-dashboard.tsx`, and the claim-board styles in `globals.css`.

## Accepted and integrated, awaiting release

- [x] Review `design/audit-fixes` (`5f86ccc`) for current-main compatibility. Its readability, mobile, first-paint, accessibility, route-title, empty-state, and undo changes are accepted. The two conflicts were resolved against current refresh and fallback code.
- [x] Current integration passes `npm test`: typecheck, build, and 121 tests.
- [x] README and app README now document the production URL, hosted/local boundary, server-side secrets, jobs, fallback behavior, and current limitations.
- [x] Hosted decomposition jobs, server-side recovery, guarded job ticking, scheduled sweep configuration, and persistent run telemetry are present in source.
- [x] Backend settings expose Astra/Lyra and OpenRouter health checks; provider credentials remain server-side in production.

## Product follow-ups

- [ ] Make Contextualize show how each answer changes the scoped claims, constraints, action space, and unknowns before research starts.
- [ ] Make Investigate show one locked run with per-lane progress, current task, cache state, elapsed time, estimate, failures, and a clear artifact-ready state.
- [ ] Replace capability placeholders as each lane becomes real; keep unfinished source classes visibly separate from accepted evidence.
- [ ] Connect divergence results to the Artifact and preserve class-specific source roles in the decision view.
- [ ] Add a clear artifact export/download flow and document the permanence/versioning behavior of case links.
- [ ] Complete a hosted research run through discovery, acquisition, extraction, review, promotion, synthesis, and a shareable artifact with useful accepted evidence.

## Reliability and engineering follow-ups

- [ ] Verify the production migration ledger for `0003`/`0004`, the three indexes, and whether the Sites cron actually fires; only then remove memoized runtime DDL.
- [ ] Decide whether to migrate hot paths to Drizzle or remove the unused ORM layer; document the choice.
- [ ] Promote hot job fields out of `state_json` if the cron workload requires queryable status/stage/next-at columns.
- [ ] Add retry-after handling to `scripts/compare-decomposition.mjs`.
- [ ] Document secret ownership and rotation for Lyra, OpenRouter, and job tick credentials.
- [ ] Decide whether to adopt the full Cloudflare worker types package and keep the typecheck gate strict.
- [ ] Add CI for typecheck, build, tests, and the release tree comparison.
- [ ] Resolve the Astra/Tailscale Funnel HTTP 530/525 path or replace it with a durable Cloudflare Tunnel; keep OpenRouter as an explicitly labeled recovery path.
- [ ] Reconcile deploys with reproducible clean-checkout packaging so `/private/tmp` contains no unique source state.

## Testing gaps

The current 121-test gate is strong for pure contracts and build safety, but it does not yet provide complete product or production confidence.

- [ ] Add a real browser E2E suite for a fresh case: submit → Decompose → edit → Contextualize → brief → Research → Artifact, with desktop/mobile, reduced motion, keyboard, refresh, and Settings health checks.
- [ ] Add worker integration tests with an isolated D1: apply migrations, exercise API routes, verify indexes, enforce tick/stats authorization, and test job locks, stale locks, retries, and failure persistence.
- [ ] Test the scheduled sweep itself, including cron invocation, self-fetch behavior, tab closure, and recovery when the browser never polls again.
- [ ] Add provider fault-injection coverage for Astra 525/530, timeout, malformed JSON, rate limits, missing model metadata, and OpenRouter recovery across every hosted stage.
- [ ] Add lane-accounting tests for five-lane/partial results: claim × lane preservation, deduplication, empty and failed lanes, fair result limits, and cache provenance.
- [ ] Add golden quality evaluations for the eggs case and non-clinical questions: dimension retention, context-answer preservation, scoped claim quality, source relevance, and evidence-to-decision grounding.
- [ ] Add built-asset security checks for provider-key leakage, loopback URLs, exported artifacts, logs, CORS/origin behavior, and server-only settings.
- [ ] Add automated accessibility and visual regression checks at 390px and desktop widths, including focus order, touch targets, contrast, loading announcements, and route titles.
- [ ] Add export/permanence tests: stable artifact links, version changes after accepted evidence, empty/stale/degraded states, and private versus stripped bundles.

## Release rule

Before saying “done,” report these separately: local working tree, committed commit, pushed `main`, Sites mirror commit, published version, live URL, route statuses, backend used, and browser console/network results. Never print provider secrets.
