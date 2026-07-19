# Operator 1: Question Compilation

## Purpose

Turn an open-ended natural-language question into one or more concrete claims that evidence could support, challenge, or leave unresolved—without pretending the space has been exhaustively enumerated.

The operator is collaborative. AI supplies breadth and clerical structure; the human supplies purpose, relevance judgments, and approval of the active scope.

## Input

- Original question or paragraph
- User's decision context, if known
- Optional investigation budget
- Optional domain constraints

## Output

- A bounded set of interpretation axes
- Candidate branches for each axis
- Rationale and origin for every branch
- One human-approved active path
- Parked and omitted branches retained separately
- A compiled, probabilistically assessable claim
- A list of relevant unknown attributes

## Procedure

### 1. Extract the decision and outcome families

Identify why the user may be asking and list distinct outcome families before retrieving evidence. In the eggs case, “good” could refer to weight, satiety, muscle, cardiovascular health, convenience, cost, or other outcomes.

The human selects the first outcome family to investigate. Other outcomes remain parked; they are not combined into one goodness score.

### 2. Propose a bounded divisibility space

Generate candidate axes such as:

- object or construct;
- dose and frequency;
- preparation or implementation;
- addition versus substitution;
- comparator;
- population;
- context;
- outcome and threshold; and
- time horizon.

The model should propose two to six branches per axis. This is a usability bound, not a claim of completeness.

### 3. Explain decision relevance

For each branch, state:

- what it means;
- why it could change the answer;
- whether it is likely to match ordinary usage;
- whether it is a separate question or a possible modifier; and
- what would cause a parked branch to be reopened.

### 4. Human review

For every axis, the investigator may:

- keep one branch as active;
- edit its meaning;
- add a missing branch;
- park an irrelevant branch; or
- mark the axis unresolved.

Parking is reversible and does not delete the branch.

### 5. Compile the active path

Construct a question containing, where applicable:

```text
Population + exposure + role in the system + comparator + context + outcome + horizon
```

For the first eggs slice:

> Among adults with overweight or obesity who are actively pursuing weight loss, does consuming two whole hen eggs at breakfast at least five days per week instead of an energy-matched egg-free breakfast, while following an energy-restricted diet, cause greater loss of body weight after 8–12 weeks?

### 6. Validate assessability

A compiled claim is ready only if:

- the exposure and comparator are distinguishable;
- the population and horizon are stated;
- the outcome can be observed or estimated;
- “good,” “bad,” “effective,” and similar terms have been operationalized;
- normative and empirical components are separated; and
- the claim can be contradicted by some possible evidence.

### 7. Create the initial belief object

Only now create a probability. Record:

- the exact proposition;
- the prior value;
- whether the prior is empirical, elicited, model-based, or analysis-neutral;
- who set it; and
- the rationale.

Do not distribute probability mass across interpretation branches unless they have been explicitly defined as mutually exclusive and collectively exhaustive hypotheses.

### 8. Record—not necessarily expand—unknown attributes

Unknown details such as egg size, preparation, feed, housing, certification, and geography should be preserved. They become active branches only when at least one of these holds:

- there is a plausible mechanism connecting the attribute to the outcome;
- evidence shows meaningful heterogeneity;
- the attribute changes which evidence is transportable; or
- the user's decision explicitly depends on it.

This rule prevents both premature dismissal and combinatorial explosion.

## Stopping rule

Stop the initial decomposition when:

- every required component of the concrete claim is filled;
- the human agrees the active path represents a useful question;
- at least one alternative is preserved for each materially ambiguous axis; and
- a breadth check does not identify a missing branch likely to reverse the decision.

Deeper decomposition is lazy. Reopen an axis when new evidence, disagreement, or sensitivity analysis shows it may be load-bearing.

## Failure modes

- **Granularity gaming:** splitting one interpretation into many branches makes it appear important.
- **Early tunnel vision:** the model's initial decomposition omits an entire outcome or causal pathway.
- **Decorative metadata:** collecting attributes that cannot change the decision.
- **Comparator erasure:** discussing a food or intervention without saying what it replaces.
- **Mechanism substitution:** treating a short-term mediator as proof of a long-term outcome.
- **Silent scope drift:** evidence about a different population, dose, or outcome is attached to the active claim.
- **False prior:** an arbitrary `0.5` is presented as substantive knowledge rather than an analysis convention.

## Audit questions

1. What important interpretation did the model omit?
2. Did branch granularity affect its apparent priority?
3. Which branch choice most changes the evidence that will be considered relevant?
4. Is the comparator explicit?
5. Could a reasonable person tell what observation would count against the compiled claim?
6. Which unknown attributes are being recorded, and why are they not active branches?
7. Which decisions were made by the model, and which by the human?
