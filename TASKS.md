# Epistack work queue

This is the durable queue for requests that span code, documentation, deployment, and live verification. A checked item means the source or environment was verified; a deployment item is not complete until the live site was checked.

## Now

- [x] **Provider provenance in the decomposition header.** The response contract now carries stage-level provider/model/status data and safe failure reasons; the homepage and inspector render it instead of the old hard-coded Astra label.
- [x] **Root reload returns to the composer.** `/` keeps the saved question editable after a normal refresh; saved decomposition results require an explicit `?resume=1` request.
- [x] **Back up and integrate the current source work.** Canonical `main` is pushed to GitHub, including the explicit `/decompose` route, research budget/model settings, the Contextualize impact ledger, and artifact JSON export. The last verified Sites release is version 81; the newer source still needs to be published.
- [x] **Live deployment smoke verification.** On 2026-09-14, `/`, `/map`, and `/research` returned 200. The deployed homepage showed `OpenRouter · deepseek/deepseek-v4.1-flash`; no loopback reference appeared in the rendered runtime. Console warnings were limited to a browser wallet extension; no site error was observed.
- [ ] **Fresh browser E2E after release.** Submit the eggs question from a clean case and verify Decompose → Contextualize → brief → Research → Artifact, including Settings health and the hosted fallback path.
- [x] **Integrate the clean research budget/settings work.** The reviewed clean branch was merged into `main` and passes the current gate. A separate Claude scratchpad still contains uncommitted claim-card steering work; it remains isolated for review and is not represented as merged or deployed.
- [ ] **Ready for review (Claude, two stacked branches in this repository; merge in order).** (1) `feat/investigate-claim-steering` at `c39fcbf` (based on `3a47985`): claim cards on Investigate, as described in `666def6`. (2) `feat/investigate-overturn-reject` at `298dc90` (on top of `c39fcbf`): a person can overturn a dual-model reviewer's reject. The promote route's `human-overturn` mode accepts only the exact rejected proposal, re-verifies the passage against an independently fetched PMC copy, writes `accepted-human-verified-full-text` next to the reviewer's reject assessment, and marks decisions stale; automatic re-runs no longer supersede a human stamp. Both are committed, not merged or deployed, and `git merge-tree` against `c28a92a` is clean for each. Verified locally: `npm test` (typecheck, build, 140/140); an end-to-end overturn with real PMC13521221 in the worktree's local D1 reached the Artifact, whose result detail labels it human-verified. Please avoid overlapping edits to `app/api/promote/route.ts`, `research-dashboard.tsx`, and the end of `globals.css` until these merge.

## Accepted and integrated, awaiting release

- [x] Review `design/audit-fixes` (`5f86ccc`) for current-main compatibility. Its readability, mobile, first-paint, accessibility, route-title, empty-state, and undo changes are accepted. The two conflicts were resolved against current refresh and fallback code.
- [x] Current integration passes `npm test`: typecheck, build, and 131 tests.
- [x] README and app README now document the production URL, hosted/local boundary, server-side secrets, jobs, fallback behavior, and current limitations.
- [x] Hosted decomposition jobs, server-side recovery, guarded job ticking, scheduled sweep configuration, and persistent run telemetry are present in source.
- [x] Backend settings expose Astra/Lyra and OpenRouter health checks; provider credentials remain server-side in production.

## Product follow-ups

- [x] Make Contextualize show how each answer changes the scoped claims, constraints, action space, and unknowns before research starts.
- [ ] Make Investigate show one locked run with per-lane progress, current task, cache state, elapsed time, estimate, failures, and a clear artifact-ready state.
- [ ] Replace capability placeholders as each lane becomes real; keep unfinished source classes visibly separate from accepted evidence.
- [ ] Connect divergence results to the Artifact and preserve class-specific source roles in the decision view.
- [x] Add a clear artifact export/download flow and document the permanence/versioning behavior of case links.
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

The current 131-test gate is strong for pure contracts and build safety, but it does not yet provide complete product or production confidence.

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
