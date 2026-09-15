# Epistack — engineering issues backlog

Deferred maintainability/architecture work. Not user-facing bugs. Ordered roughly
by impact if this ever needs to be reliable, multi-user, or long-lived.

Status tags: **[open]** not started · **[partial]** reduced but not finished ·
**[done]** resolved (kept briefly for history).

---

## A. The LLM output boundary is where this system lives or dies (highest impact)

Every stage of the pipeline consumes untrusted model output and feeds it through a
tight Zod schema. Inlining `max(140)`, `min(1)` arrays, exact enums, and
"return only JSON" into a prompt is a *hope*, not a contract: the model will
occasionally return prose, fences, a JSON array instead of an object, an over-long
field, or an empty array where one item is required. When that happens, the run dies
— and it dies opaquely ("could not complete or validate"), which is the worst
combination: no result, no diagnosis.

This is **the core physics of building on generative models**, not a bug you fix
once. It was effectively treated as an afterthought until the Phase 1 hardening, and
that hardening is incomplete.

What exists now:

- `app/lib/structured-output.ts` — balanced-JSON extraction (tolerates fences and
  surrounding prose), `safeParse`, and `parseStructuredWithRepair` (one repair pass
  that feeds the Zod issues back to the model).
- Wired into the decompose stage flow (`hosted-decomposition.ts` + a bounded retry in
  `decompose-live/route.ts`), source adapters (`source-adapters.ts`), and the causal
  extract/review path (`investigate/route.ts`).
- Acquisition guard: `extractSource` refuses to run on `<40` chars instead of
  producing an opaque schema failure.
- Parse failures now persist the raw text + Zod issues on the job (`state.parseFailure`).

What remains:

- **Repair budget is one.** A model that fails twice still kills the run.
- **Tight bounds still fail even after repair** — only `study.design` was relaxed
  (140→320); other `max(...)`/`min(1)` constraints across `decomposition-server.ts`,
  `deep-dive.ts`, `source-adapters.ts`, and `research-brief.ts` can still reject a
  plausible answer. A guideline that legitimately yields zero recommendations is a
  typed empty result, not a failure, but we currently cannot express that.
- **No uniform policy.** Some routes throw on a schema miss; there is no shared rule
  that a run *degrades* (empty/evidence-less result) rather than *dies*.
- **No observability of the failure rate.** `decomposition_runs` records outcomes but
  not parse-repair attempts or schema-miss causes, so we cannot see whether this is
  rare or routine.
- **No streaming/partial recovery.** A reply cut off mid-JSON cannot be salvaged, and
  large schema-bound answers are more likely to be truncated.

Principle to adopt: **model output is untrusted input.** Every boundary needs an
explicit repair/relax/refuse path, and "refuse" must surface a typed, user-legible
outcome — never a generic validation error.

Note: three duplicated `stripMarkdownFences`/`parseStructured` copies were
consolidated into `structured-output.ts` by the same work. **[done]**

---

## 1. Decomposition jobs are driven by the browser, not the server **[partial]**

The job state machine still advances on incoming POSTs, but there is now a
server-side safety net: `app/lib/job-sweeper.ts` + `app/worker/index.ts` `scheduled()`
+ `triggers.crons` (`* * * * *`) drive due jobs, and `POST /api/jobs/tick` is a
guarded manual fallback. Jobs persist their `origin`, so sweeps reach the right
deployment. The existing `locked_until` lease prevents client/cron races.

Still true:

- The client poll remains the primary, fast path; the cron is a recovery net (and on
  a stranded run it advances a few polls per tick, so completion is slow).
- A different browser/device still cannot resume (the receipt is in `localStorage`).
- The cron has **not been observed firing on the Sites platform**; only the config is
  verified. If the platform ignores crons, `/api/jobs/tick` needs an external caller.

Remaining option: Durable Object per job with `alarm()` (or Queues) for
"close the tab and it still finishes quickly," rather than a sweep.

## 2. ORM vs raw SQL split-brain **[open]**

Drizzle is installed and `app/db/schema.ts` defines every table (now including the
hosted job tables and `decomposition_runs`), but every real route still uses raw
`getD1().prepare(...)`; `getDb()` is effectively unused. The job tables are now
declared in Drizzle for migrations/types, which sharpens the inconsistency rather
than resolving it.

Decision still needed: adopt Drizzle in app code, or delete the ORM layer and keep a
single SQL source of truth. Given the relational evidence graph, adopting Drizzle is
probably right long-term.

## 3. Runtime DDL in the hot path **[partial]**

`CREATE TABLE IF NOT EXISTS` still runs at request time, but it is now **memoized per
isolate** (one batch per isolate, not per request) for `ensureSnapshotTables`,
`ensureEvidenceGraphTables`, `ensureDecisionTables`, `ensureOperationCacheTable`, and
`ensureHostedJobTables`. Inline per-request job-table DDL was removed; migrations
`0003`/`0004` now create the job/telemetry tables (`IF NOT EXISTS`), and the existing
tables were already in `0000–0002`.

Full removal (deleting the `ensure*` helpers and their call sites) is **gated on
confirming the platform actually applies and tracks `drizzle/` on prod D1** — the
table list alone is inconclusive because the runtime ensure creates the same tables.
That will also require updating the source-grep tests in
`tests/research-workflow.test.mjs` / `tests/decision-workflow.test.mjs`.

## 4. Job state is a JSON blob with no queryable columns **[partial]**

`state_json` still hides the hot fields. The sweeper queries them with
`json_extract(...)` plus a `locked_until` index, which is sufficient at this scale.
Promoting `status`/`stage`/`next_at`/`attempts` to real columns is still the proper
version (and needs an additive `ALTER` against the existing prod tables).

## 5. No persistent cross-run telemetry **[done]**

`decomposition_runs` (schema + migration `0004`) records each finished run; the
sweeper's completion path writes it; `summarizeDecompositionRuns` computes per-stage
p50/p95, success rate, and rate-limit counts; `GET /api/jobs/stats` (guarded) exposes
it. Next: include parse-repair attempts / schema-miss causes (see section A).

## 6. `scripts/compare-decomposition.mjs` still paces on a hardcoded 61s **[open]**

`app/scripts/compare-decomposition.mjs:59` hardcodes the 60s cooldown and has no
429/`retry-after` handling (it throws on any non-OK). The app route was fixed; this
diagnostic was left as-is deliberately.

## 7. Cache-key backend mismatch **[done]**

`decompositionBackendIsPrimary()` gates the homepage browser-cache write so only an
Astra result is stored under the Astra-keyed cache; an OpenRouter fallback result can
no longer be served as if Astra produced it.

## 8. `/decompose-live` inspector has no OpenRouter fallback **[done]**

`app/app/decompose-live/page.tsx` now drives the shared
`runHostedDecomposition` client, so it gets the same Astra → OpenRouter fallback and
resume behavior as the homepage.

## 9. Only decomposition is hosted **[open]**

The research → evidence promotion → synthesis workflow still requires the local
Claude companion (`npm run agents`). A fully hosted investigation is unbuilt.

## 10. TypeScript checking is not clean **[done]**

`app/cloudflare-workers.d.ts` declares the minimal Cloudflare ambient types
(`D1Database`, `D1PreparedStatement`, `D1Result`, `Fetcher`, `cloudflare:workers`
env), the remaining genuine type errors were fixed, and `tsc --noEmit` is now 0
errors. `npm run typecheck` runs as part of `npm test`.

Follow-up (not required for the gate): adopting the full
`@cloudflare/workers-types` narrows `Response.json()` to `unknown` and surfaces ~45
call sites — worth doing eventually for a stricter gate.

## 11. Secret handling **[partial]**

Lyra/OpenRouter/job secrets live in `.dev.vars` locally (gitignored) and as hosted
secrets. No rotation policy or per-user key isolation.

Immediate exposure follow-up is complete: `JOBS_TICK_TOKEN` was rotated before the
final deployment, and Sites write credentials are short-lived. The remaining work
is to document an owner/rotation policy and consider per-user key isolation.

## 12. Deploy source reconciliation **[partial]**

The Sites source now fast-forwards from the prior deployment history to a clean
mirror commit (`7ec6f00`) derived from canonical `main` (`0f29744`). The artifact is
built from the ignored `app/.deploy/` tree created from the pushed repository
commit, and the Sites remote is registered in the main repo. The remaining
imperfection is that the Sites repository has an unrelated historical root, so its
commit hash cannot equal the GitHub `main` hash without a force rewrite. Keep the
tree comparison and clean-checkout packaging as the release invariant.

---

## Stage 3: multi-source investigation model

The hosted investigation path classifies sources as `primary-study`,
`systematic-review`, `guideline`, `standard`, `trial-registry`,
`official-statistics`, `preprint`, `reporting`, or `anecdote`. Source class is
kept separate from three axes: `evidenceStatus` (lead through accepted or
rejected), `epistemicRole` (causal, normative, descriptive, status, or context),
and acquisition (`fetched-verified` or `cited-unverified`).

Promotion is deliberately narrow: only a non-preliminary causal source whose
artifact was fetched and verified and whose result passed adversarial review can
be accepted. The adapters acquire PMC JATS for eligible research records,
ClinicalTrials.gov v2 records for trial registries, or best-effort HTML; a failed
acquisition remains a cited-unverified fallback rather than verified evidence.

Recall fans out one broad agent per claim, plus separate applicability and context
lanes; those returns remain lead-only and the context lane cannot promote evidence.
Remaining work: Phase-4 lane display in the artifact, wiring `computeDivergence`
into the artifact (the helpers exist but are not connected there), and live
lane-progress reporting.

## 13. Hosted full-text review needs deterministic failure telemetry [partial]

Observed on 2026-09-15 in case `74fcbb3f-bbf9-40c6-a62d-42bc6d8c0d05`: the
recall and six claim searches completed, PMC acquisition succeeded with a
verified SHA-256 artifact, and both review stages returned structured output.
All four proposed results were rejected only at the final literal passage gate.

The extractor returned exact excerpts wrapped in `...`, despite the prompt
forbidding ellipses. The adversarial reviewer marked its quote checks true, but
the deterministic verifier correctly found the wrapped strings absent from the
preserved plain text. This is an extractor-output failure, not evidence that the
paper lacked relevant content or that the worker crashed.

The first correction is deliberately narrow: strip only boundary ellipses before
the unchanged contiguous-substring check, and persist the canonical excerpt. A
non-contiguous or fabricated excerpt still rejects. The remaining gap is
production telemetry that records bounded deterministic rejection classes and
whether the two stages used distinct underlying model IDs.

## 14. Stored claim frames can outlive the compiled brief [open]

The same live case rendered 12 `claim_frames` in the Artifact while the saved
compiled research contract contained 6 claims. The current case-save path
upserts current frames but does not reconcile stale frame IDs, and the Artifact
currently appends uncovered extra frames. Impact is misleading empty claim lanes
and inflated claim counts. Recommended next step: reproduce on a disposable case,
then make the display contract prefer the compiled claim set while preserving
accepted historical relations; do not delete production rows as a cleanup shortcut.

## 15. Dual-review labels can mask identical underlying models [open]

The live fallback displayed `openai/gpt-4o-mini` for both extractor and
adversarial reviewer, with different role suffixes. `adjudicateDualReview`
currently compares the full display strings, so role labels satisfy the
`modelsDiffer` check even when the underlying provider/model ID is identical.
This did not cause the observed rejection, but it can weaken the intended
independence gate once a passage passes. Next step: define whether the policy
requires distinct model IDs or only isolated processes, then enforce and display
that decision consistently in `dual-review.ts`, `investigate/route.ts`, and
`promote/route.ts`.
