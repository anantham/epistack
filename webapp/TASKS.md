# Epistack webapp — task tracker

Every UI/behavior ask from the session, with status.
✅ done · 🔨 in progress · ⏳ pending · ⚠️ superseded/reconciled

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
