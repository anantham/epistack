# Epistack execution policy

This policy keeps long-running work aligned with the product vision and makes
release claims auditable.

## Preserve the work

- Work in the canonical checkout unless an isolated worktree is necessary.
- Never use destructive Git commands to make a task easier.
- Preserve dirty worktrees and untracked browser evidence. Inspect them before
  deciding whether to commit, ignore, or archive them.
- Back up meaningful commits to the remote before changing branches or
  deployment sources.
- Keep deployment source reproducible from Git. A temporary directory must not
  contain the only copy of source or configuration.

## Keep states separate

Report these states separately:

1. local working tree;
2. committed revision;
3. pushed revision;
4. merged revision;
5. saved deployment version;
6. live deployment;
7. runtime and browser verification.

Tests, a successful build, or a saved Site version do not prove that the live
custom domain serves that revision.

## Work through the stages

Keep the product stages visible and ordered:

- **Decompose:** expose the dimensions, interpretations, comparisons,
  populations, uncertainties, and evidence requirements hidden in the
  question.
- **Contextualize:** ask only questions whose answers change the scope,
  applicability, feasible options, constraints, or unresolved unknowns.
- **Investigate:** assign claim-scoped work to useful lanes, show progress and
  failures, preserve source classes and provenance, and keep discovery apart
  from accepted evidence.
- **Artifact:** make the person's context, options, evidence, assumptions,
  disagreements, gaps, and sensitivity visible and exportable.

Do not treat a model proposal, lead, abstract, guideline, anecdote, or empty
search result as accepted evidence without the appropriate acquisition,
extraction, review, and promotion gates.

## Continue without losing the objective

When a task has independent work, continue it while an external blocker is
recorded. Stop only for a genuine dependency such as missing authorization,
expired deployment credentials, or unavailable infrastructure. Record the
exact blocker, its evidence, and the next action needed to clear it.

Use bounded specialist agents for review, testing, and quality evaluation.
Integrate their findings centrally and do not treat an agent's report as proof
until the relevant files, tests, runtime behavior, or browser evidence confirm
it.

## Release and verification

Before calling a release complete:

- run the relevant typecheck, build, and tests;
- publish the exact pushed revision from a reproducible source;
- verify the custom domain and every required route;
- exercise the real browser flow from a clean case;
- check provider provenance, fallback behavior, cache behavior, console and
  network activity, responsive layout, refresh/resume behavior, and artifact
  links;
- never print provider credentials or put them in browser-delivered data.

Update `TASKS.md` when scope or release state changes. Keep incomplete,
unverified, and environment-blocked work visible instead of marking it done.
