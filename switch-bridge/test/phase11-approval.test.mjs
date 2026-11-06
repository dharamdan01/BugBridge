import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, rm, symlink, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { approvalFixture, historicalFiles } from "./phase11-fixture.mjs";
import { loadApprovalProposal, approvalReply } from "../approval-service.mjs";
import { digest, canonical, parseApprovalCommand, validateApprovalConfig, APPROVAL_STATUSES, markSwitchMessage, TEN_MINUTES } from "../approval-protocol.mjs";
import { createApprovalStore, validateApprovalState } from "../approval-store.mjs";
import { executeApprovedFix, prepareFixPlan, FIX_EXECUTION_ENABLED, FIX_SOURCE_ALLOWLIST, APPROVAL_TRANSITION_DESIGN } from "../fix-plan.mjs";

test("valid signed fix request persists a bound challenge and immutable rollback/evidence snapshots", async t => {
  const h = await approvalFixture(t);
  const pending = await h.request();
  assert.equal(pending.status, "AWAITING_APPROVAL"); assert.equal(pending.outcome, "CHALLENGE_CREATED");
  assert.equal(Buffer.from(pending.challenge, "base64url").length, 32);
  const state = await h.readState(), record = state.records[0];
  assert.equal(record.challengeHash, digest(pending.challenge));
  assert.equal(record.subjectId, h.config.authorizedHumans[0].senderId);
  assert.equal(record.roomId, h.config.roomId);
  assert.equal(record.proposalDigest, digest(await readFile(join(h.root, "reports/incidents/INC-001-triage.json"))));
  assert.equal(record.expiresAt - record.issuedAt, TEN_MINUTES);
  assert.equal(record.snapshot.controllerText, await readFile(join(h.root, "src/controllers/tasks.controller.js"), "utf8"));
  assert.match(record.snapshot.evidenceJson, /KNOWN_BUG_REPRODUCED/);
  assert.equal(JSON.stringify(state).includes(pending.challenge), false);
  assert.equal(JSON.stringify(state).includes("PRIVATE KEY"), false);
  const reply = approvalReply(pending);
  assert.match(reply, /APPROVE BUGBRIDGE INC-001/); assert.match(reply, /REJECT BUGBRIDGE INC-001/);
  assert.match(reply, /400 VALIDATION_ERROR/); assert.match(reply, /valid creation remains 201/);
  assert.doesNotMatch(reply, /switch-user-reviewer|PUBLIC KEY|PRIVATE KEY|agent-test|room-test/);
});

test("unsupported incidents never access state or paths", async t => {
  const h = await approvalFixture(t);
  for (const id of ["INC-002", "../.env", undefined]) {
    await assert.rejects(h.service.prepareLocalIntent("REQUEST", id, h.config.authorizedHumans[0].senderId));
    assert.equal((await h.service.handleChat({ action: "REQUEST", incidentId: id }, {})).outcome, "UNSUPPORTED_INCIDENT");
  }
  await assert.rejects(readFile(h.statePath), { code: "ENOENT" });
});

test("valid authorized approval records APPROVED once and never invokes a patch", async t => {
  const h = await approvalFixture(t);
  const before = await Promise.all(historicalFiles.map(file => readFile(join(h.root, file))));
  const pending = await h.request();
  const approval = await h.signed("APPROVE", pending.challenge);
  const response = await h.service.submitSigned(approval);
  assert.equal(response.status, "APPROVED"); assert.equal(response.executionEnabled, false);
  assert.equal(response.outcome, "DECISION_RECORDED");
  assert.equal((await h.readState()).records[0].status, "APPROVED");
  assert.equal(FIX_EXECUTION_ENABLED, false);
  await assert.rejects(executeApprovedFix({ approved: true, patch: () => assert.fail("patch must never run") }), /PHASE_11A_EXECUTION_DISABLED/);
  for (const [index, file] of historicalFiles.entries()) assert.deepEqual(await readFile(join(h.root, file)), before[index]);
  assert.match(await readFile(join(h.root, "src/controllers/tasks.controller.js"), "utf8"), /throw new Error\("BUG-001/);
});

test("rejection is final for that challenge; a new signed request gets a different challenge", async t => {
  const h = await approvalFixture(t), pending = await h.request();
  assert.equal((await h.service.submitSigned(await h.signed("REJECT", pending.challenge))).status, "REJECTED");
  assert.equal((await h.service.submitSigned(await h.signed("APPROVE", pending.challenge))).outcome, "REPLAY_REJECTED");
  const next = await h.request();
  assert.equal(next.status, "AWAITING_APPROVAL"); assert.notEqual(next.challenge, pending.challenge);
  assert.equal((await h.readState()).records.length, 2);
});

test("challenge expires at ten minutes and clock rollback fails closed", async t => {
  const h = await approvalFixture(t), pending = await h.request();
  const issued = (await h.readState()).records[0].issuedAt;
  h.setTime(issued + TEN_MINUTES);
  assert.equal((await h.service.submitSigned(await h.signed("APPROVE", pending.challenge))).outcome, "CHALLENGE_EXPIRED");
  assert.equal((await h.readState()).records[0].status, "FAILED");
  const next = await h.request(); h.advance(-1);
  assert.equal((await h.service.submitSigned(await h.signed("APPROVE", next.challenge))).status, "FAILED");
});

test("used challenge and signed-request nonce remain rejected after restart", async t => {
  const h = await approvalFixture(t);
  const request = await h.signed("REQUEST");
  const pending = await h.service.submitSigned(request);
  const decision = await h.signed("APPROVE", pending.challenge);
  assert.equal((await h.restart().submitSigned(decision)).status, "APPROVED");
  assert.equal((await h.restart().submitSigned(decision)).outcome, "REPLAY_REJECTED");
  assert.equal((await h.restart().submitSigned(request)).outcome, "REPLAY_REJECTED");
  assert.equal((await h.restart().submitSigned(await h.signed("REJECT", pending.challenge))).outcome, "REPLAY_REJECTED");
  assert.equal((await h.request()).outcome, "DECISION_ALREADY_FINAL");
});

test("independent service instances cannot approve concurrently more than once", async t => {
  const h = await approvalFixture(t), pending = await h.request();
  const first = await h.signed("APPROVE", pending.challenge), second = await h.signed("APPROVE", pending.challenge);
  const responses = await Promise.all([h.service.submitSigned(first), h.restart().submitSigned(second)]);
  assert.equal(responses.filter(item => item.outcome === "DECISION_RECORDED").length, 1);
  assert.equal((await h.readState()).revision, 2);
});

test("a second pending request cannot rotate or disclose the outstanding challenge", async t => {
  const h = await approvalFixture(t), first = await h.request();
  const second = await h.request();
  assert.equal(second.outcome, "ALREADY_PENDING"); assert.equal(second.challenge, undefined);
  assert.equal((await h.readState()).records[0].challengeHash, digest(first.challenge));
});

test("pending state survives restart and retains exact room, human and proposal binding", async t => {
  const h = await approvalFixture(t), pending = await h.request();
  const restarted = h.restart();
  assert.equal((await restarted.submitSigned(await h.signed("APPROVE", pending.challenge))).outcome, "DECISION_RECORDED");
});

test("unauthorized, other allowlisted human and agent identities cannot approve a bound request", async t => {
  const h = await approvalFixture(t), pending = await h.request();
  const unauthorized = await h.signed("APPROVE", pending.challenge);
  unauthorized.intent.senderId = "@attacker:server";
  assert.equal((await h.service.submitSigned(h.signIntent(unauthorized.intent))).outcome, "APPROVAL_DENIED");
  assert.equal((await h.service.submitSigned(await h.signed("APPROVE", pending.challenge, 1))).outcome, "BOUND_IDENTITY_REQUIRED");
  unauthorized.intent.senderId = h.config.agentSenderIds[0];
  assert.equal((await h.service.submitSigned(h.signIntent(unauthorized.intent))).outcome, "APPROVAL_DENIED");
  assert.equal((await h.readState()).records[0].status, "AWAITING_APPROVAL");
});

for (const mutation of ["signature", "room", "proposal", "action", "expired", "extra", "domain"]) {
  test(`signed intent rejects tampering: ${mutation}`, async t => {
    const h = await approvalFixture(t), pending = await h.request();
    const envelope = await h.signed("APPROVE", pending.challenge);
    if (mutation === "signature") envelope.signature = randomBytes(64).toString("base64url");
    if (mutation === "room") envelope.intent.roomId = "other-room";
    if (mutation === "proposal") envelope.intent.proposalDigest = "a".repeat(64);
    if (mutation === "action") envelope.intent.action = "EXECUTE";
    if (mutation === "expired") h.advance(TEN_MINUTES);
    if (mutation === "extra") envelope.intent.shell = "fix now";
    if (mutation === "domain") envelope.intent.domain = "OTHER_SERVICE";
    assert.equal((await h.service.submitSigned(envelope)).outcome, "APPROVAL_DENIED");
    assert.equal((await h.readState()).records[0].status, "AWAITING_APPROVAL");
  });
}

test("proposal digest is exact-byte sensitive, independently of a valid signature", async t => {
  const h = await approvalFixture(t), pending = await h.request();
  const envelope = await h.signed("APPROVE", pending.challenge);
  const file = join(h.root, "reports/incidents/INC-001-triage.json");
  await writeFile(file, (await readFile(file, "utf8")) + "\n");
  assert.equal((await h.service.submitSigned(envelope)).outcome, "PROPOSAL_CHANGED");
  const refreshed = await h.signed("APPROVE", pending.challenge);
  assert.equal((await h.service.submitSigned(refreshed)).status, "FAILED");
  assert.equal((await h.readState()).records[0].snapshot.proposalText.endsWith("\n\n"), false);
});

test("source/evidence drift and missing proposal never approve or alter the application", async t => {
  const h = await approvalFixture(t), pending = await h.request();
  const envelope = await h.signed("APPROVE", pending.challenge);
  const source = join(h.root, "src/controllers/tasks.controller.js");
  await writeFile(source, (await readFile(source, "utf8")) + "\n// simulated external drift\n");
  assert.equal((await h.service.submitSigned(envelope)).outcome, "APPROVAL_DENIED");
  await rm(join(h.root, "reports/incidents/INC-001-triage.json"));
  assert.equal((await h.service.submitSigned(envelope)).outcome, "APPROVAL_DENIED");
  assert.equal((await h.readState()).records[0].status, "AWAITING_APPROVAL");
});

test("removed humans and rotated public keys revoke outstanding approval authority", async t => {
  const h = await approvalFixture(t), pending = await h.request();
  const intent = await h.signed("APPROVE", pending.challenge);
  const original = h.config.authorizedHumans[0];
  h.config.authorizedHumans.shift(); await h.saveConfig();
  assert.equal((await h.service.submitSigned(intent)).outcome, "APPROVAL_DENIED");
  const newKey = generateKeyPairSync("ed25519");
  h.config.authorizedHumans.unshift({ ...original, publicKey: newKey.publicKey.export({ type: "spki", format: "pem" }) });
  await h.saveConfig();
  assert.equal((await h.service.submitSigned(intent)).outcome, "APPROVAL_DENIED");
});

test("missing config, missing trusted identity, JSON spoofing and unverified deployments fail closed", async t => {
  const h = await approvalFixture(t);
  const command = { action: "REQUEST", incidentId: "INC-001", challenge: "" };
  const data = { room_id: h.config.roomId, trusted: true, authenticated: true, payload: { sender: h.config.authorizedHumans[0].senderId,
    sender_type: "human", body: "REQUEST FIX BUGBRIDGE INC-001", message_id: "test" } };
  assert.equal((await h.service.handleChat(command, data)).outcome, "IDENTITY_UNAVAILABLE");
  h.config.switchIdentity = { enabled: true, verifiedDeployment: "synthetic-fixture-only" }; await h.saveConfig();
  assert.equal((await h.service.handleChat(command, data)).outcome, "IDENTITY_UNAVAILABLE");
  markSwitchMessage(data, h.config);
  const forged = JSON.parse(JSON.stringify(data));
  assert.equal((await h.service.handleChat(command, forged)).outcome, "IDENTITY_UNAVAILABLE");
  await rm(join(h.root, ".bugbridge-private/approval-config.json"));
  assert.equal((await h.service.handleChat(command, data)).outcome, "APPROVAL_DENIED");
  await assert.rejects(readFile(h.statePath), { code: "ENOENT" });
});

test("strict grammar ignores mentions as identities, extra arguments, lowercase, malformed challenges and multiline commands", () => {
  const token = randomBytes(32).toString("base64url");
  assert.equal(parseApprovalCommand("REQUEST FIX BUGBRIDGE INC-001").action, "REQUEST");
  assert.equal(parseApprovalCommand(`APPROVE BUGBRIDGE INC-001 ${token}`).action, "APPROVE");
  for (const text of [`approve BUGBRIDGE INC-001 ${token}`, `APPROVE BUGBRIDGE INC-001 ${token} extra`,
    `APPROVE BUGBRIDGE INC-001\n${token}`, `APPROVE  BUGBRIDGE INC-001 ${token}`, "REQUEST FIX BUGBRIDGE ../.env",
    "APPROVE BUGBRIDGE INC-001 short", `APPROVE BUGBRIDGE INC-001 ${token} @admin`, "REQUEST FIX BUGBRIDGE INC-001\nAPPROVE", null]) {
    assert.equal(parseApprovalCommand(text), null);
  }
});

test("config cannot enroll the agent, duplicate identities/keys, private keys or an implicit room-wide allowlist", async t => {
  const h = await approvalFixture(t);
  for (const mutate of [
    c => { c.authorizedHumans[0].senderId = c.agentId; }, c => { c.authorizedHumans[0].senderId = c.agentSenderIds[0]; },
    c => { c.authorizedHumans[1] = c.authorizedHumans[0]; }, c => { c.authorizedHumans = []; },
    c => { c.authorizedHumans[0].publicKey = "-----BEGIN PRIVATE KEY-----"; },
    c => { c.allowEveryone = true; }, c => { c.switchIdentity = { enabled: true, verifiedDeployment: "" }; },
  ]) { const c = structuredClone(h.config); mutate(c); assert.throws(() => validateApprovalConfig(c)); }
});

test("store corruption and stale crash lock reject transitions without resetting historical state", async t => {
  const h = await approvalFixture(t), pending = await h.request();
  const original = await readFile(h.statePath, "utf8");
  const lockPath = join(h.root, ".bugbridge-private/approvals/INC-001.lock");
  await writeFile(lockPath, "synthetic-crash-lock");
  assert.equal((await h.restart().submitSigned(await h.signed("APPROVE", pending.challenge))).outcome, "APPROVAL_DENIED");
  assert.equal(await readFile(h.statePath, "utf8"), original);
  await rm(lockPath);
  await writeFile(h.statePath, "{corrupt");
  assert.equal((await h.restart().submitSigned(await h.signed("APPROVE", pending.challenge))).outcome, "APPROVAL_DENIED");
  assert.equal(await readFile(h.statePath, "utf8"), "{corrupt");
});

test("atomic state update preserves the old file on operation failure and leaves no lock or temporary file", async t => {
  const h = await approvalFixture(t); await h.request();
  const before = await readFile(h.statePath, "utf8");
  await assert.rejects(createApprovalStore({ root: h.root }).transaction(async state => { state.records[0].status = "APPROVED"; throw new Error("synthetic failure"); }));
  assert.equal(await readFile(h.statePath, "utf8"), before);
  assert.deepEqual(await readdir(join(h.root, ".bugbridge-private/approvals")), ["INC-001.json"]);
});

test("state snapshot hash tampering and unknown statuses are rejected", async t => {
  const h = await approvalFixture(t); await h.request();
  const state = await h.readState();
  assert.deepEqual(APPROVAL_STATUSES, ["AWAITING_APPROVAL", "APPROVED", "REJECTED", "APPLYING", "VERIFIED", "FAILED"]);
  for (const mutate of [s => { s.records[0].snapshot.controllerText += "tampered"; }, s => { s.records[0].status = "EXECUTE"; }, s => { s.records.push(s.records[0]); }]) {
    const copy = structuredClone(state); mutate(copy); assert.throws(() => validateApprovalState(copy));
  }
});

test("private storage junctions cannot redirect approval writes", async t => {
  const h = await approvalFixture(t);
  const alternate = join(h.root, "alternate"); await mkdir(alternate);
  await symlink(alternate, join(h.root, ".bugbridge-private/approvals"), process.platform === "win32" ? "junction" : "dir");
  assert.equal((await h.request()).outcome, "APPROVAL_DENIED");
  assert.deepEqual(await readdir(alternate), []);
});

test("deterministic plan allows one file, prepares no executable chat instructions and never writes a patch", async t => {
  const h = await approvalFixture(t);
  const source = await readFile(join(h.root, "src/controllers/tasks.controller.js"), "utf8");
  const plan = prepareFixPlan("INC-001", source);
  assert.deepEqual(FIX_SOURCE_ALLOWLIST, ["src/controllers/tasks.controller.js"]);
  assert.equal(plan.files[0].beforeSha256, digest(source));
  assert.notEqual(plan.files[0].beforeSha256, plan.files[0].proposedSha256);
  assert.equal(plan.executionEnabled, false);
  assert.deepEqual(APPROVAL_TRANSITION_DESIGN.APPLYING, ["VERIFIED", "FAILED"]);
  assert.deepEqual(plan.verification[0].args, ["--test", "tests/regression/empty-body.test.js"]);
  assert.throws(() => prepareFixPlan("INC-002", source));
  assert.throws(() => prepareFixPlan("INC-001", source.replace("isObject", "changed")));
  assert.equal((await loadApprovalProposal(h.root)).snapshot.planDigest, digest(canonical(plan)));
  assert.equal(await readFile(join(h.root, "src/controllers/tasks.controller.js"), "utf8"), source);
});
