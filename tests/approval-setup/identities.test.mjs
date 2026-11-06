import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseIdentities, candidateFields } from "../../scripts/diagnose-approval-identities.mjs";

const env = { SWITCH_AGENT_ID: "registered-agent-fixture", SWITCH_AGENT_KEY: "FIXTURE_SECRET_TOKEN", SWITCH_ROOM_ID: "room-fixture" };
const objectSchema = (properties = {}, required = []) => ({ type: "object", properties, required });
const defaultSchemas = {
  list_participants: objectSchema({ room_id: { type: "string" } }, ["room_id"]),
  get_agent_detail: objectSchema({ agent_id: { type: "string" } }, ["agent_id"]),
  read_context: objectSchema({ room_id: { type: "string" }, limit: { type: "integer" } }, ["room_id"]),
};
function server({ schemas = defaultSchemas, result, fail, redirect = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (fail) throw new Error(env.SWITCH_AGENT_KEY);
    if (redirect) return new Response(null, { status: 302, headers: { location: "http://untrusted.invalid/" } });
    if (options.method === "GET") return Response.json({ operations: Object.fromEntries(Object.entries(schemas).map(([name, input_schema]) => [name, { input_schema }])) });
    return Response.json({ result: result ?? { participants: [{ participant_id: "@opaque-human:fixture", type: "user", display_name: "not-authority" },
      { participant_id: "@opaque-agent:fixture", type: "agent", agent_id: env.SWITCH_AGENT_ID }] } });
  };
  return { calls, fetchImpl };
}
test("authenticated diagnostic uses only fixed HTTP reads and existing scope; never grants authority", async () => {
  const h = server(), report = await diagnoseIdentities({ env, fetchImpl: h.fetchImpl });
  assert.equal(h.calls.length, 4);
  assert.equal(report.newSessionCreated, false); assert.equal(report.authorizationGranted, false);
  assert.equal(report.humanParticipantIdentity, "UNVERIFIED"); assert.equal(report.agentParticipantIdentity, "UNVERIFIED");
  assert.match(JSON.stringify(report), /@opaque-human:fixture/);
  for (const { url, options } of h.calls) {
    assert.match(url, /^http:\/\/127\.0\.0\.1:8000\/agents\/registered-agent-fixture\/ops(?:\/(list_participants|get_agent_detail|read_context))?$/);
    assert.equal(options.headers.Authorization, `Bearer ${env.SWITCH_AGENT_KEY}`);
    assert.equal(options.redirect, "error"); assert.ok(options.signal);
    assert.equal(options.headers["X-Switch-Connection-Id"], undefined);
  }
  assert.deepEqual(JSON.parse(h.calls[1].options.body), { room_id: env.SWITCH_ROOM_ID });
  assert.deepEqual(JSON.parse(h.calls[2].options.body), { agent_id: env.SWITCH_AGENT_ID });
  assert.deepEqual(JSON.parse(h.calls[3].options.body), { room_id: env.SWITCH_ROOM_ID, limit: 10 });
});
test("context-only operations fail closed without opening or inventing a connection", async () => {
  const h = server({ schemas: { ...defaultSchemas, list_participants: objectSchema(), read_context: objectSchema({ limit: { type: "integer" } }) } });
  const report = await diagnoseIdentities({ env, fetchImpl: h.fetchImpl });
  assert.equal(h.calls.length, 2);
  assert.equal(report.operations[0].reason, "EXISTING_CONNECTION_CONTEXT_REQUIRED");
  assert.equal(report.operations[2].reason, "EXISTING_CONNECTION_CONTEXT_REQUIRED");
});
test("explicit existing connection UUID may be reused for HTTP context only", async () => {
  const h = server({ schemas: { ...defaultSchemas, list_participants: objectSchema() } });
  const connectionId = "11111111-1111-4111-8111-111111111111";
  await diagnoseIdentities({ env, fetchImpl: h.fetchImpl, connectionId });
  assert.equal(h.calls[1].options.headers["X-Switch-Connection-Id"], connectionId);
  assert.equal(h.calls[2].options.headers["X-Switch-Connection-Id"], undefined);
  assert.deepEqual(JSON.parse(h.calls[1].options.body), {});
});
for (const missing of Object.keys(env)) test(`missing ${missing} fails before network`, async () => {
  const local = { ...env }; delete local[missing]; const h = server();
  await assert.rejects(diagnoseIdentities({ env: local, fetchImpl: h.fetchImpl }), /SWITCH_CONFIGURATION_REQUIRED/);
  assert.equal(h.calls.length, 0);
});
test("arbitrary connection identifiers rejected before network", async () => {
  const h = server(); await assert.rejects(diagnoseIdentities({ env, fetchImpl: h.fetchImpl, connectionId: "guess\nheader" }), /INVALID_EXISTING_CONNECTION_ID/);
  assert.equal(h.calls.length, 0);
});
test("new/unsupported required arguments are not guessed", async () => {
  const h = server({ schemas: { list_participants: objectSchema({ room_id: {} }, ["room_id", "unverified_user"]) } });
  const report = await diagnoseIdentities({ env, fetchImpl: h.fetchImpl });
  assert.equal(h.calls.length, 1); assert.equal(report.operations[0].reason, "ADDITIONAL_ARGUMENTS_REQUIRED");
});
test("unbounded history is not requested", async () => {
  const h = server({ schemas: { read_context: objectSchema({ room_id: {} }) } });
  const report = await diagnoseIdentities({ env, fetchImpl: h.fetchImpl });
  assert.equal(h.calls.length, 1); assert.equal(report.operations[2].reason, "BOUNDED_HISTORY_UNSUPPORTED");
});
test("names, message text, credentials, keys and self-declared auth flags cannot become proof", async () => {
  const h = server({ result: { messages: [{ sender: "@opaque:fixture", sender_name: "admin", authenticated: true,
    body: env.SWITCH_AGENT_KEY, publicKey: "PRIVATE KEY MATERIAL", payload: { sender: env.SWITCH_AGENT_KEY, sender_type: "user" } }] } });
  const report = await diagnoseIdentities({ env, fetchImpl: h.fetchImpl }), output = JSON.stringify(report);
  assert.doesNotMatch(output, /FIXTURE_SECRET_TOKEN|PRIVATE KEY MATERIAL|sender_name|authenticated":true/);
  assert.match(output, /REDACTED/); assert.match(output, /@opaque:fixture/);
  assert.equal(report.authorizationGranted, false);
});
test("only known result containers are traversed; prose is not parsed into identities", () => {
  assert.deepEqual(candidateFields("Human @invented:fixture", ""), []);
  assert.deepEqual(candidateFields({ malicious: { sender: "@invented:fixture" }, name: "@invented:fixture" }, ""), []);
  assert.equal(candidateFields({ sender: "@opaque:fixture", sender_type: "agent" }, "")[0].fields.sender_type, "agent");
});
test("discovery exceptions never disclose server text or credentials", async () => {
  await assert.rejects(diagnoseIdentities({ env, fetchImpl: server({ fail: true }).fetchImpl }), error => error.message === "OPERATION_DISCOVERY_FAILED");
});
test("HTTP errors are reported by status only", async () => {
  let first = true;
  const h = server();
  const fetchImpl = (...args) => { if (first) { first = false; return h.fetchImpl(...args); } return Promise.resolve(new Response(env.SWITCH_AGENT_KEY, { status: 403 })); };
  const report = await diagnoseIdentities({ env, fetchImpl });
  assert.equal(report.operations[0].reason, "HTTP_403"); assert.doesNotMatch(JSON.stringify(report), /FIXTURE_SECRET_TOKEN/);
});
test("redirect responses are never accepted", async () => {
  await assert.rejects(diagnoseIdentities({ env, fetchImpl: server({ redirect: true }).fetchImpl }), /OPERATION_DISCOVERY_FAILED/);
});
test("oversized operation responses are bounded and omitted", async () => {
  let first = true; const h = server();
  const report = await diagnoseIdentities({ env, fetchImpl: (...args) => {
    if (first) { first = false; return h.fetchImpl(...args); }
    return Promise.resolve(new Response("x".repeat(270_000)));
  } });
  assert.equal(report.operations[0].reason, "RESPONSE_TOO_LARGE");
});
test("invalid JSON cannot escape as raw exceptions or identities", async () => {
  let first = true; const h = server();
  const report = await diagnoseIdentities({ env, fetchImpl: (...args) => {
    if (first) { first = false; return h.fetchImpl(...args); }
    return Promise.resolve(new Response(env.SWITCH_AGENT_KEY));
  } });
  assert.equal(report.operations[0].reason, "READ_FAILED"); assert.doesNotMatch(JSON.stringify(report), /FIXTURE_SECRET_TOKEN/);
});
