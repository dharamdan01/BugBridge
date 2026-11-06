import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestApi } from "./helpers/http.js";

const path = "/api/tasks";
const createTask = (request, json = { title: "Investigate checkout failure" }) => request(path, { method: "POST", json });

function assertError(result, status, code) {
  assert.equal(result.status, status);
  assert.match(result.headers.get("content-type"), /^application\/json/);
  assert.deepEqual(Object.keys(result.body).sort(), ["error", "success"]);
  assert.equal(result.body.success, false);
  assert.deepEqual(Object.keys(result.body.error).sort(), ["code", "details", "message"]);
  assert.equal(result.body.error.code, code);
  assert.equal(typeof result.body.error.message, "string");
  assert.ok(Array.isArray(result.body.error.details));
  assert.equal(result.body.error.stack, undefined);
}

test("health endpoint returns a consistent JSON response", async t => {
  const request = await startTestApi(t);
  const result = await request("/health");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true, data: { status: "ok" } });
  assert.equal(result.headers.get("x-powered-by"), null);
});

test("tasks initially empty; separate application instances have independent storage", async t => {
  const first = await startTestApi(t);
  const second = await startTestApi(t);
  await createTask(first);
  assert.equal((await first(path)).body.data.length, 1);
  assert.deepEqual((await second(path)).body, { success: true, data: [] });
});

test("create sets defaults, UUID, timestamps and Location header", async t => {
  const request = await startTestApi(t);
  const result = await createTask(request, { title: "  Investigate failure  " });
  assert.equal(result.status, 201);
  assert.equal(result.body.success, true);
  const task = result.body.data;
  assert.deepEqual(Object.keys(task).sort(), ["createdAt", "description", "id", "status", "title", "updatedAt"]);
  assert.match(task.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.equal(task.title, "Investigate failure");
  assert.equal(task.description, "");
  assert.equal(task.status, "todo");
  assert.equal(task.createdAt, task.updatedAt);
  assert.equal(new Date(task.createdAt).toISOString(), task.createdAt);
  assert.equal(result.headers.get("location"), `${path}/${task.id}`);
});

test("create accepts optional fields and all supported statuses", async t => {
  const request = await startTestApi(t);
  const ids = new Set();
  for (const status of ["todo", "in_progress", "done"]) {
    const result = await createTask(request, { title: "Triage", description: "  Check logs  ", status });
    assert.equal(result.status, 201);
    assert.equal(result.body.data.status, status);
    assert.equal(result.body.data.description, "Check logs");
    ids.add(result.body.data.id);
  }
  assert.equal(ids.size, 3);
});

test("list and retrieve created tasks", async t => {
  const request = await startTestApi(t);
  const first = (await createTask(request)).body.data;
  const second = (await createTask(request, { title: "Write regression test" })).body.data;
  const list = await request(path);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body, { success: true, data: [first, second] });
  const get = await request(`${path}/${first.id}`);
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, { success: true, data: first });
  assert.deepEqual((await request(`${path}/${first.id.toUpperCase()}`)).body.data, first);
});

test("partial update preserves identity, creation time and unspecified fields", async t => {
  const request = await startTestApi(t);
  const task = (await createTask(request, { title: "Triage", description: "Keep this" })).body.data;
  const result = await request(`${path}/${task.id}`, { method: "PATCH", json: { status: "in_progress" } });
  assert.equal(result.status, 200);
  assert.deepEqual({ ...result.body.data, updatedAt: task.updatedAt }, { ...task, status: "in_progress" });
  assert.ok(Date.parse(result.body.data.updatedAt) >= Date.parse(task.updatedAt));
  assert.deepEqual((await request(`${path}/${task.id}`)).body.data, result.body.data);
});

test("update can change all mutable fields and clear description", async t => {
  const request = await startTestApi(t);
  const task = (await createTask(request)).body.data;
  const changes = { title: "  Fix approved  ", description: "", status: "done" };
  const result = await request(`${path}/${task.id}`, { method: "PATCH", json: changes });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.title, "Fix approved");
  assert.equal(result.body.data.description, "");
  assert.equal(result.body.data.status, "done");
});

test("delete confirms removal and later requests return 404", async t => {
  const request = await startTestApi(t);
  const task = (await createTask(request)).body.data;
  const result = await request(`${path}/${task.id}`, { method: "DELETE" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true, data: { id: task.id } });
  assert.deepEqual((await request(path)).body.data, []);
  assertError(await request(`${path}/${task.id}`), 404, "TASK_NOT_FOUND");
  assertError(await request(`${path}/${task.id}`, { method: "DELETE" }), 404, "TASK_NOT_FOUND");
});

for (const method of ["GET", "PATCH", "DELETE"]) {
  test(`${method} rejects malformed task IDs`, async t => {
    const request = await startTestApi(t);
    const options = { method, ...(method === "PATCH" ? { json: { status: "done" } } : {}) };
    assertError(await request(`${path}/not-a-uuid`, options), 400, "INVALID_TASK_ID");
  });
  test(`${method} returns 404 for an unknown well-formed task ID`, async t => {
    const request = await startTestApi(t);
    const options = { method, ...(method === "PATCH" ? { json: { status: "done" } } : {}) };
    assertError(await request(`${path}/${randomUUID()}`, options), 404, "TASK_NOT_FOUND");
  });
}

// Missing title in a NONEMPTY object is ordinary validation. Entirely empty
// creation bodies are deliberately covered only by tests/regression/.
for (const [name, input] of [
  ["missing title", { description: "No title supplied" }],
  ["blank title", { title: "   " }],
  ["non-string title", { title: 42 }],
  ["null title", { title: null }],
  ["overlong title", { title: "x".repeat(201) }],
  ["non-string description", { title: "Triage", description: false }],
  ["overlong description", { title: "Triage", description: "x".repeat(2001) }],
  ["invalid status", { title: "Triage", status: "blocked" }],
  ["null status", { title: "Triage", status: null }],
  ["unknown field", { title: "Triage", unexpected: true }],
  ["client-provided ID", { title: "Triage", id: randomUUID() }],
  ["client-provided timestamp", { title: "Triage", createdAt: "2026-01-01" }],
  ["array body", []],
  ["null body", null],
  ["string body", "Triage"],
  ["number body", 123],
  ["boolean body", false],
]) {
  test(`create validates ${name} without saving a task`, async t => {
    const request = await startTestApi(t);
    const result = await createTask(request, input);
    assertError(result, 400, "VALIDATION_ERROR");
    assert.ok(result.body.error.details.length > 0);
    assert.deepEqual((await request(path)).body.data, []);
  });
}

for (const [name, input] of [
  ["empty patch", {}],
  ["invalid status", { status: "blocked" }],
  ["blank title", { title: "" }],
  ["null description", { description: null }],
  ["immutable ID", { id: randomUUID() }],
  ["immutable updatedAt", { updatedAt: "2026-01-01" }],
  ["array body", []],
  ["null body", null],
]) {
  test(`update validates ${name} without changing storage`, async t => {
    const request = await startTestApi(t);
    const task = (await createTask(request)).body.data;
    assertError(await request(`${path}/${task.id}`, { method: "PATCH", json: input }), 400, "VALIDATION_ERROR");
    assert.deepEqual((await request(`${path}/${task.id}`)).body.data, task);
  });
}

test("absent PATCH body returns a validation error", async t => {
  const request = await startTestApi(t);
  const task = (await createTask(request)).body.data;
  assertError(await request(`${path}/${task.id}`, { method: "PATCH" }), 400, "VALIDATION_ERROR");
});

test("malformed JSON returns a safe, consistent 400", async t => {
  const request = await startTestApi(t);
  const result = await request(path, { method: "POST", body: '{"privateInput":', headers: { "Content-Type": "application/json" } });
  assertError(result, 400, "INVALID_JSON");
  assert.doesNotMatch(JSON.stringify(result.body), /privateInput|SyntaxError|stack/);
});

test("non-JSON request bodies return 415", async t => {
  const request = await startTestApi(t);
  assertError(await request(path, { method: "POST", body: "title=task" }), 415, "UNSUPPORTED_MEDIA_TYPE");
});

test("invalid path encoding returns a client error rather than a 500", async t => {
  const request = await startTestApi(t);
  assertError(await request(`${path}/%zz`), 400, "INVALID_PATH");
});

test("unsupported JSON charset returns a consistent 415", async t => {
  const request = await startTestApi(t);
  assertError(await request(path, {
    method: "POST", body: '{"title":"Triage"}',
    headers: { "Content-Type": "application/json; charset=iso-8859-1" },
  }), 415, "UNSUPPORTED_MEDIA_TYPE");
});

test("oversized JSON returns 413", async t => {
  const request = await startTestApi(t);
  assertError(await createTask(request, { title: "x".repeat(20_000) }), 413, "PAYLOAD_TOO_LARGE");
});

test("unknown routes and unsupported methods return consistent JSON 404", async t => {
  const request = await startTestApi(t);
  assertError(await request("/does-not-exist"), 404, "ROUTE_NOT_FOUND");
  assertError(await request(path, { method: "PUT", json: { title: "Triage" } }), 404, "ROUTE_NOT_FOUND");
});
