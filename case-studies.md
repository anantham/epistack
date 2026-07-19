# Reference Case Studies

## Why these examples matter

This document studies a collection of strong epistemic practices that motivate Epistack. They are not all knowledge bases, software products, or AI systems. They were selected because each reveals a different place where the path from observation to conclusion can fail—and demonstrates a method for making that failure visible.

Taken together, they span an epistemic supply chain:

| Layer | Examples | Central question |
|---|---|---|
| Artifact integrity | Elisabeth Bik; Data Colada | Is the underlying image or dataset authentic? |
| Construct and measurement validity | Flake and Fried; Nadel and Pritchett | Did the study measure or implement the thing we think it did? |
| Statistical inference and claim calibration | Transparent Replications; Andrew Gelman | Do the analysis and effect justify the stated conclusion? |
| Evidence synthesis and maintenance | Examine.com | What does the whole body of evidence support, and how should it update? |
| Argument and system structure | Society Library; Nancy Leveson | How do claims interact across perspectives and complex systems? |
| Decision-making under uncertainty | Dick Heuer | How do we compare hypotheses and expose assumptions under uncertainty? |

The important pattern is that these efforts catch errors that conventional literature review often inherits. A research system that only retrieves papers and summarizes their conclusions will miss much of what makes these examples valuable.

## 1. Transparent Replications and importance hacking

[Transparent Replications](https://replications.clearerthinking.org/) spot-checks findings in psychology through rapid, openly documented replications. Its work also led to the concept of [importance hacking](https://www.clearerthinking.org/post/importance-hacking-a-major-yet-rarely-discussed-problem-in-science): making a real result appear more meaningful, general, or important than it is.

This matters because replication is not sufficient. A finding can reproduce while the paper's framing still encourages beliefs that the experiment did not establish. A statistically detectable result can be practically trivial; a narrow interaction can be presented as a broad phenomenon; or an outcome measure can be mistaken for the socially important construct it only weakly represents.

Transparent Replications' “simplest valid analysis” is also instructive. Reporting a straightforward valid test alongside a complex model can reveal whether analytical sophistication is obscuring a simpler and less favorable picture.

### Why it was selected

- It exposes a failure mode beyond fraud, p-hacking, and non-replication.
- It scrutinizes the transition from result to communicated claim.
- It turns an intuitive concern about hype into a named, inspectable practice.
- It offers an operational comparison rather than a general request to “be cautious.”

### Requirement for Epistack

Represent at least three distinct objects:

```text
What was measured -> what was found -> what was claimed
```

The system should assess the inferential and rhetorical distance between them, including practical importance and scope—not merely whether a citation is present.

## 2. Elisabeth Bik and scientific image forensics

[Elisabeth Bik's research-integrity work](https://senseaboutscience.org/activities/john-maddox-prize-2021-winners-announcement/) demonstrates that textual argument and statistical analysis can rest on corrupted primary artifacts. Her forensic review of scientific images has exposed duplication, manipulation, plagiarism, and other methodological concerns across nearly 5,000 papers, contributing to corrections, retractions, and stronger journal-screening practices.

### Why it was selected

- It shows that a publication cannot always be treated as an atomic evidence object.
- It operates at the level of figures and images that ordinary text-based review ignores.
- Its findings have produced concrete downstream corrections and institutional changes.
- It represents rare, labor-intensive expertise that AI may help scale.
- It has had to withstand motivated opposition and legal or reputational pressure.

### Requirement for Epistack

Evidence provenance should sometimes extend below the paper to figures, image regions, tables, datasets, and transformation histories. Multimodal artifact-integrity checks should be attachable to the claims that depend on those artifacts.

## 3. Nadel and Pritchett on program design

In [*Searching for the Devil in the Details*](https://www.cgdev.org/sites/default/files/searching-devil-details-learning-about-development-program-design-working-paper-434.pdf), Sara Nadel and Lant Pritchett challenge the assumption that interventions sharing a category label are instances of the same program.

Development programs occupy high-dimensional design spaces. “Provide textbooks,” “computer-assisted instruction,” or “job training” can vary in implementation intensity, sequencing, incentives, institutional capacity, participant selection, and interaction with local systems. Small design changes can yield large outcome differences.

This is not only external-validity failure—one program working differently in another context. It can be construct-validity failure: the class of interventions being aggregated is not a coherent empirical object at the chosen level of granularity.

### Why it was selected

- It questions the ontology underneath evidence synthesis.
- It explains why more rigorous studies do not automatically produce actionable knowledge.
- It distinguishes context differences from differences in what the intervention actually is.
- It proposes faster, iterative exploration of program-design space as a complement or alternative to premature lock-in.

### Requirement for Epistack

Before combining studies, decompose the intervention, population, outcome, mechanism, and context. Comparability must be assessed rather than inferred from shared vocabulary. Where a category is too coarse, the system should refuse or qualify aggregation.

## 4. Measurement Schmeasurement

Jessica Flake and Eiko Fried's [*Measurement Schmeasurement*](https://journals.sagepub.com/doi/10.1177/2515245920952393) defines questionable measurement practices: decisions that create doubts about whether measures support the conclusions drawn from them.

A rigorous experiment with advanced statistics cannot recover validity if the instrument poorly represents the construct. Measures of depression, well-being, creativity, attitudes, or ability involve theoretical and operational judgments that are frequently hidden or underreported.

The paper contributes both a diagnosis and a reusable set of questions for researchers, reviewers, and readers. Its central insight is that transparency does not guarantee valid measurement, but without transparency the validity cannot be evaluated.

### Why it was selected

- It exposes an upstream weakness often ignored by evidence grading.
- It names a widespread but comparatively neglected family of practices.
- It connects measurement decisions to every major form of study validity.
- It converts methodological criticism into a reusable review procedure.

### Requirement for Epistack

Model the chain explicitly:

```text
Construct -> operational definition -> instrument -> observed variable -> inference
```

Measurement validity should not be compressed into a generic “study quality” score.

## 5. Data Colada

[Data Colada](https://datacolada.org/) is a sustained program of methodological criticism and forensic investigation. Its investigations have used raw-data patterns, duplicated observations, unexpected sorting, metadata, spreadsheet formatting, implausible distributions, and file histories to identify likely errors and fabrication.

The [investigation of an influential dishonesty experiment](https://datacolada.org/98), for example, published the underlying artifacts and analysis, walked through several independent anomalies, considered what those anomalies established, and preserved uncertainty about who was responsible for the apparent fabrication.

### Why it was selected

- It demonstrates adversarial, reproducible scrutiny of primary evidence.
- It combines statistical methods with close inspection and domain intuition.
- It publishes intermediate evidence so others can challenge or extend the analysis.
- It carefully distinguishes a supported forensic conclusion from stronger unsupported accusations.
- It has generated corrections, retractions, new analytic tools, and broader methodological insight.

### Requirement for Epistack

Support raw-artifact inspection, anomaly records, alternative explanations, and reproducible analysis. Every challenge should state both what the evidence supports and what it does not establish.

## 6. Nancy Leveson's systems approach to safety

Nancy Leveson's [*Engineering a Safer World*](https://mitpress.mit.edu/9780262533690/engineering-a-safer-world/) argues that traditional linear models of accidents are inadequate for complex sociotechnical systems. Her STAMP framework treats safety as a dynamic control problem involving interactions among software, hardware, operators, organizations, incentives, regulation, and feedback.

An accident can occur even when no individual component “fails.” The dangerous property may emerge from normal components interacting under an inadequate control structure or outdated model of the system.

### Why it was selected

- It changes the representation of the problem rather than merely improving analysis inside an old representation.
- It supplies explicit methods for hazard analysis, accident analysis, design, and operations.
- It travels across multiple safety-critical industries.
- It accommodates changing systems, incomplete control, and feedback over time.

### Requirement for Epistack

Do not assume every case can be modeled as a static claim tree. Support feedback loops, control relationships, time-dependent state, organizational responsibility, and emergent properties where the domain requires them.

## 7. Examine.com

[Examine.com](https://examine.com/) applies structured evidence synthesis to nutrition, supplements, and health—a domain saturated with commercial incentives, cherry-picking, heterogeneous studies, and rapidly changing evidence.

Its database organizes randomized-trial evidence by interventions and outcomes so individual studies can be viewed in the context of the broader evidence base. Its evidence grading incorporates consistency and effect magnitude, and new studies are continuously integrated. Examine also makes institutional independence part of its methodology by rejecting supplement sponsorship, advertising, affiliations, and gifts. Its [description of the database and grading approach](https://help.examine.com/help/how-to-use-examine) and [funding and editorial model](https://help.examine.com/help/what-is-examine) make these design decisions explicit.

### Why it was selected

- It is an existence proof for a maintained, claim-level evidence product.
- Its structured work compounds as new evidence arrives.
- It emphasizes effect magnitude and uncertainty, not only study presence.
- It treats incentives and funding as components of trustworthiness.
- It connects a research database to useful downstream products.

### Requirement for Epistack

Build for continuous evidence integration and update propagation. Record institutional incentives alongside study-level conflicts. Allow many user-facing products to inherit from the same maintained evidence layer.

## 8. Andrew Gelman's statistical criticism

[Andrew Gelman's writing on statistical modeling](https://statmodeling.stat.columbia.edu/) is a long-running catalog of weak statistics, implausible effect sizes, garden-of-forking-paths problems, bad measurement, overconfident extrapolation, and poor scientific theories.

Gelman's method is often case-driven: inspect a surprising or overconfident result, identify why the conventional analysis fails, and use that failure to improve general statistical understanding. His discussion of [bad research as a source of methodological insight](https://statmodeling.stat.columbia.edu/2017/01/30/no-guru-no-method-no-teacher-just-nature-garden-forking-paths/) illustrates this pattern.

### Why it was selected

- It demonstrates the value of sustained public post-publication criticism.
- It evaluates substantive plausibility and effect magnitude, not only formal significance.
- It extracts general failure modes from specific cases.
- It challenges authoritative or peer-reviewed work without treating publication as validation.
- It contributes new ways of thinking about the problem itself.

### Requirement for Epistack

Permit methodology to evolve from case-level failures. Capture reusable critique patterns, base-rate and prior-plausibility judgments, and assessments of practical effect size. Do not reduce statistical validity to whether a reported test crossed a threshold.

## 9. The Society Library's Diablo Canyon investigation

The Society Library's [Diablo Canyon investigation](https://papers.societylibrary.org/papers/diablo_canyon) maps a complex public decision about California's last operating nuclear power plant. It collected more than 5,000 arguments, claims, and pieces of evidence across economic, environmental, safety, energy, political, ethical, and wellbeing perspectives.

Rather than forcing the controversy into one pro/con summary, it represents multiple positions and deep chains of supporting reasoning. It also states that parts of the collection remain incomplete.

### Why it was selected

- It engages a whole decision rather than a narrow factual question.
- It produces a structured, navigable argument artifact.
- It preserves heterogeneous stakeholder positions and values.
- It exposes incompleteness instead of hiding it behind a polished synthesis.
- Its structure allows future investigators to extend particular branches.

### Requirement for Epistack

Represent arguments, stakeholder objectives, normative premises, and empirical claims as different object types. Preserve multiple positions without manufacturing false equivalence, and allow users to trace exactly where their conclusions diverge.

## 10. Dick Heuer and structured analytic techniques

Dick Heuer championed structured analytic techniques for intelligence work, including analysis of competing hypotheses, key-assumptions checks, quality-of-information checks, indicators, and explicit search for disconfirming evidence. The CIA's [*Tradecraft Primer*](https://www.cia.gov/resources/csi/static/Tradecraft-Primer-apr09.pdf) documents these procedures.

Intelligence analysis is a demanding test environment: evidence can be incomplete, ambiguous, strategically deceptive, and impossible to reproduce experimentally. Heuer's central contribution is procedural. Analysts cannot remove their cognitive biases simply by intending to be objective, so the workflow must externalize assumptions and force comparison with alternatives.

### Why it was selected

- It works outside domains with clean scientific evidence.
- It is designed for information-scarce and adversarial conditions.
- It makes reasoning steps and assumptions inspectable.
- It provides replicable procedures rather than generic critical-thinking advice.
- It identifies what information would cause an analyst to revise a judgment.

### Requirement for Epistack

Adversarial review should consist of named methods with defined inputs, transformations, and outputs. Claims should retain key assumptions, competing hypotheses, confidence rationales, and potential revision triggers.

## Shared selection logic

These examples have six important properties in common.

### 1. They find errors that survive respectable institutions

Their targets frequently passed peer review, statistical testing, replication, or expert review. The relevant benchmark is not misinformation from obviously poor sources; it is error that survives apparently credible processes.

### 2. They inspect evidence production, not only published conclusions

They ask how an image, dataset, measure, intervention, model, or argument was produced. This extends the chain of provenance beyond bibliographic citation.

### 3. They introduce useful epistemic primitives

Concepts such as importance hacking, questionable measurement practices, rugged program-design space, garden of forking paths, system control structures, and competing hypotheses make previously blurry failures easier to recognize and address.

### 4. They create inspectable intermediate artifacts

Their outputs include replication reports, annotated images, forensic analyses, measurement checklists, evidence grades, argument maps, system models, and hypothesis matrices. These objects are reusable in ways a narrative summary is not.

### 5. They identify load-bearing relationships

Each method reveals where an analysis can break: a manipulated figure, invalid measure, mismatched program category, hidden analytical choice, implausible extrapolation, missing perspective, or unstated assumption.

### 6. They are expensive human crafts that AI may help scale

Forensic inspection, exhaustive argument collection, continuous evidence review, and repeated adversarial analysis require enormous labor. AI creates an opportunity to make these practices more systematic and abundant—provided the procedures and outputs remain inspectable.

## Implications for the first Epistack prototype

The reference cases imply that the prototype should do more than generate a claim graph with citations. At minimum, it should demonstrate:

1. scoped question decomposition;
2. exact claim-to-evidence links;
3. separation of constructs, measures, results, and communicated claims;
4. source and artifact provenance;
5. explicit assessment policies;
6. competing hypotheses and disconfirming-evidence search;
7. comparability checks before evidence aggregation;
8. load-bearing evidence and assumption analysis;
9. structured uncertainty and unresolved gaps;
10. versioning and update propagation; and
11. a machine-readable artifact another investigator can extend.

The prototype does not need to solve every layer equally well. A deep contribution to one or two of these neglected layers may be more valuable than shallow automation of the entire pipeline. But it should make clear where its methodology begins, where it ends, and which failure modes remain outside its scope.
