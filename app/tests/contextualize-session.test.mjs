import assert from "node:assert/strict";
import test from "node:test";
import {
  restoreContextualizeSession,
  serializeContextualizeSession,
} from "../lib/contextualize-session.ts";

test("contextualization resumes only the matching decomposition case", () => {
  const raw = serializeContextualizeSession("case-a", {
    elicitationIndex: 2,
    contextAnswers: { dose: "two eggs" },
    contextSelections: { preparation: ["fried"] },
  });

  assert.deepEqual(restoreContextualizeSession(raw, "case-a", 5), {
    elicitationIndex: 2,
    contextAnswers: { dose: "two eggs" },
    contextSelections: { preparation: ["fried"] },
  });
  assert.deepEqual(restoreContextualizeSession(raw, "case-b", 5), {
    elicitationIndex: 0,
    contextAnswers: {},
    contextSelections: {},
  });
});

test("contextualization clamps a saved index to the current case", () => {
  const raw = JSON.stringify({ caseId: "case-a", elicitationIndex: 99 });
  assert.equal(restoreContextualizeSession(raw, "case-a", 5).elicitationIndex, 4);
  assert.equal(restoreContextualizeSession(raw, "case-a", 0).elicitationIndex, 0);
});
