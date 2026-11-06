import test from "node:test";
import assert from "node:assert/strict";
import { once, EventEmitter } from "node:events";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";
import { createMessageHandler, ONLINE_REPLY } from "../message-handler.mjs";
import { createSwitchClient } from "../switch-client.mjs";
import { createApprovalService } from "../approval-service.mjs";
import { createApprovalStore } from "../approval-store.mjs";
import { parseApprovalCommand, markSwitchMessage } from "../approval-protocol.mjs";
import { approvalFixture } from "./phase11-fixture.mjs";

const config = { roomId: "room-test", agentId: "agent-test" };
const message = (body, id = "post-1", sender = "@switch-user-reviewer0:server") => ({ room_id: config.roomId, payload: { body, message_id: id, sender, sender_name: "human", sender_kind: "user" } });
function harness(approvalService) {
  const replies = [], logs = [];
  const handle = createMessageHandler({ ...config, approvalService, sendMessage: async text => { replies.push(text); },
    askCodex: async () => "ASK preserved", log: (event, fields) => logs.push({ event, ...fields }) });
  return { handle, replies, logs };
}

test("approval routing preserves dedup, self protection, exact grammar and safe errors", async () => {
  let calls = 0;
  const h = harness({ handleChat: async () => { calls++; throw new Error("SYNTHETIC_PRIVATE_KEY_approvals"); } });
  const first = message("REQUEST FIX BUGBRIDGE INC-001");
  await h.handle(first); await h.handle(first);
  assert.equal(calls, 1); assert.equal(h.replies.length, 1);
  assert.match(h.replies[0], /INC-001 \| STATUS_UNAVAILABLE \| APPROVAL_DENIED/);
  const token = randomBytes(32).toString("base64url");
  for (const [index, data] of [
    message("request fix BUGBRIDGE INC-001"), message(`APPROVE BUGBRIDGE INC-001 ${token} extra`),
    message(`@other-agent APPROVE BUGBRIDGE INC-001 ${token}`), message("BugBridge approval: REQUEST FIX BUGBRIDGE INC-001"),
    message("REQUEST FIX BUGBRIDGE INC-001", "agent", config.agentId),
    { ...message("REQUEST FIX BUGBRIDGE INC-001"), room_id: "other-room" }, null,
  ].entries()) await h.handle(data, index + 30);
  assert.equal(calls, 1);
  await h.handle(message("PING BUGBRIDGE", "ping"));
  await h.handle(message("ASK BUGBRIDGE: question", "ask"));
  assert.equal(h.replies.at(-2), ONLINE_REPLY); assert.match(h.replies.at(-1), /ASK preserved/);
  assert.doesNotMatch(JSON.stringify([h.replies, h.logs]), /SYNTHETIC_PRIVATE_KEY_approvals/);
});

test("chat text or user-supplied trusted metadata cannot authorize even with a valid pending challenge", async t => {
  const h = await approvalFixture(t), pending = await h.request();
  h.config.switchIdentity = { enabled: true, verifiedDeployment: "synthetic-protocol-test" }; await h.saveConfig();
  const body = `APPROVE BUGBRIDGE INC-001 ${pending.challenge}`;
  const data = message(body); data.authenticated_sender = h.config.authorizedHumans[0].senderId; data.trusted = true;
  assert.equal((await h.service.handleChat(parseApprovalCommand(body), data)).outcome, "IDENTITY_UNAVAILABLE");
  markSwitchMessage(data, config);
  data.payload.sender = h.config.authorizedHumans[1].senderId;
  assert.equal((await h.service.handleChat(parseApprovalCommand(body), data)).outcome, "IDENTITY_UNAVAILABLE");
  assert.equal((await h.readState()).records[0].status, "AWAITING_APPROVAL");
});

test("synthetic trusted transport still rejects wrong room, unauthorized human, agent and substituted command", async t => {
  const h = await approvalFixture(t);
  h.config.switchIdentity = { enabled: true, verifiedDeployment: "synthetic-protocol-test" }; await h.saveConfig();
  const body = "REQUEST FIX BUGBRIDGE INC-001", command = parseApprovalCommand(body);
  for (const data of [message(body, "unauthorized", "@attacker:server"),
    message(body, "self", h.config.agentSenderIds[0]),
    { ...message(body), room_id: "other-room" }]) {
    markSwitchMessage(data, config);
    assert.notEqual((await h.service.handleChat(command, data)).outcome, "CHALLENGE_CREATED");
  }
  const data = message(body, "substituted"); markSwitchMessage(data, config);
  assert.equal((await h.service.handleChat({ action: "APPROVE", incidentId: "INC-001", challenge: randomBytes(32).toString("base64url") }, data)).outcome, "MALFORMED_COMMAND");
});

test("authenticated message replay is rejected by persistent ledger after handler restart", async t => {
  const h = await approvalFixture(t);
  h.config.switchIdentity = { enabled: true, verifiedDeployment: "synthetic-protocol-test" }; await h.saveConfig();
  const request = message("REQUEST FIX BUGBRIDGE INC-001"); markSwitchMessage(request, config);
  const command = parseApprovalCommand(request.payload.body);
  assert.equal((await h.service.handleChat(command, request)).outcome, "CHALLENGE_CREATED");
  assert.equal((await h.restart().handleChat(command, request)).outcome, "REPLAY_REJECTED");
  assert.equal((await h.readState()).records.length, 1);
});

test("local Switch protocol fixture authenticates synthetic metadata, routes same-room decisions and keeps heartbeats responsive", { timeout: 10_000 }, async t => {
  const h = await approvalFixture(t);
  h.config.switchIdentity = { enabled: true, verifiedDeployment: "SYNTHETIC_ONLY_NOT_LIVE_VERIFIED" }; await h.saveConfig();
  const events = new EventEmitter(), logs = [], posts = [], sockets = [];
  const log = (event, fields) => { logs.push({ event, ...fields }); events.emit(event, fields); };
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/agents/agent-test/message");
    assert.equal(request.headers.authorization, "Bearer synthetic-key");
    let raw = ""; for await (const chunk of request) raw += chunk;
    posts.push(JSON.parse(raw)); response.writeHead(200).end("{}");
  });
  const wss = new WebSocketServer({ server });
  let client, release;
  const store = createApprovalStore({ root: h.root });
  let delay = true;
  const service = createApprovalService({ root: h.root, ...config, store: { transaction: async operation => {
    if (delay) { delay = false; const pending = new Promise(resolve => { release = resolve; }); events.emit("approval_waiting"); await pending; }
    return store.transaction(operation);
  } } });
  const handler = createMessageHandler({ ...config, log, approvalService: service, sendMessage: text => client.sendMessage(text), askCodex: async () => "ASK preserved" });
  t.after(async () => {
    release?.(); client?.stop(); for (const socket of wss.clients) socket.terminate();
    await new Promise(r => wss.close(r)); server.closeAllConnections(); await new Promise(r => server.close(r));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  wss.on("connection", socket => { sockets.push(socket); socket.send(JSON.stringify({ event: "connection_state", data: { rooms: [config.roomId] } })); });
  client = createSwitchClient({ ...config, agentKey: "synthetic-key", baseUrl: `http://127.0.0.1:${server.address().port}`, log, onMessage: handler });
  const wait = (emitter, event) => once(emitter, event, { signal: AbortSignal.timeout(4000) });
  const connected = wait(events, "switch_connected"); client.start(); await connected;
  const socket = sockets[0];
  const send = (data, id) => socket.send(JSON.stringify({ event: "message", id, data }));
  const waiting = wait(events, "approval_waiting"); send(message("REQUEST FIX BUGBRIDGE INC-001"), 1); await waiting;
  const pong = wait(socket, "message"); socket.send(JSON.stringify({ event: "ping", id: 2 }));
  assert.deepEqual(JSON.parse((await pong)[0].toString()), { type: "pong", cursor: 2 });
  const pingReply = wait(events, "reply_sent"); send(message("PING BUGBRIDGE", "ping"), 3); await pingReply;
  assert.equal(posts[0].content, ONLINE_REPLY);
  const challengeReply = wait(events, "reply_sent"); release(); await challengeReply;
  const challenge = /APPROVE BUGBRIDGE INC-001 ([A-Za-z0-9_-]{43})/.exec(posts[1].content)[1];
  assert.match(posts[1].content, /AWAITING_APPROVAL/);
  const duplicate = wait(events, "message_ignored"); send(message("REQUEST FIX BUGBRIDGE INC-001"), 1);
  assert.equal((await duplicate)[0].reason, "duplicate");
  const approved = wait(events, "reply_sent"); send(message(`APPROVE BUGBRIDGE INC-001 ${challenge}`, "approve"), 4); await approved;
  assert.match(posts[2].content, /INC-001 \| APPROVED/);
  assert.ok(posts.every(post => post.room_id === config.roomId));
  assert.equal((await h.readState()).records[0].status, "APPROVED");
  assert.match(await readFile(join(h.root, "src/controllers/tasks.controller.js"), "utf8"), /throw new Error\("BUG-001/);
  assert.equal(JSON.stringify(logs).includes(challenge), false);
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-key|switch-user-reviewer|PUBLIC KEY|PRIVATE KEY/);
});
