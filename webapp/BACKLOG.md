# Future features / backlog

Parked ideas, newest at top. (Live tasks live in `TASKS.md`.)

## Now / next
- [ ] **AI-suggest whole DIMENSIONS** on "add a dimension" — the `/api/suggest` endpoint already handles `kind:"dimension"`; just wire the UI (chips → add a full dimension). Companion to the resolution-suggest shipping now.
- [ ] **Persist stage-1 edits** to cache so your shaping survives "ask another"; add a **↻ regenerate** that bypasses cache.
- [ ] **Stage 2 UI** — elicitation panel + pinned/open/dropped map (backend `/api/personalize` is done).

## Later
- [ ] Adopt Codex's **park** state — set a dimension aside without deleting (recoverable).
- [ ] Compile a **claim template** from the kept branches ("For {{who}}, does {{exposure}}…").
- [ ] Dark-theme screenshot pass.
- [ ] Latency: the AI calls are ~30s (`claude -p`). Consider pre-generating a few "reserve" resolutions in the initial decompose for instant reveal.

## Shipped (recent)
- [x] **Stage 3 · deep research** — one `claude -p --allowedTools WebSearch,WebFetch` agent per still-open axis; live per-agent status/timer + summary bar; each finding tagged back to a resolution bucket with source URL, study kind, n, confidence, and a COI flag (`/api/research`)
- [x] **1/2/3 stepper** (expand / contextualize / research) — each stage its own page
- [x] **Stage 2 UI** — elicitation panel + personalized pinned/open/dropped/new map
- [x] **AI-suggested resolutions on "+ add"** (this session)
- [x] Editable stage 1 — rename / edit / delete / add dimensions & resolutions
- [x] Decompose prompt folded with recurring lenses + gold few-shot + "at what amount does it flip" thresholds
- [x] Typewriter intro, auto-grow box, empirical ETA, caching, scroll-driven per-cluster reveal
