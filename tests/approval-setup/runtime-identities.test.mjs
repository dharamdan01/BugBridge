import test from "node:test";
import assert from "node:assert/strict";
import { inspectSwitchIdentities } from "../../scripts/inspect-switch-identities.mjs";

const env = { PATH: "fixture-path", SWITCH_AGENT_ID: "registered-fixture", SWITCH_ROOM_ID: "room-fixture", SWITCH_AGENT_KEY: "SYNTHETIC_CREDENTIAL", PRIVATE_KEY: "SYNTHETIC_PRIVATE_KEY" };
function fixture(stdout = "") {
  const calls = []; let input, eof = false;
  const executeImpl = (program, args, options) => {
    calls.push({ program, args, options });
    const promise = Promise.resolve({ stdout, stderr: "SYNTHETIC_CREDENTIAL" });
    promise.child = { stdin: { on() {}, end(value) { input = value; eof = true; } } };
    return promise;
  };
  return { calls, executeImpl, input: () => input, eof: () => eof };
}
const defaults = { container: "postgres-fixture", database: "db_fixture", role: "reader_fixture", mattermostUserId: "human-fixture", env };
test("runtime mapping uses fixed read-only psql scope, typed parameters and EOF; no Switch session", async () => {
  const h = fixture(), result = await inspectSwitchIdentities({ ...defaults, executeImpl: h.executeImpl });
  assert.equal(h.calls.length, 1); const { program, args, options } = h.calls[0];
  assert.match(program, /^docker(?:\.exe)?$/);
  assert.deepEqual(args.slice(0, 5), ["exec", "-i", "postgres-fixture", "psql", "-X"]);
  assert.ok(args.includes("-w")); assert.ok(args.includes("agent_id=registered-fixture")); assert.ok(args.includes("room_id=room-fixture"));
  assert.equal(options.shell, false); assert.equal(options.windowsHide, true); assert.equal(options.timeout, 30_000);
  assert.deepEqual(options.env, { PATH: "fixture-path" }); assert.equal(h.eof(), true);
  const sql = h.input(); assert.match(sql, /BEGIN TRANSACTION READ ONLY;/); assert.match(sql, /ROLLBACK;\s*$/);
  assert.match(sql, /c\.matrix_user_id/); assert.match(sql, /eu\.external_user_id = :'mattermost_user_id'/);
  const executable = sql.replace(/^--.*$/gm, "");
  assert.doesNotMatch(executable, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|COMMIT|set_config)\b/i);
  assert.doesNotMatch(executable, /connection_config|api_keys|password|payload\s*->>\s*'body'|SELECT\s+\*/i);
  assert.equal(result.newSwitchSessionCreated, false); assert.equal(result.enrollmentPerformed, false);
});
test("operator values never become executable SQL or shell syntax", async () => {
  const h = fixture(); const value = "x';DROP_TABLE--";
  await inspectSwitchIdentities({ ...defaults, mattermostUserId: value, executeImpl: h.executeImpl });
  assert.equal(h.calls[0].args.includes(`mattermost_user_id=${value}`), true);
  assert.equal(h.input().includes(value), false); assert.equal(h.calls[0].options.shell, false);
});
for (const field of ["container", "database", "role", "mattermostUserId"]) test(`invalid ${field} rejected before subprocess`, async () => {
  const h = fixture(); await assert.rejects(inspectSwitchIdentities({ ...defaults, [field]: "bad\nargument", executeImpl: h.executeImpl }), /NON_SECRET_SCOPE_REQUIRED/);
  assert.equal(h.calls.length, 0);
});
for (const field of ["SWITCH_AGENT_ID", "SWITCH_ROOM_ID"]) test(`missing ${field} fails closed`, async () => {
  const h = fixture(), local = { ...env }; delete local[field];
  await assert.rejects(inspectSwitchIdentities({ ...defaults, env: local, executeImpl: h.executeImpl }), /NON_SECRET_SCOPE_REQUIRED/);
  assert.equal(h.calls.length, 0);
});
test("only allowlisted metadata survives; no username/text/credential-based authentication", async () => {
  const h = fixture(JSON.stringify({ section: "human", data: { human_participant_id: "@opaque:fixture", client_type: "user", password: "SYNTHETIC_CREDENTIAL", body: "private", username: "admin" } }));
  const result = await inspectSwitchIdentities({ ...defaults, executeImpl: h.executeImpl });
  assert.deepEqual(result.rows[0].data, { human_participant_id: "@opaque:fixture", client_type: "user" });
  assert.match(result.identityVerification, /^UNVERIFIED/); assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_CREDENTIAL|"username"|"body"/);
});
test("database/subprocess failure exposes no credentials or raw exception", async () => {
  const executeImpl = () => { throw new Error("SYNTHETIC_CREDENTIAL"); };
  await assert.rejects(inspectSwitchIdentities({ ...defaults, executeImpl }), error => error.message === "AUTHORIZED_DATABASE_READ_UNAVAILABLE");
});
test("unrecognized or malformed output is refused without arbitrary output", async () => {
  for (const output of ["SYNTHETIC_CREDENTIAL", JSON.stringify({ section: "password", data: {} }), JSON.stringify({ section: "human", data: [] })]) {
    await assert.rejects(inspectSwitchIdentities({ ...defaults, executeImpl: fixture(output).executeImpl }), error => error.message === "DATABASE_RESPONSE_NOT_VERIFIED");
  }
});
