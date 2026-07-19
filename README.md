# Epistack

**Can we build a reliable supply chain for truth?**

Epistack is an early-stage project exploring the best workflows and methodologies for using AI to produce reliable, trustworthy knowledge bases grounded in real-world cases.

The central idea is simple:

> Ask a difficult question, and Epistack turns it into a structured, sourceable map of what must be true, what the evidence shows, where uncertainty remains, and what would change the answer.

The project is currently in the methodology and prototype-design phase.

The current vertical slice is organized as a small case workspace rather than one long report. A submitted paragraph is first annotated phrase by phrase, then moved into a separate editable Interpretation Map. Evidence, Assess, and Synthesize remain separate routes, with dedicated Trial Inventory and Discovery Queue views. This keeps wording analysis, source inspection, unassessed intake, and conclusions from collapsing into an overwhelming scroll.

## The problem

Off-the-shelf deep-research systems are increasingly good at finding sources and producing fluent, cited reports. But a well-cited report can still be wrong in important ways:

- the cited source may not establish the attached claim;
- the study may measure a poor proxy for the construct being discussed;
- similarly named interventions may be too different to aggregate;
- complex analyses may conceal a simpler null result;
- sources may share data or assumptions and therefore not be independent;
- contradictory evidence or stakeholder perspectives may be missing;
- the conclusion may depend heavily on one weak source; or
- a retraction or correction may never reach downstream reports.

Epistack treats these as structural problems, not prose-quality problems.

## The product thesis

Epistack is an **epistemic compiler**, not an answer engine.

```text
Vague question
    ↓
Scoped interpretations and definitions
    ↓
Claims, subclaims, assumptions, and dependencies
    ↓
Evidence supporting, challenging, or qualifying each claim
    ↓
Provenance, measurement, methodology, and entailment checks
    ↓
Cruxes, gaps, competing hypotheses, and sensitivity tests
    ↓
A versioned, interrogable knowledge base
```

The final narrative answer is one view over that underlying artifact.

## Proposed workflow

### 1. Frame the investigation

Specify the decision or understanding being sought, plausible interpretations, relevant populations, time periods, jurisdictions, definitions, and scope boundaries.

### 2. Construct the claim graph

Break the question into claims precise enough to investigate. Record relationships such as:

- `depends on`
- `supports`
- `challenges`
- `qualifies`
- `assumes`
- `generalizes`
- `provides mechanism for`

Keep empirical claims, predictions, causal claims, definitions, and normative judgments distinct.

### 3. Construct the evidence graph

For every relevant source, retain the exact passage, table, figure, dataset, or result; its provenance; the claim it bears on; and whether it supports, challenges, qualifies, or merely contextualizes that claim.

Assess, where applicable:

- artifact integrity;
- claim-evidence entailment;
- construct and measurement validity;
- study design and statistical analysis;
- effect magnitude and practical importance;
- population and scope match;
- source independence;
- conflicts of interest; and
- transportability to the present question.

### 4. Run structured adversarial checks

Use named procedures rather than a generic “critic” prompt:

- competing-hypothesis analysis;
- key-assumptions checks;
- disconfirming-evidence search;
- source-quality and provenance audits;
- measurement and construct review;
- missing-perspective search;
- claim-citation entailment verification; and
- dependency and double-counting detection.

### 5. Synthesize explicitly

Distinguish what is well supported, weakly evidenced, genuinely contested, dependent on definitions or values, and currently unknown. Preserve disagreements among defensible assessment policies.

### 6. Test sensitivity

Remove or alter important sources, assumptions, or weighting decisions and observe whether the conclusion remains stable, weakens, or reverses. Use this to identify load-bearing evidence and high-value research gaps.

### 7. Publish a reusable artifact

Produce a versioned package that another investigator can inspect, challenge, extend, or recompute. Narrative reports and visualizations should be generated from this structured package.

## Candidate artifact model

The initial schema is expected to include:

| Object | Purpose |
|---|---|
| Question | Original prompt, scope, decision context, and alternative interpretations |
| Construct | Defined concept and possible operationalizations |
| Claim | Atomic proposition with type, scope, and status |
| Relationship | Logical, causal, evidential, or contextual connection between objects |
| Evidence item | Exact source fragment or data object bearing on a claim |
| Source | Provenance, authorship, publication, funding, and revision metadata |
| Assessment | Attributed judgment made under an explicit evaluation policy |
| Challenge | Rebuttal, counterexample, competing hypothesis, or methodological concern |
| Gap | Missing information and its expected decision relevance |
| Synthesis | Conditional conclusion with uncertainty and decision implications |
| Revision | History of changes and affected downstream objects |

This schema is provisional. It should evolve through real investigations rather than be designed entirely in the abstract.

## What should make Epistack better than deep research?

A strong baseline can retrieve and summarize. Epistack must additionally answer:

- Which claims are doing the most work?
- Which evidence actually supports those claims?
- Does the cited material entail the claim, or is it merely related?
- What conflicting evidence was found?
- What assumptions connect the evidence to the conclusion?
- How were sources weighted, and under which policy?
- What remains unknown?
- What evidence would most likely change the answer?
- If a source were removed or discredited, what downstream conclusions would weaken?

The aim is not a longer report. It is a more inspectable and resilient reasoning process.

## Evaluation

Every substantive workflow should be compared against strong baselines on the same real-world sub-question, including off-the-shelf deep research and a careful AI-assisted investigation.

Evaluation should include:

1. **Epistemic uplift** — better reasoning, calibrated uncertainty, visible cruxes, and load-bearing evidence.
2. **Generalizability** — performance across curated debates, confident answers with complex evidence, and mundane-but-contested questions.
3. **Compounding and shareability** — structured artifacts that other investigators can extend or combine.
4. **Scalability** — gains from better models, more compute, more sources, and more contributors.
5. **Methodological transparency** — a workflow specific enough to replicate and criticize.
6. **Adversarial robustness** — resistance to motivated sources, strategic framing, and differing user priorities.
7. **Insight contribution** — discovery of new failure modes, framings, or tradeoffs.

Useful evaluation methods may include blinded expert comparison, claim-level citation audits, planted-adversary tests, evidence-ablation tests, cross-investigator extension exercises, and update-propagation drills.

## Design principles

- **Evidence before eloquence.** Fluency is not evidence quality.
- **Preserve the chain.** Do not collapse observations, interpretations, and conclusions into one object.
- **Expose judgment.** Assessments must be attributable and governed by explicit policies.
- **Represent uncertainty structurally.** Do not hide it in prose disclaimers.
- **Prefer precise disagreement to superficial consensus.**
- **Do not confuse replication with meaning.** A replicable result may still be trivial or misframed.
- **Do not aggregate before checking comparability.**
- **Make artifacts reusable by humans and machines.**
- **Design for revision.** Corrections must propagate through dependencies.
- **Evaluate against strong baselines.** The bar is meaningful improvement, not novelty alone.

## Non-goals

Epistack is not intended to be:

- an oracle that assigns universal truth scores;
- a generic search or citation product;
- a fully automated replacement for expert judgment;
- a single evidence hierarchy imposed across every domain; or
- a mechanism for resolving empirical, interpretive, and moral disagreement into one number.

## Documents

- [Vision](./vision.md) — the long-term purpose, principles, and theory of change.
- [Reference case studies](./case-studies.md) — why the motivating examples matter and what they require from the system.
- [Product and data architecture](./architecture.md) — the proposed web-app shape, provenance model, persistence, and latency strategy.
- [Question-compilation methodology](./methodology/question-compilation.md) — the first specified human–AI operator.
- [Evidence-ingestion methodology](./methodology/evidence-ingestion.md) — discovery, screening, extraction, verification, and assessment states.
- [Runnable question compiler](./app/README.md) — the first eggs-case interaction prototype.
- [Evidence corpus](./app/data/eggs-weight-corpus.ts) — claim-matched extractions and the 32-publication trial inventory.
- [PubMed discovery artifact](./app/data/pubmed-discovery.json) — 164 machine-discovered records kept separate from assessed evidence.

## Near-term direction

The next phase should test the workflow on several differently shaped cases:

1. a curated debate containing explicit opposing positions;
2. a confident public answer resting on complex scientific evidence; and
3. a mundane but contested practical question.

For each case, we should produce a baseline report, an Epistack artifact, an adversarial audit, and an evaluation showing where the structured workflow materially changed the reasoning.
