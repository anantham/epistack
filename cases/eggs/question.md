# Eggs — Question decomposition (v0)

*The first artifact of the slice: turn one vague paragraph into a bounded, prioritized
space of concrete framings. Every axis and option below is a **proposal** — the human
edits it, and edits reshape everything downstream. This is the collaborative surface.*

## Raw input (as a user would actually type it)

> "Are eggs good to eat? How many should I eat? I keep hearing they're full of
> cholesterol but also that they're the perfect protein. Should I just have eggs for
> breakfast every day?"

## The vague question is really a family of questions

Four axes of ambiguity. The cross-product is enormous — we do **not** enumerate it.

### A. What is "an egg"? (the exposure)
- production: caged/broiler-adjacent | free-range | pasture-raised — **usually unrecorded in studies**
- whole egg | white only | yolk; standard | omega-3 fortified
- fertilized vs not — nutritionally ~negligible → low priority
- cooking + carrier: boiled vs fried-in-butter; **eaten alone vs with bread/bacon**
- *Meta-uncertainty:* most evidence does not record production method or the hen's diet.
  Record as `unknown` on a spectrum. Notice it; do **not** over-discount on it.

### B. What is "eat"? (dose, pattern)
- dose: 0 | <1/day | **~1/day** | 2/day | ≥3/day
- **what it displaces — the substitution variable:** nothing | refined carbs | other protein
- co-consumption bundle (the "eggs + toast + bacon" pattern)

### C. "Good" for *what*? (the outcome)
- CVD events / all-cause mortality  ·  LDL-C / ApoB (surrogates)
- weight / satiety  ·  muscle / protein quality  ·  energy / micronutrients (choline)

### D. For *whom*? (population)
- **healthy, non-diabetic, normolipidemic adults** (default)  ·  diabetics
- hyper-responders / ApoE4 carriers  ·  by age, sex, genetics, baseline diet, geography

## Prior over framings

We assign a prior over the framings **people actually mean** and let evidence + real-world
commonness concentrate it — rather than tiling A×B×C×D.

**Prior policy (v0): max-entropy / uniform**, with two documented exceptions we already
accept as near-settled (this is where common sense / time-tested tradition will eventually live):
- "enough eggs to be a meaningful protein source is fine for most healthy people" → **high prior**
- "eggs are acutely toxic" → **~0 prior**

Everything else starts uniform and updates as evidence arrives. *(TODO: later encode base
rates and tradition into a non-uniform informed prior.)*

## Attractive states (investigated first)

Common, high-traffic framings — what people usually mean. The expansion heuristic starts here.

- ★ **F1 — "~1 egg/day, with a normal breakfast, healthy adult — does it hurt my heart?"** ← **THIS SLICE**
- ★ F2 — "eggs for weight loss / satiety"
- F3 — "eggs for muscle / protein quality"

## This slice: framing F1

> *In healthy (non-diabetic, normolipidemic) adults, does eating ~1 whole egg/day
> chronically raise cardiovascular disease risk?* — comparator initially **unspecified**
> (the slice will show that the comparator is the crux).

**Why F1 first:**
1. it's an attractive state (what most people mean by "should I eat eggs?");
2. it has a **genuine live disagreement** in the literature (2019 *JAMA* vs 2020 *BMJ*),
   so crux-value is high — investigation can actually move the answer;
3. it exposes the **substitution-variable crux**, which generalizes to F2 and F3.

## Standing notes for the whole slice
- Evidence conditions are spectrum-valued with explicit `unknown`s; noticed, not over-weighted.
- Decision-first: the report leads with the answer + scope + confidence + cruxes; the graph is underneath.
- Living document: every source carries a URL; re-evaluations propagate to dependents.
