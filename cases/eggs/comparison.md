# Baseline vs Epistack — the honest delta (F1)

*Method: the [`baseline.md`](./baseline.md) was produced by an agent **blind** to our graph.
The 8 dimensions below were **pre-registered** (stated in-session before the baseline was read),
so the scoring can't be reverse-engineered to flatter us. Both artifacts are scored honestly,
including where the baseline matched or beat [`report.md`](./report.md)/[`evidence.md`](./evidence.md).*

## TL;DR — and it's humbling

**The strong deep-research baseline is very good.** It reaches the right answer, calibrates
uncertainty honestly ("reassuring but not high-certainty," flags the low GRADE), names *both*
cruxes (comparator + East–West confounding), gives conditional subgroup advice, and even
identifies that the Zhong harm signal is the entangled outlier. On **facts and reasoning, Epistack
does not clearly beat it.** On raw **coverage the baseline beat us** — it caught the ESC/EAS `<300 mg`
guideline holdout, the ADA position, and RCTs (Clarke 1997, a 2025 saturated-fat crossover, a 3-egg
metabolic-syndrome trial) that our five-agent sweep missed.

The real, defensible Epistack delta is **narrower and structural**, concentrated in three places:
1. **Provenance & symmetric COI** — the baseline is COI-blind.
2. **Interrogability** — a graph you can ablate and challenge node-by-node vs a narrative you take or leave.
3. **The decomposition layer** — mapping the *space* of framings, not answering one.

## Scored on the 8 pre-registered dimensions

| # | Dimension | Baseline | Epistack | Verdict |
|---|---|---|---|---|
| 1 | Headline correctness | ✓ nails it | ✓ | **tie** |
| 2 | Uncertainty faithfulness | ✓ "not high-certainty," flags low GRADE | ✓ confidence capped; "convergence ≠ strong null" | **tie** |
| 3 | Load-bearing visibility | partial — IDs Zhong as the entangled outlier; confidence table | ✓ explicit ablation names Zhong + a COI-cluster ablation | **slight Epistack** (mechanical vs prose) |
| 4 | Crux localization | ✓ nails comparator + East–West confounding | ✓ | **tie** (I expected a win; didn't get one) |
| 5 | Decision-first + conditional | ✓ BLUF + subgroup Rx, very actionable | ✓ decision-first | **tie** (baseline arguably more actionable) |
| 6 | Provenance & symmetric COI | ✗ COI-blind (see below) | ✓ symmetric ledger; funding-bias quantified | **Epistack win** |
| 7 | Surfacing the hidden | heart-failure ✓ (better-sourced than us); cancer-mortality ✗ | HF ✓ + cancer ✓ | **wash** |
| 8 | Interrogability / structure | ✗ prose, take-it-or-leave-it | ✓ graph, node-level challenge, receipts, machine-readable | **Epistack win** (structural) |
| + | Decomposition (space of framings) | — (answered one framing) | ✓ maps who/what/how-much + F2–F5 | Epistack-only layer* |
| + | Coverage completeness | caught ESC/EAS + ADA + extra RCTs **we missed** | missed those | **Baseline win** |

\* not a fair head-to-head — the baseline was asked the F1 sub-question, not the vague question.

## Where the baseline matched or beat us (reported honestly)

- **It found the cruxes on its own.** "The eggs that hurt are the ones sitting next to processed
  meat and refined starch"; "This East–West split is the single most important interpretive clue."
  A good narrative *does* do crux-identification. Our claim that a narrative buries the comparator
  crux was **too strong** — this one surfaced it clearly.
- **It calibrated uncertainty well** — explicitly downgraded to "reassuring but not high-certainty"
  and cited the 2025 umbrella's low GRADE. It did not sand off uncertainty.
- **It out-covered us.** The ESC/EAS 2019 `<300 mg` holdout and the ADA position are genuinely
  relevant and **absent from our evidence store** — our topic-clustered agents left a guidelines gap
  no single agent owned. The baseline, holding the whole question, hunted more broadly. This is a
  real process lesson: **fan-out by topic can under-cover vs a single broad agent** unless one stage
  explicitly owns completeness.

## Where Epistack genuinely wins

1. **Provenance & symmetric COI (the cleanest win).** The baseline cites the DIABEGG RCTs
   (Australian Egg Corporation-funded) and repeats the industry-favorable mechanistic reassurance —
   *"the extra LDL tends to be the larger, more buoyant (less atherogenic) particle"* — **without
   noting that this framing comes largely from egg-industry-funded work.** It never mentions the
   funding-bias literature at all (Barnard: 49% vs 13% discordant conclusions; Lesser OR 7.61).
   Epistack flags every 🥚 node, carries the 🌱 counter-COI (PCRM), and shows via **COI-cluster
   ablation** that the LDL physiology survives *without* any industry study — so it can say "this
   particular reassurance is industry-sourced" while still trusting the underlying physiology. The
   baseline can't separate those.
2. **Interrogability.** You can point at `zhong-2019` in our graph, read its receipt, see it's the
   load-bearing harm node, and watch the conclusion move when it's ablated. The baseline's reasoning
   is real but **welded shut** — to challenge one claim you must re-read and re-derive the whole thing.
3. **Auditable coverage.** Ironically, the baseline *beat* us on coverage — but you can only *know*
   that because our store is an explicit, enumerable list of nodes you can diff against. You cannot
   diff two narratives for what's missing. The graph makes its own gaps visible (which is how we
   caught that we lack ESC/ADA).

## What this means for the project (the load-bearing takeaway)

**The wedge is not "better answers."** A strong deep-research narrative already nails the facts,
the cruxes, and the calibration. A submission pitched as *"we reason better than deep research"*
is, on this evidence, **a losing bet** — the baseline is too good.

The defensible pitch is: **"we make the answer provenance-checked, COI-aware, interrogable, and
extensible — and we make its coverage auditable."** Those are properties of the *artifact and the
process*, not of the prose. Concretely, the three things worth building are exactly the three
Epistack wins above, plus one the comparison exposed:

- COI/provenance as a first-class, machine-checkable layer (baseline can't do it);
- node-level interrogability + ablation (baseline can't do it);
- **a completeness-critic stage** — because a *single* broad agent out-covered our *five* topic-clustered
  ones. Fan-out needs an explicit "what's missing?" pass, or it silently under-covers.

This comparison is itself an argument for the method: it was only trustworthy because the baseline
was run **blind**, the criteria were **pre-registered**, and the losses were **reported**. That
discipline — not a better egg answer — is the product.
