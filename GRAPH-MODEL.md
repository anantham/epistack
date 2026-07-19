# The Epistack model — a result-level, decision-and-learning graph

**Design target, not current state.** The running webapp is an MVP whose objects (source-level
findings, source-level matrix stances, an entropy "uncertainty" meter, personalized-only search, one
"decisive" test) are **approximations this document supersedes**. The last section maps MVP → target.

Two principles govern everything:

1. **Reason at the result level. Preserve the paper as context.** A document is a *container*; the
   atomic unit of evidence is a **Result**. The author's own conclusion is just another claim to assess,
   usually *underdetermined* by the paper's results.
2. **Only source artifacts are truly shared. Every extraction and judgment is attributed and
   contestable.** "This result supports that claim" is an assertion by *some agent* (an AI, a human,
   another model) — not ground truth. It carries a byline and can be disputed.

---

## Canonical objects

### Evidence spine (within-source decomposition)

```text
SourceArtifact                      a document (paper, guideline, dataset, page)
  → Passage / Table / Figure        exact locus — every downstream object points back here
    → Study                         a distinct study within the document
      → StudyContext                population · intervention · cohort identity
        → Analysis                  a specific analysis (model, adjustment set, endpoint)
          → Result   ◀── THE ATOM   one estimate: effect + interval, for one scope
          → AuthorInterpretation    the paper's own reading — a claim, not the data
```

A **Result** records, at minimum: exact table/figure/passage pointer · population & subgroup ·
exposure/dose/comparator · outcome & time-horizon · effect estimate + uncertainty interval ·
statistical model & adjustments · **primary / secondary / exploratory / post-hoc** status · N *for
that analysis* · missingness & exclusions · preregistered? · **dataset/cohort identity** · which
claim it bears on and how. The passage pointer is mandatory — a human must be able to spot-check any
result in seconds.

### Claims and relations

```text
Result ──(EvidenceRelation, attributed)──▶ ClaimFrame
ClaimFrame + Assumption ──(Inference)──▶ ClaimFrame        (downstream claims)
ClaimFrame ──(ApplicabilityBridge)──▶ TargetContext        (transportability, not truth)
```

**ClaimFrame — identity is *structural*, never embedding-based.** Two claims that are neighbors in
embedding space can differ on the one condition that matters ("≤1/day, general pop" vs "2/day, active
men only"). A ClaimFrame compiles: population · exposure/intervention · dose & frequency · comparator ·
outcome · time-horizon · **estimand** · causal-vs-associational modality · conditions/exclusions ·
asserted uncertainty. Embeddings *propose* merge candidates; an **entailment/scope check — and
sometimes a human — decides** equivalent / overlapping / narrower / contradictory.

**EvidenceRelation is typed and attributed.** `supports/disputes/silent` is too coarse. Use:
`supports` · `contradicts` · `undercuts-method` · `qualifies` · `bounds` · `fails-to-replicate` ·
`mechanistically-explains` · `transports-to` · `does-not-transport-to` · `evidence-about-assumption` ·
`underdetermines` · `not-informative`. Every relation is an assertion with a byline (AI-proposed →
human/other-model may overturn).

### Decision layer (the objects the old model only described in prose)

```text
DecisionEpisode → Option → ExpectedOutcome
Values + Constraints + ExpectedOutcomes → DecisionPolicy
```

"Does evidence support a claim?" and "does this claim favor eating two eggs?" are *different edges*.
The chain must stay separated so empirical claims and personal preferences never silently collapse
into one recommendation:

> Evidence → scoped claim → applicability inference → outcome prediction → option → decision under stated values

### Learning layer (n=1 is not an ordinary Source)

```text
Protocol → Observation → Contribution
```

A personal observation gets its **own type**, carrying: pre-registered/timestamped protocol · baseline
& intervention periods · adherence · measurement error · washout/carryover · missing observations ·
deviations · selection process · context · privacy permissions. Community aggregation groups
**compatible protocols only** and preserves heterogeneity — otherwise the commons fills with sincere
but statistically misleading anecdotes.

### Cross-cutting

- **DependenceGroup** — results sharing participants / dataset / team / measurement / design belong to
  one group. Decomposing a paper into ten results must **not** create ten independent votes.
- **Assumption** — load-bearing premises, made explicit (papers rarely name them).
- **Actor** — authors / PIs / funders / institutions; carries integrity events.
- **UpdateEvent** — append-only events (a retraction, a misconduct finding, a new result) that route to
  a **ReassessmentQueue**. Updates are *events*, not automatic edge-verdict flips.

---

## Uncertainty is multidimensional (retire the single entropy meter)

Normalized entropy over how AI-found findings fall into resolution buckets measures the **distribution
of retrieved findings**, not uncertainty about reality — it's polluted by agent count, publication
volume, duplicated datasets, search ranking, resolution wording, and arbitrary confidence labels. Many
axes aren't even probability spaces ("affordable", "high-protein", "raises LDL", "ethical" can all be
true at once). Show **separate** indicators:

- **Coverage** — how thoroughly was this searched (against a declared boundary)?
- **Disagreement** — how much *credible* evidence genuinely conflicts (after scope alignment)?
- **Estimate uncertainty** — how wide are the effect intervals?
- **Independence** — how many genuinely independent evidence *families* (DependenceGroups)?
- **Applicability** — how well does the evidence transport to *this* target context?
- **Model risk** — how much rides on untested assumptions?
- **Decision stability** — *does the recommended action survive plausible alternatives?* ← usually the
  most useful of all, and often more honest than any universal "confidence" score.

## Apparent vs. genuine contradiction

Before labeling two results contradictory, **align scope**: association vs causation · 1 vs 3 eggs ·
diabetic vs not · LDL vs events · 8 weeks vs 20 years · replacing carbs vs adding calories · adjusted
vs unadjusted. Most "contradictions" dissolve into *different questions*. Only genuine conflict after
alignment counts toward Disagreement.

## Search: recall before applicability

Personalized search that only queries "evidence about you" on open dimensions is efficient but
**prunes the disconfirming evidence most likely to change your framing** — personalized cherry-picking.
Two channels, visibly compared:

1. **Recall channel** — broad, framing-diverse, hunts surprises. A control search that always runs.
2. **Applicability channel** — ranks the recalled evidence for the person's context.

> Broad literature says X; the subset most applicable to you says Y; the difference is driven by Z.

Dropped dimensions stay **recoverable and periodically re-challenged** — the initial AI decomposition
must not permanently govern what can be learned.

## Cruxes = expected value of information

A contested matrix row isn't necessarily decision-relevant; an *uncontested but unsupported transport
assumption* often is. Rank cruxes by ≈ EVOI: P(resolving it changes the action) · size of the change ·
current uncertainty · cost/feasibility of learning · decision reversibility · time-sensitivity ·
whether it's empirically resolvable. And admit the honest case: **"there is no single decisive test"**
(an LDL trial informs your biomarker response without resolving 20-year outcomes).

## Missingness needs coverage contracts

An open-world graph can't know what it never represented. Declare the **investigation boundary**:
populations / outcomes / source-classes / dissenting perspectives / causal alternatives / time-periods
/ geographies searched · excluded sources + reasons · queries & databases used. Report gaps as
*"missing relative to this declared boundary,"* not "the graph knows its own holes."

## Updates: obligations, not automatic verdicts

A retraction triggers **reassessment weighted by *why*** (fabrication ≠ duplicate publication ≠
authorship dispute ≠ administrative withdrawal). PI misconduct creates an **actor-level integrity
event** → identifies connected work → prioritizes it for re-review → adjusts an explicit
*integrity-risk* field. It must **not** auto-reduce every paper's weight — that's guilt-by-association.

## Merge & commons (unchanged in spirit, sharpened)

- **Shared & compounds:** SourceArtifacts + their result-level extractions *as attributed, contestable
  assertions*. Not a "shared objective substrate" — extractions are interpretive; what's objective is
  the artifact and its passage pointers.
- **Personal & forks:** dimensions, context, values, DecisionEpisodes.
- **Open write · curated read · trust computed, not gated.** Append-only + attributed conflict. Publish
  *derived, generalized, consented* data only (k-anonymous lenses, aggregated Observations) — never raw.

## Ingestion is tiered (EVOI applied to extraction effort)

Full result-level decomposition of every paper is expensive, so spend it where it pays:

1. Identify distinct studies in the document.
2. Extract analyses and reported results.
3. Compile each result's scope frame.
4. **Separate measured results from author interpretations.**
5. Propose typed relationships to existing ClaimFrames.
6. Detect within-study tensions.
7. Group dependent results (DependenceGroup).
8. Route load-bearing / ambiguous / crux-bearing extractions to **human verification**.

Cheap source-level triage first; deep result-level decomposition for the sources that bear on the crux;
human sign-off on the decisive ones. Every extraction keeps its passage pointer.

## Projections, not separate structures

The **matrix**, **argument map**, **caring graph**, and **decision page** are all *views* over the one
result-level structure. A matrix cell is no longer a single glyph — it summarizes (`Mixed: 1 supports ·
1 qualifies · 2 uninformative`) and expands into the **result ledger** (each result with scope,
relation, and its passage pointer).

---

## MVP (built today) → target

| built now (a projection/approximation) | target |
|---|---|
| source-level `findings` with one `supports` each | result-level Results with typed, attributed relations |
| claim × source matrix as the structure | matrix as a **view**; cells expand to the result ledger |
| entropy "uncertainty %" meter | the 7 separate indicators, headlined by **decision stability** |
| personalized-only agents on open axes | **recall + applicability** dual channel, control search retained |
| one `decisiveTest` in Decide | EVOI-ranked cruxes; "no single decisive test" admissible |
| `missing` inferred by the model | **coverage contracts** — missing vs a declared boundary |
| Decision only in the UI | Decision / Option / Outcome / Applicability / Protocol / Observation in the schema |

**Fix these three first** (highest leverage): (1) matrix → a view; (2) result-level provenance +
multidimensional uncertainty replacing source-stances + entropy; (3) put Decision, Option, Outcome,
Applicability, Protocol, Observation into the actual schema. Those turn a compelling research
*visualization* into a defensible decision-and-learning *system*.
