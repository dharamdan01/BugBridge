import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startTestApi } from "../helpers/http.js";

const [bug] = JSON.parse(await readFile(new URL("../../fixtures/bug-reports.json", import.meta.url), "utf8"));

// This is a genuine regression assertion of the correct behavior. It MUST fail
// until BUG-001 is fixed in a later, human-approved phase. Do not skip/invert it.
test("BUG-001: empty task creation should return 400 VALIDATION_ERROR, not 500", async t => {
  const request = await startTestApi(t);
  const actual = [];
  for (const variant of bug.requests) {
    const response = await request(bug.path, {
      method: bug.method, ...(Object.hasOwn(variant, "json") ? { json: variant.json } : {}),
    });
    actual.push({ variant: variant.label, status: response.status, errorCode: response.body.error?.code });
  }
  const remaining = await request(bug.path);
  assert.deepEqual(remaining.body.data, [], "Failed creation must not insert a task");
  assert.deepEqual(actual, bug.requests.map(variant => ({ variant: variant.label, ...bug.expected })));
});
