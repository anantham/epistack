# Epistack

**Turn a vague, open-ended question into testable claims — a human-steered, AI-assisted investigation.**

The input is a vague, open-ended question. The AI assists in mapping out potential concrete
interpretations and elicits your specific context to help prune that space, making the search
tractable based on what actions are available to you the decision maker, and where you find yourself
concretely.

The third stage is where you steer subagents to develop the knowledge graph such that uncertainty goes
down and you feel more clear regarding what the evidence points to and where data is lacking.

It's an **exoskeleton for investigation** — the human stays in the loop at every handoff, the AI
amplifies. Not passive button-clicking: you shape the interpretation, ground it in your real
situation, steer where the research spends effort, and can contest any claim.

## The pipeline

1. **Expand** — decompose the question into its hidden dimensions (grounded in the sentence's grammar),
   each with candidate resolutions and an *"at what amount does it flip?"* threshold. You prune what's
   irrelevant and add finer categories.
2. **Contextualize** — the AI elicits your situation *and your action space* (which options are
   actually available to you), then pins the dimensions your context settles, keeps the ones still
   open, and spawns new personal ones — the *filtered graph*.
3. **Research + Enrich** — an orchestrator plans the investigation and dispatches one specialist agent
   per open axis to scour the web. Each finding is tagged to a resolution; you can **deep-dive** any
   paper into its distinct **results** (each with scope, effect size, a passage pointer, a verification
   status, and a typed relation to the claim), **group** sources into independent evidence families
   (so correlated studies aren't counted as independent votes), and **cross-examine** them into a
   claim × source matrix.
4. **Decide** — synthesize the graph into an actionable answer for *you*: the recommendation, the
   tradeoffs, the single crux it hinges on, an honestly-calibrated confidence, what's missing, and an
   n=1 test that would inform it.

The canonical evidence unit is a **result**, not a paper — a document is a container. See
[`GRAPH-MODEL.md`](GRAPH-MODEL.md) for the target data model (typed nodes + edges, multidimensional
uncertainty, dependence grouping, and the merge/commons story), and the `.canvas` files
([conceptual](eggs-investigation.canvas), [implementation data-flow](epistack-dataflow.canvas)) for the
flow and current plumbing. The `cases/eggs/` folder is the worked proving case.

## Two branches, one model

This repo holds two parallel implementations of the same investigation model, built by different
agents:

- **`claude/work`** (this branch) — a Vite + React app whose backend is free **`claude -p`** subagents
  (Claude's `WebSearch`/`WebFetch`), so it runs with **no API key**. Strong on the live investigation:
  agent dashboard, result-level deep-dives, dependence grouping, persistent + exportable artifacts.
- **`main`** — a Next.js implementation with a typed, persistent result graph (D1 schema, migrations,
  verification-state), decomposition via OpenRouter.

The winning system is the live exoskeleton writing into a typed, persistent result graph.

## Run (this branch)

```bash
cd webapp
npm install
npm run dev        # http://localhost:5173
```

Requires the [`claude` CLI](https://claude.com/claude-code) on your `PATH` (the dev server spawns
`claude -p` for every AI call — decompose, personalize, research, deep-dive, dependence, matrix,
decide). Investigations persist to `localStorage` and can be exported as schema-versioned JSON.

---

*Built for the FLF Epistack workflow challenge.*
