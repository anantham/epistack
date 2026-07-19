# Eggs / F1 — Should a healthy adult worry about ~1 egg/day and their heart?

*Decision-first view over [`evidence.md`](./evidence.md). Read top to bottom; the graph is
underneath the answer, not in front of it. Source IDs (e.g. `zhong-2019`) link to the store.*

---

## 1 · The answer

For a **healthy, non-diabetic, normolipidemic adult**, eating **~1 egg/day carries no reliable
association with cardiovascular events.** It modestly raises LDL-C (**~+8 mg/dL** on average
[`li-kang-2020`, `umbrella-2025`], more in the ~30% who are hyper-responders [`fernandez-hyperresponders`]),
but whether that small bump matters depends mostly on **what the egg replaces**: worse than
nuts/legumes/fish, neutral-to-better than processed meat or a refined-carb breakfast
[`zhuang-2021`, `drouin-chartier-2020-bmj`]. Net: a reasonable food in moderation for this
group — **not a health imperative, not a meaningful hazard.**

## 2 · Scope of that answer
Healthy non-diabetic normolipidemic adults · ~1 egg/day, chronic · **hard CVD endpoints, not
LDL alone.** Outside this scope the answer changes (see §7 diabetes, §8 hyper-responders).

## 3 · Confidence: **LOW–MODERATE**
- Recent meta-analyses converge on **null** for CVD & mortality [`godos-2021`, `krittanawong-2021`,
  `mousavi-2022`, `umbrella-2025`] — **but the 2025 umbrella review rates the underlying reviews
  "critically low" quality (AMSTAR-2).** Convergence on null ≠ strong evidence of null.
- **No long-term hard-outcome RCT exists** or can ethically be run. Everything rests on
  observational data (confounded) + short surrogate-outcome RCTs.
- The *physiology* (eggs raise LDL) is **settled**; the *hard-outcome translation* is not.

## 4 · The cruxes — what the disagreement is actually about
The studies don't really disagree on the data. They disagree on three things no egg study can settle:

1. **Comparator — "eggs vs *what*?"** [`zhuang-2021`]: swapping ½ egg/day for nuts/legumes = **−13%**
   mortality; for fish/poultry = −7–9%. The question is underspecified until you name the counterfactual.
2. **Do you trust observational adjustment?** US egg-eaters eat **5× more bacon** at equal BMI, the
   association can *vanish* when bacon is modeled, and its **sign flips** — harmful in US cohorts
   [`zhong-2019`], protective in China [`china-kadoorie-2018`] — because egg intake tracks opposite
   healthy-user profiles [`kolb-dimarco-2023`]. `ioannidis-2018`: "noise is much stronger than the signal."
3. **Your own responder status / subgroup** (§7–8).

## 5 · What would change the answer
- A large long-term **hard-outcome RCT** (won't happen — can't randomize diet for a decade).
- Being **diabetic, FH, or a hyper-responder** → shifts toward caution.
- **Your personal LDL response** to eating them — measurable at home, captured by *no* cohort.

## 6 · Load-bearing evidence — dependence-aware ablation
*Remove a node (or a dependent cluster) and recompute. What actually carries the conclusion?*

- **Remove `zhong-2019`** → the "eggs raise CVD" reading loses its main recent pillar; the picture
  goes from *contested* to *leaning null*. **Single most load-bearing node on the harm side.**
- **Shared-assumption ablation (healthy-user bias)** → the US cohorts [`zhong-2019`, `zhuang-2021`,
  `zhao-2022`] all lean on the same un-removable confounder. Ablating the *cluster* (not one study)
  is what matters — removing any one leaves the others, manufacturing false robustness. The
  sign-flip vs China [`china-kadoorie-2018`] is the tell that the cluster shares a bias.
- **COI-cluster ablation** → drop every egg-industry-funded node [`vincent-2019`, `blesso-2013`,
  `katz-njike-2015`, `kolb-dimarco-2023`, `diabegg`] and the **LDL-rise conclusion survives** on
  independent evidence [`weggemans-2001`, `li-kang-2020`]. So the physiology isn't industry-manufactured;
  the industry literature differs in *framing* ("modest"), not direction. Symmetric: dropping the
  anti-egg node [`barnard-2021`, PCRM] doesn't move the physiology either.

## 7 · The diabetes boundary (why we scoped it out — and it's real)
Across designs, eggs associate with **harm specifically in people with/developing diabetes** even
where the general estimate is null: `shin-2013` CVD-in-diabetics **1.69**, `li-2013` **1.83**,
`djousse-2008` mortality **2.01**, `jang-2018` T2DM CVD **2.81**. **But** the one RCT — `diabegg`
(egg-industry-funded) — found **no lipid harm** from 12 eggs/week in T2D. Reading: the diabetes
signal is an **observational-cohort association a lipid-endpoint RCT does not reproduce** → most
likely confounding (US diabetic dietary patterns), not a lipid mechanism. Decision **D1 (scope out
diabetics)** was correct — the effect genuinely lives on the other side of that line.

## 8 · What "eggs & heart disease: null" hides
Two non-null signals sit *inside* the same reviews that headline "no CVD association":
- **Heart failure** ~**1.15** [`godos-2021`, `umbrella-2025`].
- **Cancer mortality** ~**1.13–1.20** [`mousavi-2022`, `umbrella-2025`].
A narrative answer drops these to tell a clean story. The graph keeps them flagged as open, lower-confidence branches.

## 9 · Beyond the heart (F2–F5, briefly)
- **Weight/satiety** — real, *only under caloric restriction* [`vander-wal-2008`]; a 2022 crossover found the satiety edge null [`satiety-null-2022`]. Conditional, not general.
- **Muscle** — whole-egg MPS edge is real but confounded by extra fat, acute, n=10 [`van-vliet-2017`]; one egg's leucine is modest [`diaas-2024`].
- **TMAO** — the scary pathway is real [`tang-2013`, HR 2.54] but **mostly doesn't fire for whole eggs** [`tmao-wilcox-2021`]; supplements do.
- **Choline** — genuine benefit; only ~8% of US adults meet the AI [`choline-2017`].
- **Salmonella** — ~1/20,000 eggs; cook to 71°C [`salmonella-fda`].

## 10 · Provenance & COI ledger (symmetric)
- `🥚` egg-industry: `vincent-2019`, `blesso-2013`, `katz-njike-2015`, `diabegg`, `kolb-dimarco-2023`, `diaas-2024`, `choline-2017`.
- `🌱` anti-egg advocacy: `barnard-2021` (PCRM).
- `💊` pharma-platform: `pure-2020`.
- **Independent anchors** that settle the physiology: `weggemans-2001`, `li-kang-2020`.
- Funding→conclusion bias is quantified, not alleged: `barnard-2021` (49% vs 13% discordance), `lesser-2007` (OR 7.61), `mandrioli-2016` (RR 7.36).

## 11 · Delta vs the deep-research baseline
A strong deep-research answer says *"cohorts and meta-analyses find up to 1 egg/day isn't linked to
CVD in healthy people; 2019 JAMA found a dose-response risk; diabetics may be higher-risk; individuals
vary."* Decent. What this artifact adds:
1. **The comparator crux** the narrative buries (*eggs vs what* flips the sign) — with numbers.
2. **Localizes the disagreement** to a methodological belief (trust in observational adjustment), so the reader knows more egg studies won't settle it.
3. **Ablation names the load-bearing node** (`zhong-2019`) and shows the LDL physiology survives a COI-cluster ablation — so neither industry nor advocacy is driving it.
4. **Surfaces the hidden HF & cancer-mortality signals** inside the "null."
5. **Every number is traceable** to a URL + a confidence flag; the linchpin is self-verified.

---

*Status: F1 wired. Open threads for the graph — the HF/cancer branches (§8) are logged but
lightly investigated; the non-CVD framings (§9) are ingested but not yet fully wired; funding/COI
is captured but not yet quantified into edge weights.*
