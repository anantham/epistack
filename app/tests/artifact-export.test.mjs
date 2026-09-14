import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("artifact exposes a versioned JSON download containing the live graph and brief", async () => {
  const source = await readFile(new URL("../app/artifact/artifact-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /exportVersion: "epistack-artifact\.v1"/);
  assert.match(source, /artifact,\n\s+researchBrief: brief/);
  assert.match(source, /anchor\.download = `epistack-\$\{caseId\}-artifact\.json`/);
});
