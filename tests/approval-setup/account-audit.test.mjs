import test from "node:test";
import assert from "node:assert/strict";
import { auditMattermostAccount } from "../../scripts/audit-mattermost-account.mjs";

const schema = { schema: "public", table: "users", id_column: "id", bot_column: "isbot", delete_column: "deleteat" };
const options = { container: "db-fixture", database: "mattermost_fixture", role: "reader_fixture", userId: "fixture-user",
  env: { PATH: "fixture-path", SWITCH_AGENT_KEY: "SYNTHETIC_CREDENTIAL", PGPASSWORD: "SYNTHETIC_DB_SECRET" } };
function runner(responses) {
  const calls = [];
  const executeImpl = (program, args, config) => {
    const output = responses[calls.length];
    const call = { program, args, config }; calls.push(call);
    const promise = Promise.resolve({ stdout: output.map(row => JSON.stringify(row)).join("\n") });
    promise.child = { stdin: { on() {}, end(sql) { call.sql = sql; } } }; return promise;
  };
  return { calls, executeImpl };
}
test("authoritative false is read as boolean; output contains no full ID or credentials", async () => {
  const h = runner([[schema], [{ is_bot: false, is_active: true, account_id_matches: true, password: "SYNTHETIC_DB_SECRET" }]]);
  const result = await auditMattermostAccount({ ...options, executeImpl: h.executeImpl });
  assert.equal(result.isBot, false); assert.equal(result.classification, "NON_BOT_ACTIVE_ACCOUNT_RECORD");
  assert.equal(result.enrollmentPerformed, false); assert.equal(result.modified, false);
  assert.doesNotMatch(JSON.stringify(result), /fixture-user|SYNTHETIC|password/);
  for (const call of h.calls) {
    assert.equal(call.config.shell, false); assert.equal(call.config.windowsHide, true);
    assert.deepEqual(call.config.env, { PATH: "fixture-path" }); assert.ok(call.args.includes("-X")); assert.ok(call.args.includes("-w"));
    assert.match(call.sql, /BEGIN TRANSACTION READ ONLY/); assert.match(call.sql, /ROLLBACK;\s*$/);
    assert.doesNotMatch(call.sql, /\b(UPDATE|INSERT|DELETE|DROP|CREATE|GRANT|REVOKE|ALTER|COMMIT)\b/i);
  }
  assert.match(h.calls[0].sql, /information_schema.columns/);
  assert.match(h.calls[1].sql, /FROM "public"\."users"/); assert.match(h.calls[1].sql, /= :'user_id'/);
  assert.equal(h.calls[1].sql.includes(options.userId), false);
});
test("known bot and inactive account are explicitly rejected classifications", async () => {
  for (const row of [{ is_bot: true, is_active: true, account_id_matches: true }, { is_bot: false, is_active: false, account_id_matches: true }]) {
    const result = await auditMattermostAccount({ ...options, executeImpl: runner([[schema], [row]]).executeImpl });
    assert.match(result.classification, /REJECT$/);
  }
});
for (const bad of [{ is_active: true, account_id_matches: true }, { is_bot: null, is_active: true, account_id_matches: true },
  { is_bot: "false", is_active: true, account_id_matches: true }, { is_bot: false, is_active: true, account_id_matches: false }]) {
  test(`missing/unknown classification never defaults to human: ${JSON.stringify(bad)}`, async () => {
    await assert.rejects(auditMattermostAccount({ ...options, executeImpl: runner([[schema], [bad]]).executeImpl }), /ACCOUNT_CLASSIFICATION_UNVERIFIED/);
  });
}
test("missing/ambiguous schema or unsafe metadata prevents account query", async () => {
  for (const schemas of [[], [schema, schema], [{ ...schema, table: 'users";DROP' }]]) {
    const h = runner([schemas]); await assert.rejects(auditMattermostAccount({ ...options, executeImpl: h.executeImpl }), /ACCOUNT_SCHEMA_UNVERIFIED/);
    assert.equal(h.calls.length, 1);
  }
});
test("missing or ambiguous accounts cannot classify", async () => {
  for (const rows of [[], [{ is_bot: false }, { is_bot: false }]]) {
    await assert.rejects(auditMattermostAccount({ ...options, executeImpl: runner([[schema], rows]).executeImpl }), /ACCOUNT_CLASSIFICATION_UNVERIFIED/);
  }
});
test("invalid scope and raw subprocess secrets stay private", async () => {
  await assert.rejects(auditMattermostAccount({ ...options, role: "--unsafe" }), /ACCOUNT_AUDIT_SCOPE_REQUIRED/);
  await assert.rejects(auditMattermostAccount({ ...options, executeImpl: () => { throw new Error("SYNTHETIC_CREDENTIAL"); } }), error => error.message === "ACCOUNT_AUDIT_READ_UNAVAILABLE");
});
