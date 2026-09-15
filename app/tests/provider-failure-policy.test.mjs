import assert from "node:assert/strict";
import test from "node:test";
import { isAbortTimeout, isHostedBackendUnavailableCode } from "../lib/provider-failure-policy.ts";

test("hosted backend timeout is an unavailable provider failure", () => {
  assert.equal(isHostedBackendUnavailableCode("backend-timeout"), true);
  assert.equal(isHostedBackendUnavailableCode("backend-unreachable"), true);
  assert.equal(isHostedBackendUnavailableCode("schema-invalid"), false);
});

test("provider timeout detection recognizes runtime timeout errors", () => {
  assert.equal(isAbortTimeout(Object.assign(new Error("request timed out"), { name: "TimeoutError" })), true);
  assert.equal(isAbortTimeout({ code: "ETIMEDOUT" }), true);
  assert.equal(isAbortTimeout(new Error("malformed JSON")), false);
});
