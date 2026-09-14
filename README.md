# Epistack

**Turn a vague question into a contextualized investigation and an inspectable basis for a decision.**

[Open the production site](https://epistack.adityaarpitha.com/). The repository is the canonical source; hosted deployments are published separately and should be reported with their commit and verification results.

Epistack helps someone start with “Are eggs good to eat?”, discover what that depends on, supply the details of their own situation, and direct agents to gather and examine relevant information. The eventual artifact should help them decide what to do, see why, and understand what would change the answer.

The broader ambition is a reliable supply chain for knowledge: conclusions connected to sources, methods, assumptions, disagreements, and revisions. The practical starting point is a person with an imperfectly specified question. They should not have to write a research protocol before asking it.

Read the [vision](./vision.md) for the product intent and methodological principles. This README describes the user journey and the current implementation boundary.

## The three stages

```text
Vague question
  → 1. Decompose: what could matter?
  → 2. Contextualize: what matters for this person?
  → Research brief: scoped claims, feasible choices, constraints, and gaps
  → 3. Investigate: hosted agents gather and examine relevant information
  → Artifact: options, evidence, uncertainty, and reasons to reconsider
```

The navigation has four destinations: Decompose, Contextualize, Investigate, and Artifact. The first three perform the investigation; the fourth presents its accumulated outputs. Engineering phases inside Investigate are not additional user-facing stages.

### 1. Decompose — expose the dimensions

The model proposes an editable map of what an ambiguous question could mean. For eggs, that might include health outcomes, quantity, preparation, replacement foods, personal circumstances, cost, or sourcing priorities.

Each dimension should explain why it could matter, what is unspecified, and what evidence would be needed. Phrase highlighting makes interpretations inspectable. Important missing dimensions must also be retained even when there is no explicit phrase to highlight; label these as inferred questions rather than inventing language or personal facts.

**Output:** reviewed dimensions, alternatives, evidence requirements, and unknowns. This stage does not answer the substantive question.

### 2. Contextualize — interview the person

Ask targeted questions that turn those dimensions into an actual situation: what the person currently does, their objective, constraints, feasible alternatives, and relevant context. Allow selected answers, free text, and unresolved details. Ask only for information that could change scope, evidence matching, or a decision.

For example, current weekly intake, cooking method, replacement breakfast, and the outcome the person cares about produce a much more useful investigation than “eggs and health.” If they want purchasing advice, geography, budget, and purchasing priorities become relevant too.

**Output:** a human-reviewed `ResearchBrief` containing the stakeholder profile, feasible action options, scoped claims, applicability fields, retrieval rules, priorities, and gaps. Each material answer should survive into this contract or have an explicit reason for being parked. These are product requirements; the preservation gaps below still need work.

### 3. Investigate — assign scoped work

Agents receive tasks derived from the brief. Broad/disconfirming searches look for relevant and conflicting sources; applicability searches examine how findings transfer to the person's situation; context searches surface practical concerns and hypotheses.

Discovery, acquisition, extraction, review, and acceptance remain distinct. A search hit is a lead. A fetched page is an acquired artifact. An extracted statement still needs the checks appropriate to the claim and source class.

| Concept | Meaning | Examples |
|---|---|---|
| Discovery lane | Purpose of the search | Broad, applicability, context |
| Source class | Kind of source | Study, guideline, registry, statistics, anecdote |
| Acquisition / evidence status | What was retrieved and checked | Cited-unverified, acquired, extracted, reviewed, accepted |
| Epistemic role | What the finding can establish | Causal, descriptive, normative, status, context |

These concepts are independent. A guideline found through broad search remains guidance; a first-person account can prompt investigation without becoming proof of an outcome. A study's design and result determine whether it supports a causal claim.

**Output:** claim-linked findings with class-specific payloads, source provenance, scope, limitations, verification state, and remaining gaps. The intended task unit is claim × useful lane, with explicit progress, failure, and stopping conditions.

## What the final artifact is for

The artifact connects the person's question and constraints to the options they can actually consider. For an eggs case, it should eventually show which quantity or substitution options the evidence can support, how guidance and personal priorities bear on them, and which uncertainties could change the decision.

Purchasing is a separate subdecision when requested: compare actual cost, access, safety, welfare, or other criteria using relevant sources. A general health review cannot establish where someone should shop. Insufficient evidence should remain an explicit outcome.

The underlying package preserves claims, exact source material, assessments, dependencies, and revisions. Reports and decision views are projections of that package. Repeated publications of one study should not count as independent votes, and changing a load-bearing source should make affected conclusions reviewable.

Artifact links use the case ID as their stable address, for example `/artifact?caseId=<id>`. Reopening that link reads the current accepted graph for the case, so later accepted evidence can update the same address and mark prior decision views stale when their basis changes. The **Download JSON** control creates a versioned point-in-time export (`epistack-artifact.v1`) containing the case ID, research brief, accepted graph, provenance, and freshness metadata. It does not include provider credentials or browser-only keys. A case URL is durable only while its backing case and database remain available; the downloaded JSON is the portable snapshot.

## Live runtime boundary

The production site runs the browser interface and same-origin API routes on the Sites worker. Provider credentials stay in hosted server secrets; the browser does not receive the Lyra, Astra, or OpenRouter keys and does not call a local companion. Astra/Lyra is the primary hosted path, with server-side OpenRouter recovery when the hosted gateway is unavailable. Local development can still run the Claude companion and the explicit OpenRouter routes for inspection and comparison.

Hosted decomposition jobs persist their receipts and three specialist stages in D1. The browser polls for fast progress, while the worker has a scheduled recovery sweep and a guarded manual tick endpoint. Run telemetry is available through the guarded jobs stats route. Research discovery remains lead-only until acquisition, typed extraction, review, and promotion checks succeed.

## Current code and remaining gaps

This describes the tracked implementation in `main`. A commit being present here is not by itself proof that it is deployed or that live provider calls pass; use the release record and live verification for that distinction.

| Area | Present in this checkout | Still needed to meet the vision |
|---|---|---|
| Decompose | Three hosted specialists for dimensions, phrase traces, and interview/evidence requirements; editable review; server-side OpenRouter recovery and explicit deterministic trace fallback | Preserve inferred dimensions without an exact phrase trace; replace generic fallback interview options |
| Contextualize | Persisted interview selections and text, hosted brief compilation, scoped claim review, and an impact ledger showing changed claims, constraints, action options, and gaps | Validate answer retention and unresolved fields; `compiledQuestion` is currently copied from the original prompt |
| Recall | One broad agent per selected claim, plus shared applicability and context lanes; hosted fallback; best-effort source classification | Full scoped fields in agent prompts; per-task progress and failure reporting; claim/lane provenance preserved during deduplication; fair result limits |
| Source examination | PMC acquisition, public URL acquisition, a ClinicalTrials.gov adapter, typed recommendation/statistic/registry/context payloads, study extraction and adversarial review | Source-class labels and a successful fetch are not validation of completeness or causal validity; generalized artifact identity still needs work |
| Research display | Classified leads, claim-steering cards, typed source-review cards, backend health status, and hosted/local provenance fields | Persist and connect non-study findings to the Artifact and decision view under their own roles; expose live lane progress and final provider provenance consistently |
| Artifact and synthesis | Accepted-result graph, provenance and dependence views, human-verified overturn stamps, graph-grounded decision infrastructure, stable case links, and versioned JSON export | Demonstrate the complete flow on current code, including empty/failed runs and useful multi-source decisions |

The newer multi-source work is visible in `6c8983c`, `a80f84c`, `0fcd9c9`, and `357b0a2`; the Phase 1–3 hardening (structured-output repair, backend-unreachable handling, cron job driver, persistent telemetry, `tsc` gate) is in `1a7ca13`. It extends the previous PubMed-centered workflow; it does not establish end-to-end completion by itself.

## Highest-value next improvements

1. **Keep important missing dimensions.** Assembly currently builds clusters from valid phrase traces. A vague question can therefore lose a dimension it most needs the interview to uncover.
2. **Make the brief preserve context.** Retain structured answers and check their disposition before launch. Show the person a compact “this is what we are investigating” summary with assumptions and unknowns.
3. **Use the full scoped contract.** The browser sends population, exposure, comparator, outcome, and horizon, but recall's prompt builder currently renders only claim ID, statement, decision relevance, and query. Include the explicit fields and relevant permitted context.
4. **Keep discovery accounting truthful.** Deduplicate source identity while retaining every claim/lane link. A failed or empty lane should stay failed or empty; it should not inherit another lane's sources. Allocate result limits across tasks so early broad results cannot crowd out context and applicability.
5. **Measure useful coverage.** Show which claims have usable findings, contradictions, missing context, and failed checks. Source totals and agent totals alone do not measure research quality.

The current implementation also needs a consistent provider record at every user-facing stage. A fallback should say which provider and model actually answered, why the primary path was unavailable, and when a deterministic safety fallback supplied structure rather than model reasoning.

## How we judge progress

Compare repeated runs and strong research baselines on the same question. Evaluate:

- retention of important dimensions and person-supplied details;
- relevance and diversity of sources to the actual decision;
- exact claim-to-source support and appropriate use of each source class;
- preservation of uncertainty, disagreement, and source dependence;
- whether the artifact changes or clarifies a feasible choice;
- whether another investigator can inspect, extend, or revise it.

Use the eggs case, a contested debate, and questions outside clinical research. A polished interface, passing schema, or large source list is insufficient evidence of success.

## Run and contribute

The application lives in [`app/`](./app/README.md). It uses TypeScript, React, Vinext, Cloudflare Workers/D1, and a server-side gateway for hosted agent work.

```bash
cd app
npm install
# Configure server-side gateway bindings as described in app/README.md.
npm run dev
```

Use the [app README](./app/README.md) for configuration, commands, route ownership, and code pointers. Keep provider credentials server-side. Document local, tested, committed, pushed, and deployed state separately.

## Documents

- [Vision](./vision.md) — product intent, the three-stage contract, and long-term knowledge infrastructure.
- [Question compilation](./methodology/question-compilation.md) — dimensions, context, assessability, and scope discipline across stages 1–2.
- [Evidence ingestion](./methodology/evidence-ingestion.md) — detailed study-evidence workflow; broader source classes require their own methods.
- [Architecture](./architecture.md) — foundational design for provenance, persistence, collaboration, and latency; its prototype inventory is historical.
- [Reference case studies](./case-studies.md) — motivating methods and the failure modes they expose.
- [App README](./app/README.md) — current source structure and development entry point.
- [Engineering issues](./issues.md) — backlog; verify historical entries against current code before picking up work.
- [Task queue](./TASKS.md) — the ordered work queue for deployment, documentation, provenance, and product follow-ups.
- [Curated eggs corpus](./app/data/eggs-weight-corpus.ts) — reference material, distinct from newly investigated live evidence.
