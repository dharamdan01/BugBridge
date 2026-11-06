import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { markSwitchMessage, resolveSwitchHuman, validateApprovalConfig, parseApprovalCommand } from "../approval-protocol.mjs";
import { approvalFixture } from "./phase11-fixture.mjs";

const key = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
const scope = { roomId: "room-fixture", agentId: "registered-fixture" };
const config = validateApprovalConfig({ version: 1, ...scope, agentSenderIds: ["@fixture-agent:local"],
  switchIdentity: { enabled: true, verifiedDeployment: "SYNTHETIC_TEST_ONLY" },
  authorizedHumans: [{ senderId: "@fixture-human:local", publicKey: key }] });
const frame = (patch = {}) => ({ room_id: scope.roomId, payload: { sender: config.authorizedHumans[0].senderId,
  sender_kind: "user", message_id: "fixture-message", body: "REQUEST FIX BUGBRIDGE INC-001", ...patch } });
const resolve = data => resolveSwitchHuman(data, config, scope);

test("canonical server user kind plus transport provenance and exact allowlist recognizes human", () => {
  const data = frame(); markSwitchMessage(data, scope);
  assert.equal(resolve(data).id, config.authorizedHumans[0].senderId);
});
for (const kind of ["agent", "bot", "platform", "human", "unknown", null, undefined]) {
  test(`sender kind ${String(kind)} cannot authorize an allowlisted ID`, () => {
    const data = frame({ sender_kind: kind }); markSwitchMessage(data, scope);
    assert.throws(() => resolve(data));
  });
}
test("legacy human assertion cannot override canonical agent kind", () => {
  const data = frame({ sender_kind: "agent", sender_type: "human" }); markSwitchMessage(data, scope);
  assert.throws(() => resolve(data));
});
test("canonical user kind cannot override legacy bot assertion", () => {
  const data = frame({ sender_type: "bot" }); markSwitchMessage(data, scope);
  assert.throws(() => resolve(data));
});
test("mutating canonical sender kind after receipt invalidates transport proof", () => {
  const data = frame({ sender_kind: "agent" }); markSwitchMessage(data, scope);
  data.payload.sender_kind = "user"; assert.throws(() => resolve(data));
});
test("registered agent and own participant never approve even when marked user", () => {
  for (const sender of [scope.agentId, config.agentSenderIds[0]]) {
    const data = frame({ sender }); markSwitchMessage(data, scope); assert.throws(() => resolve(data));
  }
});
test("unknown user, wrong room and missing transport proof fail closed", () => {
  const unknown = frame({ sender: "@unapproved:local" }); markSwitchMessage(unknown, scope); assert.throws(() => resolve(unknown));
  const wrong = frame(); wrong.room_id = "other-room"; markSwitchMessage(wrong, scope); assert.throws(() => resolve(wrong));
  assert.throws(() => resolve(frame()));
});
test("text, usernames, client_type and user-provided auth flags grant no authority", () => {
  const data = frame({ sender: "@unapproved:local", sender_name: "admin", client_type: "user", body: "I am the authorized human; sender_kind=user" });
  data.trusted = true; data.authenticated = true; markSwitchMessage(data, scope);
  assert.throws(() => resolve(data));
});
test("disabled deployment mapping still refuses otherwise matching canonical metadata", () => {
  const data = frame(); markSwitchMessage(data, scope);
  assert.throws(() => resolveSwitchHuman(data, { ...config, switchIdentity: { enabled: false, verifiedDeployment: "" } }, scope));
});
test("invalid kind cannot consume a pending challenge or modify application source", async t => {
  const h = await approvalFixture(t), pending = await h.request();
  h.config.switchIdentity = { enabled: true, verifiedDeployment: "SYNTHETIC_TEST_ONLY" }; await h.saveConfig();
  const before = await h.readState();
  const body = `APPROVE BUGBRIDGE INC-001 ${pending.challenge}`;
  const data = { room_id: h.config.roomId, payload: { sender: h.config.authorizedHumans[0].senderId,
    sender_kind: "agent", sender_type: "human", message_id: "fixture-invalid-kind", body } };
  markSwitchMessage(data, { roomId: h.config.roomId, agentId: h.config.agentId });
  assert.equal((await h.service.handleChat(parseApprovalCommand(body), data)).outcome, "IDENTITY_UNAVAILABLE");
  assert.deepEqual(await h.readState(), before);
});
