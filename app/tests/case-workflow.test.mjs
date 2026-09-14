import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("case-bound stage navigation loads the saved workflow instead of latest browser state", async () => {
  const [casesRoute, home, map, research, workflow] = await Promise.all([
    readFile(new URL("app/api/cases/route.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/map/page.tsx", root), "utf8"),
    readFile(new URL("app/research/research-dashboard.tsx", root), "utf8"),
    readFile(new URL("lib/case-workflow.ts", root), "utf8"),
  ]);

  assert.match(casesRoute, /workflow\?: unknown/);
  assert.match(casesRoute, /persistedWorkflow/);
  assert.match(casesRoute, /snapshots: snapshots\.results, workflow/);
  assert.match(home, /\/api\/cases\?caseId=/);
  assert.match(home, /latest browser workspace could show another question/);
  assert.match(map, /parseCaseWorkflow/);
  assert.match(map, /This case does not have a saved contextualization contract/);
assert.match(research, /parseCaseWorkflow/);
assert.match(research, /workflow\.researchBrief/);
assert.match(research, /dashboardCacheKeyPrefix/);
assert.match(research, /sourceReviews/);
assert.match(casesRoute, /researchState/);
assert.match(workflow, /researchState/);
assert.match(workflow, /caseWorkflowVersion/);
  assert.match(workflow, /researchBriefSchema\.safeParse/);
});
