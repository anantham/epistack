import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("stage four renders the live accepted evidence contract", async () => {
  const [page, workspace, navigation, research, styles] = await Promise.all([
    readFile(new URL("app/artifact/page.tsx", root), "utf8"),
    readFile(new URL("app/artifact/artifact-workspace.tsx", root), "utf8"),
    readFile(new URL("app/components/case-navigation.tsx", root), "utf8"),
    readFile(new URL("app/research/research-dashboard.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(page, /ArtifactWorkspace/);
  assert.match(navigation, /href: "\/artifact"/);
  assert.match(research, /Open live artifact/);
  assert.match(workspace, /\/api\/artifact\?caseId=/);
  assert.match(workspace, /live-artifact\.v1/);
  assert.match(workspace, /Accepted claim–result links/);
  assert.match(workspace, /Dependence groups/);
  assert.match(workspace, /AI full-text checks/);
  assert.match(workspace, /human-verified full-text/);
  assert.match(workspace, /separate from AI review/);
  assert.match(workspace, /Human-verified full text/);
  assert.match(workspace, /compiled claims below are a research contract, not conclusions/);
  assert.match(workspace, /Resolving the active investigation/);
  assert.match(workspace, /No promoted result currently bears on this claim/);
  assert.match(workspace, /Question → scope → evidence/);
  assert.match(workspace, /A · Open question/);
  assert.match(workspace, /Rest \/ unresolved/);
  assert.match(workspace, /C · Evidence lanes/);
  assert.match(workspace, /Raw compiled research contract/);
  assert.match(workspace, /brief\?\.originalQuestion/);
  assert.match(workspace, /Answer details kept private in this artifact/);
  assert.match(workspace, /Exact locus/);
  assert.match(workspace, /source snapshot hashed/);
  assert.match(workspace, /Raw record counts describe this artifact/);
  assert.match(workspace, /They are not confidence scores/);
  assert.match(workspace, /Open decision workbench/);
  assert.doesNotMatch(workspace, /graph uncertainty/i);
  assert.match(styles, /\.live-artifact-hero/);
  assert.match(styles, /\.live-result-list/);
});
