# Evidence ingestion methodology

This operator turns a compiled claim into an auditable evidence corpus. Its output is not a narrative answer and not an undifferentiated pile of search results.

## Input

A concrete claim with explicit population, intervention or exposure, comparator, outcome, time horizon, and decision context.

For the first case:

> Among adults with overweight or obesity pursuing weight loss, does consuming two whole hen eggs at breakfast at least five days per week instead of an energy-matched egg-free breakfast, while following an energy-restricted diet, cause greater weight loss?

## Evidence states

Every record must occupy one visible state:

1. **Discovered** — matched a documented search, citation trail, or source recommendation.
2. **Retrieved** — source content or a sufficient primary record was obtained.
3. **Screened** — a human or model applied the claim-specific inclusion criteria and recorded a reason.
4. **Extracted** — one or more results were mapped to a claim with an exact locator.
5. **Verified** — a reviewer checked the source identity, extraction, numbers, and claim relationship.
6. **Assessed** — methodological and provenance dimensions were evaluated under a named policy.

Discovery never directly changes a belief. Search ranking, citation count, institutional prestige, and fluent abstracts are not substitutes for the later states.

## Acquisition procedure

### 1. Establish a review spine

Find the newest credible systematic review whose inclusion criteria substantially overlap the compiled claim. Import its search dates, protocol or registration, study inventory, risk-of-bias judgments, effect estimates, exclusions, and limitations.

The spine provides coverage and a falsifiable account of what was searched. It does not receive automatic authority: its extraction and synthesis can themselves be challenged.

### 2. Search forward and sideways

Run reproducible searches for:

- studies published after the review’s last search date;
- exact claim language and close PICO variants;
- trials cited by the review;
- trials citing the review or key primary studies;
- replications and contradictory studies;
- protocols, registrations, corrections, retractions, datasets, and analysis code;
- mechanistic studies bearing on a load-bearing causal link; and
- funding and conflict disclosures.

Store the exact query, database, time, result count, and returned identifiers.

### 3. Resolve identity and deduplicate

Prefer DOI, PMID, PMCID, trial registration, and dataset identifiers over titles. Link multiple reports of the same trial and separate papers that reuse a cohort or dataset. A paper count is not an independent-evidence count.

### 4. Screen against the compiled claim

Record inclusion, exclusion, or contextual-only status. A study can be methodologically strong but indirect because the population, comparator, dose, outcome, or time horizon differs.

### 5. Extract claim-bearing results

Create an evidence item for each relevant result, retaining:

- source identifier and exact table, figure, section, page, or passage locator;
- population and analyzed sample;
- intervention, comparator, co-interventions, and adherence;
- outcome definition and measurement time;
- effect estimate, uncertainty interval, and analysis population;
- whether the result was primary, secondary, exploratory, or unplanned;
- relationship to the claim: support, challenge, qualify, or context; and
- extractor, verifier, timestamp, and revision.

### 6. Assess without collapsing dimensions

Keep separate judgments for randomization, allocation concealment, blinding where possible, missingness, selective reporting, measurement validity, statistical analysis, directness, independence, data access, registration, funding, and conflicts. A single “quality score” hides why two reviewers disagree.

### 7. Synthesize around cruxes

Before producing a probability, identify which evidence and assumptions are load-bearing. For eggs and weight loss, current cruxes include comparator composition, substitution versus addition, persistence of acute satiety effects, adherence under energy restriction, and how much high risk of bias should discount positive results.

## Current corpus

The prototype currently includes:

- the 2023 Emrani et al. systematic review as a registered review spine;
- 32 controlled-trial publication records transcribed from its study table;
- 11 deeper source records selected for directness, contradiction, mechanism, or methodological context; and
- 164 PubMed discoveries from a saved, rerunnable query.

The 164 discoveries remain an intake queue. They have not all been screened or extracted and therefore do not count as 164 pieces of supporting evidence.

## Stopping rule

Stop a retrieval pass when all of the following are true:

- the review spine and forward update are complete to the declared date;
- key positive and negative evidence has been source-verified;
- searches for corrections, retractions, registrations, and shared datasets are complete;
- additional searches mainly return duplicates or studies that miss a recorded claim dimension; and
- the remaining uncertainty is better described as a research gap than a retrieval gap.

Reopen the corpus when a source changes, the claim scope changes, or the update horizon expires.

## Failure modes

- **Search-result laundering:** treating a matching title or abstract as evidence.
- **Abstract-only extraction:** missing attrition, outcome switching, subgroup status, or conflicts in the full text.
- **Comparator collapse:** calling cereal, bagels, no breakfast, and energy-matched protein meals the same control.
- **Duplicate independence:** counting multiple reports or reused cohorts as independent evidence.
- **Industry-blind scoring:** ignoring funding, or rejecting an industry-funded result solely because of funding.
- **Outcome substitution:** using acute hunger or lunch intake as though it were demonstrated long-term weight loss.
- **Silent scope drift:** importing evidence about cholesterol or general health into a weight-loss claim without an explicit new claim.

