# Epistack — engineering issues backlog

Deferred maintainability/architecture work. Not user-facing bugs. Ordered roughly
by impact if this ever needs to be reliable, multi-user, or long-lived.

## 1. Decomposition jobs are driven by the browser, not the server (highest impact)

`app/app/api/decompose-live/route.ts` advances the job state machine **one step per
incoming POST**. The only caller is the poll loop in
`app/lib/hosted-decomposition-client.ts` (plus the `/decompose-live` inspector). There
is no server-side driver:

- `app/worker/index.ts` has no `scheduled` handler.
- `dist/server/wrangler.json` has `"triggers":{}` and no Durable Objects or queues.
- The job row lives in D1 (`hosted_decomposition_jobs`) as an opaque `state_json`.

Consequences:

- Closing the tab strands the job until a client with the saved receipt polls again.
- Background-tab timer throttling slows the run.
- A different browser/device cannot resume (receipt is in `localStorage`).

Options (smallest to cleanest): Cron Trigger sweep of due jobs; Durable Object per job
with `alarm()`; Cloudflare Queues with `delaySeconds`.

This is also the fix that forces items 2–4 to be resolved for the job table.

## 2. ORM vs raw SQL split-brain

Drizzle is installed and `app/db/schema.ts` defines ~18 tables, but `getDb()`
(`app/db/index.ts:14`) is only used in `app/examples/d1/app/api/notes/route.ts`.
Every real route uses raw `getD1().prepare(...)`.

Note: migrations *are* tracked (`app/drizzle/0000–0002` + `meta/_journal.json`); the
review claim that they aren't is wrong. The real gap is inconsistency and dead weight.

Decision needed: either (a) adopt Drizzle in app code, or (b) delete the unused ORM
layer and keep a single `schema.sql`. Given the typed/relational nature of the
evidence graph, (a) is probably right long-term.

## 3. Runtime DDL in the hot path

`CREATE TABLE IF NOT EXISTS` runs during live requests:

- `app/app/api/decompose-live/route.ts:17` — `hosted_decomposition_jobs` on every submit.
- `app/db/cache.ts:35,67` — `operation_cache` on every cache read/write (already in
  `schema.ts:248` and migrations).
- `app/lib/live-artifact-store.ts:35`, and the promote/synthesize/cases routes call
  `ensureEvidenceGraphTables()` / `ensureDecisionTables()` / `ensureSnapshotTables()`.

Every one is an avoidable D1 round-trip. Fix: move all DDL into migrations and run
them once at deploy.

## 4. Job state is a JSON blob with no queryable columns

`hosted_decomposition_jobs.state_json` hides `status`, `stage`, `next_at`, `attempts`,
and `rate_limits`. You cannot index or query "which jobs are due", which is exactly
what a server-side driver (item 1) needs.

Note: JSON payloads elsewhere are mostly justified (flexible/polymorphic agent
output; the evidence graph extracts queryable fields into real columns). The job
table is the genuine anti-pattern.

## 5. No persistent cross-run telemetry

Client-side per-run durations exist (`app/lib/decomposition-telemetry.ts`, bounded to
25 runs in `localStorage`), and the server tracks per-stage durations/attempts per
job. There is no aggregate table (per-stage p50/p95, success rate, rate-limit counts
across runs/users).

## 6. `scripts/compare-decomposition.mjs` still paces on a hardcoded 61s

`app/scripts/compare-decomposition.mjs:59` hardcodes the 60s cooldown and has no
429/`retry-after` handling (it throws on any non-OK). The app route was fixed; this
diagnostic was left as-is deliberately.

## 7. Cache-key backend mismatch

The homepage computes the browser-cache key with the constant
`lyra-chatgpt-pro:hosted-v2` even when the OpenRouter fallback runs, so a result from
one backend can be served as a cache hit for the other.

## 8. `/decompose-live` inspector has no OpenRouter fallback

`app/app/decompose-live/page.tsx` calls `/api/decompose-live` directly and shows
"not configured" without Lyra; the homepage fallback is not wired there.

## 9. Only decomposition is hosted

The research → evidence promotion → synthesis workflow still requires the local
Claude companion (`npm run agents`). A fully hosted investigation is unbuilt.

## 10. TypeScript checking is not clean

Existing project errors plus missing Cloudflare ambient types. `npm run build` works
and tests pass; `tsc` is not a usable gate yet.

## 11. Secret handling

Lyra/OpenRouter secrets live in `.dev.vars` locally (gitignored) and as hosted
secrets. No secret-manager story, rotation policy, or per-user key isolation.

---

## Stage 3: multi-source investigation model

The hosted investigation path now classifies sources as `primary-study`,
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

Recall now fans out one broad agent per claim, plus separate applicability and
context lanes. These returns remain lead-only; the context lane cannot promote
evidence. Remaining work is Phase-4 lane display in the artifact, wiring the
planned `computeDivergence` step into that artifact (the current divergence
helpers are not connected there), and live lane-progress reporting.
