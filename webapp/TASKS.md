# Epistack webapp — task tracker

Every UI/behavior ask from the session, with status.
✅ done · 🔨 in progress · ⏳ pending · ⚠️ superseded/reconciled

> **Reconciled 2026-08-09:** the 🔨/⏳ markers in the sections BELOW predate this date
> and are mostly resolved — the one-char intro typewriter + auto-grow box (§Landing),
> Stage-2 elicitation UI (§pipeline), and Stage-3 research are all BUILT and shipped.
> The authoritative current backlog is the **"Tracked / pending" section at the bottom.**

## Landing / intro
- ✅ Remove "Step 1 of 3 — shape the question"
- ✅ Remove the word "decompose" from the top brand
- ✅ Remove the "The question, as asked" label
- ✅ Placeholder → "what is your question?"
- ✅ Decompose button: right of the box, larger, icon-only, hover tooltip
- 🔨 **epistack types in ONE CHARACTER AT A TIME**, holds **1.4s** after the last letter, then moves to the corner  ← doing now (previously mis-built as a scale/fade, not a typewriter)
- ✅ Text box appears only AFTER epistack reaches the corner
- 🔨 **Text box auto-grows to fit as you type** (first screen)  ← doing now
- ⚠️ "3s before it moves" / "1.4s not 3.5" → reconciled into the typewriter timing above

## Decompose (dynamic, not hardcoded)
- ✅ Real `claude -p` call; re-runs on new text
- ✅ AI assigns colors to words
- ✅ AI clusters words into named axes + resolutions
- ✅ Empirical latency + ETA countdown (no hardcoded ~30s)
- ✅ Cache same question (instant replay)
- ✅ 8-question quality eval

## Reveal animation
- ✅ Colors appear gradually; words physically move into clusters
- ✅ Scroll-controlled, one cluster at a time (color its words → fly them into its card)
- ✅ Single-column list, large font
- ✅ Sticky question pinned while scrolling

## The 3-stage pipeline (your framing: expand → contextualize → deep-research)
- **Stage 1 · EXPAND** — decompose into dimensions; human edits/deletes/adds
  - ✅ prompt folded with the recurring lenses + gold few-shot examples + "at what amount does it flip" thresholds (`gold-examples.md`)
  - ✅ **editable stage 1**: rename / edit / delete / add dimensions & resolutions (verified in Playwright)
- **Stage 2 · CONTEXTUALIZE** — VOI elicitation prunes / branches / matches to your situation
  - 🔨 backend done (`/api/personalize` + AI-generated `elicit` with `why`); UI still to wire
- **Stage 3 · DEEP RESEARCH** — agents collect claims + evidence → build the graph
  - ⏳ Codex is ahead here (PubMed discovery, 164-record queue); I ran a live evidence sweep earlier

## Codex reconciliation (you asked "how is codex doing it?")
- Codex built the full pipeline (DB + editable map + contextQuestions + PubMed + synthesis); its canonical axes = our recurring lenses. Take its **proposal/keep-edit-add-park interaction contract** onto our UX.

## Verified in Playwright
- ✅ intro, decompose, colors, per-cluster flight, sticky, scroll stages, reset

## Open calibration (not blocking)
- per-stage height (62vh) — tune?
- dark theme — not screenshotted yet

## UX batch — 2026-07-20 (live-usage feedback)
Done this pass:
- ✅ **Stepper moved to top-right** of the sticky header (was a full-width row); compact pill tabs
- ✅ **Question paragraph collapses by default** (icon + one-line preview + ⌄ toggle); expands to the full coloured sentence
- ✅ **"ask another" is now icon-only** (`↺`, title tooltip)
- ✅ **Click a coloured word in the question → auto-scroll to its dimension** (setStep(1)+activate+scrollIntoView)
- ✅ **Next-button / add-dimension spacing** tightened (was 46vh/14vh bottom margins → 6vh/5vh)
- ✅ **Removed** the "tip: deep-dive & group first…" line under the decide button
- ✅ **Budget/affordability + preparation (cooking, which oil, eaten-with/instead-of)** added to the decompose lenses → those dimensions now surface
- ✅ **Robustness floor** (tolerant JSON parse + retry + timeout) — fixes intermittent invalid-JSON
- ✅ **Two-phase chunked deep-dive** (enumerate → detail) — reliable, source-checked results

Tracked / pending (bigger builds) — authoritative backlog, reconciled 2026-08-09:

Shipped since this list was written:
- ✅ **Stage 4 · the final artifact** — navigable typed-graph tab, fills in live as agents stream in
- ✅ **Research compiler** (Stage 2→3) — scoped claim portfolio + applicability profile + retrieval plans
- ✅ **Recall vs applicability** — 2-channel research (broad-literature + your-subgroup), no cherry-picking
- ✅ **Import / merge** — collaborate on one question; `src/merge.js` + `npm test` (8 invariants)
- ✅ **Honest counts** — killed the fake "graph uncertainty %"; stale-flagging on merge; redacted export

Still pending:
- ⏳ **Independent-fetch locus-check** — BLOCKED on user greenlight (adds outbound web-fetching); deterministic check that a quoted number appears in independently-fetched source text
- ⏳ **Streaming + editable/approvable orchestrator plan** — still read-only; stream the planning, edit/approve strategy + briefs before dispatch
- ⏳ **Adaptive follow-up elicitation** — selecting an option asks a follow-up: "extra on top" → *on top of what?*; "weight" → *current + target weight, why?*; budget → *can you afford eggs that often?*; cooking → *which oil?*
- ⏳ **Deterministic Playwright e2e suite** — make the manual browser verification durable (import/merge, redacted export, honest-counts, stale banner, prompt inspector)
- ⏳ **Gap→feedback loop** — reactivate parked axes / targeted follow-ups when a gap has decision value
- ⏳ **Fuzzy/normalized decompose cache** — reworded questions hit cache (today: exact-string only)
- ⏳ **Multi-provider fan-out** — Exa/Grok/Gemini (today: 100% Claude subagents)
- ⏳ **Live prompt EDITING** — inspector is view-only
- ⏳ **Typed persistent graph substrate** — stable result IDs (replacing `axisId#index`) + source snapshots (weeks-scale)
