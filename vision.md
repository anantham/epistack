# Epistemic Stack

## A reliable supply chain for truth

It is becoming harder to know what is real, what is true, and what deserves our confidence.

Information is abundant, but the chain connecting a conclusion to its evidence is usually fragmented, hidden, or prohibitively expensive to reconstruct. A polished report may cite reputable sources while concealing weak measurements, incomparable studies, unsupported inferential steps, missing perspectives, or evidence that does not actually establish the claim attached to it.

AI is accelerating this problem. It can produce persuasive prose faster than people can check it, repeat errors across thousands of downstream outputs, and make uncertain conclusions appear settled. But AI also makes a solution possible for the first time: much of the labor required to inspect, structure, challenge, and maintain knowledge can now be automated.

Epistack is an effort to build that infrastructure.

> Epistack turns difficult questions into inspectable maps of claims, evidence, assumptions, disagreements, and dependencies.

It is not a machine that declares truth. It is a system for making the basis of a conclusion visible, contestable, reusable, and responsive to new information.

## The vision

Given a broad or ambiguous question, Epistack helps a person discover what the question depends on, explain their actual circumstances, and commission investigations that can change their understanding or choice. The person should not need to know the right scientific vocabulary, source database, or research design before starting.

The practical ambition is to move from “Are eggs good to eat?” to an inspectable basis for deciding how many eggs to eat, what they would replace, and where to purchase them if sourcing matters to this person. Eggs are a test case for a general workflow, not the boundary of the product. Questions of understanding may end in an explanation of disagreement rather than an action recommendation.

### Three stages, followed by an artifact

These are the user-facing stages. Specialist calls inside a stage and engineering delivery phases are separate concepts.

| Stage | Purpose | Output handed to the next stage |
|---|---|---|
| **1. Decompose** | Expose the dimensions hidden inside a vague question: meanings, outcomes, choices, comparisons, populations, and uncertainties. | An editable dimension map, with rationale, candidate interpretations, missing details, and evidence requirements. |
| **2. Contextualize** | Interview the person to learn which dimensions matter here, their actual circumstances, feasible alternatives, constraints, and preferences. | A human-reviewed research brief: explicit context, action options, scoped claims, applicability requirements, and unresolved questions. |
| **3. Investigate** | Assign scoped agents to seek relevant, conflicting, and contextual information; acquire and examine sources using methods appropriate to their class. | Claim-linked findings with typed payloads, provenance, verification state, applicability, disagreements, and remaining gaps. |

The **Artifact** is the fourth workspace destination. It brings these outputs together into an inspectable, revisable account of what the person can conclude or do, why, and what would change that conclusion.

### 1. Decompose: discover what could matter

“Good” might mean nutritional adequacy, cardiovascular outcomes, convenience, affordability, animal welfare, or environmental effects. “Eat” leaves quantity, frequency, preparation, and replacement foods unspecified. These dimensions are possibilities to review, not facts about the person or conclusions about eggs.

Exact wording is useful evidence for an interpretation, but it must not be the admission rule for a dimension. Missing concepts can be precisely what a vague question needs help uncovering. Preserve both **explicitly cued** and **inferred missing** dimensions, label their origins, and let the person edit or park them. Never invent a quote to justify an inferred dimension.

Decomposition should produce enough breadth to avoid early tunnel vision without expanding every possible combination. A dimension deserves attention when it could change the meaning, evidence match, feasible choices, or eventual decision.

### 2. Contextualize: learn what matters for this person

The interview turns candidate dimensions into specific context. Ask questions because the answers change the investigation: current intake, preparation, realistic substitutes, relevant health circumstances, priorities, time horizon, budget, and location when local purchasing is part of the decision. Explain that relevance in ordinary language.

Do not ask for a full personal dossier. Reuse supplied answers, allow free text and “I don't know,” and distinguish observed facts, preferences, hard constraints, and model assumptions. A suggested answer becomes personal context only when the person supplies or confirms it.

The output is a research contract, not just a longer paraphrase. Every material answer should be traceable to a claim, an applicability check, a feasible option, a monitored unknown, or an explicitly parked dimension. No selected dose, comparator, or constraint should silently disappear at compilation. Unknown details remain unknown, with a reason to ask later if they become decisive.

Personalization should guide both retrieval and interpretation. Some details define the research question; others help assess broader evidence after retrieval. Putting every personal detail into every search query can exclude useful evidence. Outbound context should be minimized and its destinations made explicit; a browser-stored profile is not device-only if it is sent to a hosted compiler or agent.

### 3. Investigate: commission work from the brief

Agent assignments should be derived from the scoped claims and the person's context. Each task should carry its claim and brief version, population/exposure/comparator/outcome and horizon where applicable, permitted applicability context, retrieval and exclusion rules, lane purpose, expected output, and budget or stopping condition. Other domains should use suitable scope fields rather than being forced into a clinical-trial template.

The intended discovery unit is **claim × useful lane**: broad/disconfirming search, applicability search, or context search. Allocate enough agents to cover consequential questions, while allowing inapplicable lanes to be skipped with a reason. Agent count is a means; useful coverage and decision relevance are the outcome.

Keep independent concepts independent:

- **Discovery lane:** why and where we looked.
- **Source class:** what we found—a study, review, guideline, standard, registry, statistic, preprint, report, or first-person account.
- **Acquisition and verification state:** what was actually obtained and checked.
- **Epistemic role:** what this particular finding can establish about the scoped claim.

A guideline may inform recommended practice; a registry may expose an unpublished study; a statistic may describe a population; a first-person account may reveal a practical obstacle or a hypothesis to investigate. None automatically establishes a causal health effect. Similarly, a primary study or systematic review is not automatically causal: its design, result, and relation to the claim determine that judgment.

Use a common provenance and claim-link envelope with class-specific payloads. A recommendation, measured effect, registry status, statistic, and context signal should retain their different meanings and limitations. Cited material that could not be acquired stays visibly unverified. Context-only signals cannot promote into accepted outcome evidence.

Progress should show actual work: queued, searching, acquiring, extracting, checking, complete, failed, or deliberately skipped, with saved outputs and reasons. A failed search must not look like “no evidence,” and several links to one source must not look like independent corroboration. Research may reopen a dimension or trigger a targeted follow-up interview when it uncovers something decision-relevant.

### The artifact: an inspectable basis for a choice

For an eggs investigation, the desired decision view would connect:

- **The person's situation:** confirmed intake, preparation, alternatives, constraints, priorities, and unknowns.
- **Concrete options:** specified quantities or substitutions, with the assumptions needed to compare them.
- **Evidence and guidance:** what bears on each option, its scope, provenance, limitations, and confidence.
- **Purchasing considerations, when requested:** actual location, cost, availability, safety, certification, welfare, or environmental criteria, each backed by the appropriate source and date.
- **Decision sensitivity:** what would change the preferred option, which gaps matter, and when to reconsider.

This is an output specification, not a recommendation about egg consumption. The system must be able to say that it cannot yet justify a quantity or compare vendors. A sourcing preference should not be converted into a health benefit without evidence, and a general health review should not imply that it has researched local purchasing options.

Every claim is connected to the evidence that supports, challenges, or qualifies it; the context in which that evidence should be interpreted; and the other claims on which it depends.

The result is not merely a report with citations. It is a living evidence graph:

```text
Question
  -> interpretations, definitions, and scope
  -> claims, subclaims, and assumptions
  -> supporting, challenging, and contextual evidence
  -> provenance, measurement, and methodology
  -> rebuttals, gaps, and competing hypotheses
  -> assessments under explicit evaluation policies
  -> conclusions and decision implications
```

On top of this shared foundation sit assessment layers. Some can encode established methods from science, journalism, law, intelligence analysis, or evidence-based medicine. Others can be created by communities or individual users. These layers make their criteria explicit, allowing people to disagree about how evidence should be weighed while still sharing an underlying record of claims, sources, and reasoning.

Claims are not flattened into simply `true` or `false`. A claim may be:

- well supported within a defined scope;
- plausible but weakly evidenced;
- contested by credible evidence;
- dependent on a disputed assumption;
- underspecified or operationalized inconsistently;
- unsupported by the cited material;
- not yet adequately investigated; or
- normative rather than empirically resolvable.

When disagreement is genuine, Epistack should show exactly where it lies: in the evidence, the interpretation of that evidence, the assumptions connecting it to a conclusion, the values applied to a decision, or the confidence different assessors require.

## From citations to epistemic provenance

A claim-to-citation link is necessary, but it is not enough. Reliable knowledge requires a chain that reaches further in both directions.

```text
Question framing
  -> construct definition
  -> claim decomposition
  -> artifact provenance and integrity
  -> measurement validity
  -> claim-evidence entailment
  -> statistical and methodological validity
  -> transportability and context
  -> synthesis and sensitivity
  -> decision implications
  -> continuous revision
```

A paper may be correctly cited but contain a manipulated image. A study may be statistically sound but measure the wrong construct. Several trials may share an intervention label while implementing materially different programs. A result may replicate while being too small or too narrow to justify the importance claimed for it. A synthesis may represent the available literature accurately while omitting a stakeholder's decisive value or an adversary's strongest hypothesis.

Epistack therefore treats observations, interpretations, assessments, and conclusions as separate objects. Each transition between them is an inspectable act of judgment.

## The unit of value is an epistemic artifact

The primary output is not the final answer. It is a versioned, interrogable package that another investigator can inspect and extend.

An Epistack artifact should contain:

- the original question and its scoped interpretations;
- definitions of important constructs and terms;
- atomic claims and their logical or causal dependencies;
- source-level evidence with precise passages, tables, figures, or data;
- provenance and artifact-integrity information;
- relationships such as `supports`, `challenges`, `qualifies`, `depends on`, and `assumes`;
- assessments of relevance, entailment, methodology, measurement, independence, and transportability;
- alternative explanations and competing hypotheses;
- unresolved gaps and the expected value of further research;
- a synthesis with calibrated uncertainty;
- sensitivity results showing which evidence and assumptions are load-bearing;
- attribution, revision history, and machine-readable exports.

Narrative reports, briefs, visualizations, and answers can be generated from this package. They are views over the knowledge base, not substitutes for it.

## Making load-bearing evidence visible

Most research products list evidence but do not reveal its influence. Epistack should make clear which claims and sources actually drive a conclusion.

One method is **evidence ablation**: remove a source, a claim, or a cluster of dependent evidence and recompute the synthesis. If the conclusion changes substantially, that dependency is load-bearing. If removing a supposedly decisive source changes nothing, the source may be receiving rhetorical attention without evidential influence.

Sensitivity analysis can also vary:

- contested definitions;
- assumptions about source independence;
- methodological quality thresholds;
- plausible effect sizes;
- transportability judgments;
- evidence-weighting policies; and
- stakeholder values or risk tolerances.

The goal is not false numerical precision. It is to expose where the conclusion is stable, where it is fragile, and what new information would most change it.

## Designed for disagreement

Epistack must remain useful when participants have different beliefs, incentives, and priorities.

That requires more than asking an AI system to provide a balanced answer. The workflow should use explicit adversarial methods to:

- generate and compare competing hypotheses;
- search for disconfirming evidence;
- identify hidden assumptions;
- distinguish absent evidence from evidence of absence;
- detect dependencies among apparently independent sources;
- test whether cited material entails the attached claim;
- separate empirical disputes from disagreements about values;
- represent minority or inconvenient perspectives without manufacturing false balance; and
- record uncertainty about the analysis itself.

An assessment should be attributable to an assessor and a stated policy. No score should acquire authority merely because it appears in the system.

## Knowledge that updates

Today, conclusions become detached from their foundations. A study is retracted, a dataset is corrected, a measurement instrument is challenged, or a causal assumption stops fitting the world, but downstream reports remain unchanged.

Epistack preserves dependency relationships so that revisions propagate. When a source or assessment changes, the system can identify every dependent claim, synthesis, and decision that may need review.

This creates the possibility of knowledge bases that compound rather than expire:

- new evidence extends existing investigations;
- challenges improve shared artifacts rather than starting new documents from scratch;
- methods can be compared on the same underlying evidence;
- multiple teams can work on different parts of a question;
- better models can rerun old checks and reveal previously missed problems; and
- the cost of answering related questions falls as the graph grows.

## Why now

Historically, this work required prohibitive human labor. It demands close reading, source retrieval, data extraction, methodological criticism, adversarial search, ontology design, and continuous maintenance.

AI can now assist with each of these operations. As models improve and more compute or contributors are added, the system can search more widely, decompose more carefully, run more adversarial checks, inspect more artifacts, and revisit more judgments.

The design should benefit from improving models without making model authority the foundation of trust. Trust should come from inspectable evidence, explicit procedures, provenance, contestability, and demonstrated performance against strong baselines.

## How we judge ourselves

Epistack succeeds only if it helps thoughtful people reason materially better than they could with an off-the-shelf deep-research system or a careful, top-tier AI-assisted investigation.

We evaluate work along seven dimensions:

1. **Epistemic uplift** — Does it improve reasoning, expose load-bearing evidence, preserve uncertainty, and surface the real cruxes?
2. **Generalizability** — Does the workflow travel across scientific, policy, historical, technical, and everyday contested questions?
3. **Compounding and shareability** — Are the outputs structured, reusable, interoperable, and extendable by other investigators?
4. **Scalability** — Does it improve with better models, more compute, additional sources, and more adversarial scrutiny?
5. **Methodological transparency** — Can another team understand, replicate, evaluate, and criticize the procedure?
6. **Adversarial robustness** — Does it withstand motivated sources, differing worldviews, strategic framing, and downstream interrogation?
7. **Insight contribution** — Does it reveal important failure modes, methods, or framings that change how the problem should be approached?

Polish is secondary. A transparent, reproducible workflow with a rough interface is more valuable than a beautiful interface concealing an opaque research process.

## What Epistack is not

Epistack is not:

- a universal truth oracle;
- a search engine with more citations;
- an AI-generated confidence score attached to prose;
- a single mandatory evidence hierarchy for every domain;
- a substitute for domain expertise or primary research;
- a mechanism for manufacturing consensus; or
- a promise that all disagreements can be resolved empirically.

Its purpose is narrower and, we believe, more achievable: make it easier to see what we know, how we know it, what remains contested, and what would change our minds.

## The long-term ambition

When more people share a common basis for what is known—and how it is known—they can reason, create, and coordinate on firmer ground.

With the Epistemic Stack in place, a consequential conclusion should be traceable to its evidence, evaluated in context, challenged in the open, and updated when its foundations change. Weak claims should appear weak. Strong claims should survive scrutiny. Genuine disagreement should become more precise.

That is what it would mean to build a reliable supply chain for truth.
