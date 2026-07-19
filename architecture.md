# Product and Data Architecture

## Recommended product shape

Epistack should be a TypeScript web application. React is a good fit because the central interaction is stateful and collaborative: a user enters a vague question, the model proposes changes to an evolving graph, and the user accepts, edits, parks, or challenges those changes without leaving the workspace.

The first screen should not resemble a chat transcript or a generic database dashboard. It should be a **question compiler**:

```text
Vague paragraph
    ↓ AI proposes a decomposition
Visible interpretation map
    ↓ human keeps, edits, adds, or parks branches
One active path through the map
    ↓ compile
Concrete claim with explicit scope
    ↓ ingest evidence
Versioned evidence and belief state
```

The decomposition map is the primary work surface. A side inspector shows why the model proposed a branch, how it will affect the compiled question, who last edited it, and whether it is active or parked.

## Interaction contract

Every AI operation should appear as a reviewable proposal rather than an invisible mutation.

- **Proposed** branches use a visibly provisional state.
- **Kept** branches form the current active question.
- **Parked** branches remain recoverable and searchable.
- **Human-added or edited** branches retain authorship.
- The AI's rationale is available on demand.
- The compiled question updates immediately as the active path changes.
- Creating a probability is disabled until a concrete claim exists.
- Source or assessment changes produce a diff and a new revision, never an overwrite.

This makes model errors local. A user can spot-check a single branch, edge, evidence excerpt, or assessment without rereading an entire report.

## Probability semantics

Epistack must distinguish three different objects that are easily conflated.

### Interpretation priority

Which reading of the vague question is useful or intended? These branches are not generally mutually exclusive hypotheses, so they should not receive a uniform probability distribution. The model proposes them; the human ranks, selects, or parks them.

A uniform distribution is unstable because changing the granularity changes the mass. If one branch is divided into ten sub-branches, it should not become ten times as important.

### Claim belief

Once the human approves a falsifiable or estimable claim, Epistack can represent a belief such as:

```text
P(the selected egg breakfast causes greater weight loss than the selected comparator)
```

A value of `0.5` may be used as an explicitly analysis-neutral placeholder in the prototype. It is not an evidence-based prior and must be labeled as such.

### Decision priority

Which unresolved claim should receive more research effort? This is closer to an expected-value-of-information calculation based on decision sensitivity, uncertainty, resolvability, and cost. It is not the same as either interpretation priority or truth probability.

## Canonical data model

Bibliography formats are useful interchange formats, but they are not the canonical data model.

The core should use durable identifiers and normalized records for:

| Record | Important fields |
|---|---|
| Case | Original prompt, active question, status, owner, timestamps |
| Node | Kind, label, body, origin, review status, extensible payload |
| Edge | From, to, relation, proposer, rationale, review status |
| Source | URL, DOI, PMID, title, authors, publisher, date, type, content hash |
| Evidence item | Exact excerpt/data, locator, source, target claim, bearing |
| Assessment | Target, policy, assessor, dimension, score/label, rationale |
| Belief | Claim, probability, prior type, evidence snapshot, assessor |
| Snapshot | Parent revision, actor, operation, serialized artifact, timestamp |

The initial relational schema is implemented in [`app/db/schema.ts`](./app/db/schema.ts). A graph database is not required at first: a relational `nodes`/`edges` model is easy to inspect, query, migrate, and export. Specialized graph infrastructure can be introduced only if real workloads justify it.

## Bibliography and provenance

Source records should support:

- CSL-JSON as the primary bibliography interchange format;
- BibTeX export for academic workflows;
- DOI, PMID, and canonical URL identifiers;
- a content hash or archived snapshot identifier;
- exact page, paragraph, table, figure, or dataset locators;
- version and retraction/correction relationships; and
- funding and conflict disclosures as claims with provenance, not unverified metadata labels.

The evidence item, not the bibliography entry, connects a source to a claim. It contains the exact material alleged to support or challenge the claim. This prevents a whole paper from being treated as one undifferentiated unit of evidence.

## Evidence quality

Do not collapse source quality into one universal score at ingestion time. Store dimensions separately:

- artifact and data availability;
- methodological transparency;
- study design and its fit to the claim;
- construct and measurement validity;
- statistical precision and practical effect size;
- conflicts, incentives, and institutional backing;
- calibration or forecasting record when it is actually available and relevant;
- independence from other evidence;
- correction history and responsiveness to criticism; and
- transportability to the active population, exposure, comparator, and outcome.

Institutional backing is evidence about process, not a guarantee. “Skin in the game” can improve incentives or create conflicts. Blinding may be decisive for one design and impossible for another. Large samples improve precision but can make trivial effects look impressive. Assessments must therefore be claim- and design-specific.

## Revision and collaboration model

Epistack should behave like version control for an epistemic artifact:

1. Every model or human operation creates a proposed patch.
2. Accepted patches create an immutable snapshot.
3. Assessments name their policy and assessor.
4. Competing assessments can coexist.
5. Retractions, corrections, and source changes mark dependent edges for review.
6. Materialized views generate the current question, claim graph, and synthesis from the accepted state.

The prototype stores complete JSON snapshots for simple replay while exposing normalized tables for claims, sources, evidence, edges, assessments, and beliefs.

## Low-latency design

The interaction loop should feel immediate even when research is slow.

- Apply human edits optimistically in the browser.
- Stream AI branches as provisional nodes instead of waiting for a complete graph.
- Separate foreground operations (select, edit, park, compile) from background work (retrieval, extraction, verification, ablation).
- Cache source extraction and content hashes so the same paper is not repeatedly processed.
- Collapse and virtualize large branches; never render thousands of nodes simultaneously.
- Prioritize crux-relevant expansion rather than exhaustive enumeration.
- Precompute current summaries and dependency counts from immutable snapshots.
- Make every long task cancellable and preserve partial results.

The scalable unit is not a single giant graph. It is a set of small, versioned subgraphs that can be loaded and deepened on demand.

## First prototype boundary

The current browser prototype implements the framing operator:

- enter the competition's vague eggs prompt;
- inspect seven proposed axes and their candidate branches;
- edit, add, keep, or park interpretations;
- preserve the model's rationale and branch origin;
- compile the selected path into one concrete weight-loss question;
- create an explicitly labeled neutral probability placeholder; and
- save or export the resulting artifact.

It does not yet retrieve studies, evaluate evidence, or update the probability. Those operations should be added only after the framing artifact is tested with users.
