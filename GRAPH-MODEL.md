# The Epistack graph model — a mergeable, versioned argument graph

The artifact is **not a tree of findings**. It is a typed, versioned graph of claims, sources,
and the relationships between them — designed so investigations **compound** (each one enriches a
shared substrate) and **merge** (someone else's graph can join yours). This doc is the target model;
the last section maps it to what's built today.

## Nodes

| node | what it is | canonical identity (for merge) |
|---|---|---|
| **Source** | a document (paper, guideline, dataset, expert statement) | **DOI / normalized URL** — objective, dedupes across graphs |
| **Claim** | a proposition someone asserts | canonical statement + embedding cluster (matches "same claim, different form") |
| **Sub-question / Dimension** | a facet of the inquiry — "what we care about" | semantic; alignable to a shared topic ontology |
| **Assumption** | a load-bearing premise, *often implicit and unnamed in the paper* | extracted + named explicitly, then addressable |
| **Actor** | author / PI / funder / institution | ORCID / ROR / org id — carries reputation + scandal events |

Every node carries **provenance** (who asserted it, when, from what) and claims carry a
**first-class uncertainty estimate** (not a hidden property).

## Edges — the typed relationships that make the argument *navigable*

These are exactly the four structures you named:

- **Inference structure** — `supports` / `disputes` (Source→Claim, Claim→Claim). Which evidence and
  which claims are offered as grounds for which other claims. This is what the **claim × source matrix**
  renders: a cell is a `supports`/`disputes`/`silent` edge.
- **Discourse structure** — `addresses` (Claim/Source → Sub-question). Where people are answering
  *different* sub-questions, and how those roll up to the overall inquiry. Differences of emphasis
  (explicit or implicit) surface as *which* sub-questions a source even engages.
- **Similar-but-not-identical** — `refines` / `caveats` / `reframes` (Claim→Claim). Different framings
  of a condition, added caveats, or **different uncertainty estimates for the same quantity**. These are
  edges, not merges — the variants stay distinct and linked, so "≤1/day is safe" and "≤1/day is safe
  *for non-diabetics*" are neighbors, not duplicates.
- **Deference / trust** — `cites` / `defers-to` (Source→Source, Actor→Actor) + `authored-by` /
  `funded-by` (Source→Actor). The chain of trust: who relies on whom, who paid for what.

## Temporal layer — the graph is *alive*

Every node and edge is **append-only and versioned** (valid-from / valid-to), so you can replay the
argument's state at any date and watch it evolve.

- **Source status** transitions: `published → critiqued → contested → retracted`. Subscribe to
  **Retraction Watch, PubPeer, Crossref retraction notices, OpenAlex** → when a source's status flips,
  **propagate along edges**: every claim it `supports` loses that support, uncertainty recomputes, and
  anything that *becomes* unsupported gets flagged for re-examination.
- **Actor-level events**: if a PI is shown p-hacking, a `trust-decay` propagates along `authored-by` —
  **every** paper by that actor is flagged for re-review, *even the ones that are individually fine*,
  because the prior on their work moved.
- **Assumption challenges**: when new evidence contradicts a load-bearing `assumption`, it propagates
  to every claim that `assumes` it. Because papers frequently don't *name* their assumptions, the
  extraction step's job is to make the implicit ones explicit so they *can* be tracked and updated.

The unit of update is the **edge**, so an update is a diff — broadcastable to every subscriber's graph.

## Merge — how someone else's graph joins yours

The trick is a clean split:

- **Shared substrate (objective, compounds):** Sources + their provenance cards + extracted Claims +
  the `supports`/`disputes`/deference edges. These have canonical ids (DOI/URL/ORCID), so they **dedupe
  and union cleanly**. My deep-dive on Zhong 2019 is reusable by everyone; the 40th eggs investigation
  starts with 39 investigations' worth of vetted sources. *This* is the compounding knowledge base.
- **Personal overlay (subjective, forkable):** your question, your dimensions, your context/filter,
  your weighting of what matters. This does **not** merge — it's a **lens** you apply over the shared
  substrate. You can fork someone else's framing, but you don't inherit their priorities.

**Merge semantics = union, never last-writer-wins.** Union sources by id, claims by semantic match
(keep variant forms as `refines` edges), edges by endpoints. When two graphs **disagree** on a stance
("A says source X supports claim C; B says X is silent"), a stance is *itself* an assertion by an actor —
so keep **both**, attributed. Conflict is first-class data, not a thing to overwrite.

The **claim × source matrix is the interchange format**: deduped sources (columns) × deduped claims
(rows) × stances (cells) is precisely the mergeable core. Two matrices merge by unioning columns and
rows and stacking conflicting cells with attribution.

## What's built today → the gap

Built (this webapp):
- **Source + provenance**: research agents attribute each claim to a source; deep-dive subagents fill the
  full provenance card (design, p-value, n, exposure, journal+tier, PIs, funding, open-data, critiques).
- **Discourse (primitive)**: one agent per Sub-question/Dimension; `supports` edge = which resolution a
  finding backs; the caring-graph uncertainty per axis.
- **Inference + dedup + contradiction**: the **claim × source matrix** (`/api/matrix`) merges
  same-claim-different-form, dedupes sources, and marks `supports`/`disputes`/`silent` — the mergeable unit.

Not yet built (the roadmap this doc defines):
- Claim→Claim edges (`refines`/`caveats`/`reframes`) — the "similar but not identical" layer.
- Explicit **Assumption** nodes surfaced from papers that don't name them.
- Source→Source **deference** edges + Actor nodes.
- The **temporal layer**: versioning, source-status subscriptions (Retraction Watch / PubPeer), and
  propagation of updates along edges.
- Persistence + a merge/import path (canonical ids exist; the store + union-merge do not).
