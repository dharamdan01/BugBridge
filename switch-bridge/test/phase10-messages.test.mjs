import test from "node:test";
import assert from "node:assert/strict";
import { once, EventEmitter } from "node:events";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createMessageHandler, classifyMessage, ONLINE_REPLY } from "../message-handler.mjs";
import { createSwitchClient } from "../switch-client.mjs";
import { buildProposal, loadIncident } from "../incident-triage.mjs";

const config = { roomId: "room-test", agentId: "agent-test" };
const analysis = { incidentId: "INC-001", mechanism: "GENERIC_ERROR_BEFORE_VALIDATION", fix: "REMOVE_EMPTY_INPUT_THROW_AND_UNUSED_IMPORT",
  evidenceRefs: ["empty-json", "empty-body", "controller-throw", "controller-validation", "validator-400", "handler-500"],
  verification: ["EMPTY_INPUT_400", "VALID_CREATE_201", "NO_INSERT_ON_REJECTION", "PRESERVE_ERROR_SANITIZATION", "ALL_SUITES_AFTER_APPROVAL"] };
const proposal = buildProposal(await loadIncident("INC-001"), analysis);
const message = (body = "TRIAGE BUGBRIDGE INC-001", overrides = {}) => ({ room_id: config.roomId, payload: { body, sender: "human", sender_name: "human", message_id: "post-1", ...overrides } });
function harness(options = {}) {
  const replies = [], calls = [], logs = [];
  const handle = createMessageHandler({ ...config, sendMessage: async text => { replies.push(text); },
    triageIncident: async id => { calls.push(id); return proposal; }, askCodex: async () => "existing ASK answer",
    log: (event, data) => logs.push({ event, ...data }), ...options });
  return { handle, replies, calls, logs };
}

test("explicit triage, optional own mention and PING/ASK are preserved", async () => {
  const h = harness();
  await h.handle(message("@bug-triager: triage bugbridge inc-001", { addressed: false }));
  await h.handle(message("PING BUGBRIDGE", { message_id: "post-2" }));
  await h.handle(message("ASK BUGBRIDGE: analyze", { message_id: "post-3" }));
  assert.deepEqual(h.calls, ["INC-001"]);
  assert.match(h.replies[0], /INC-001 \| AWAITING_APPROVAL/);
  assert.match(h.replies[0], /No fix applied/);
  assert.equal(h.replies[1], ONLINE_REPLY);
  assert.equal(h.replies[2], "BugBridge (Codex):\nexisting ASK answer");
});

test("invalid or missing IDs get safe rejected reply without Codex, paths or raw text", async () => {
  const h = harness();
  for (const [index, text] of ["TRIAGE BUGBRIDGE", "TRIAGE BUGBRIDGE INC-002", "TRIAGE BUGBRIDGE ../../.env", "TRIAGE BUGBRIDGE INC-001; secret-value"].entries()) {
    await h.handle(message(text, { message_id: `invalid-${index}` }));
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.replies.length, 4);
  for (const reply of h.replies) {
    assert.match(reply, /REJECTED/);
    assert.doesNotMatch(reply, /\.env|secret-value|INC-002/);
  }
});

test("malformed, wrong-room, self, agent, echoed and other-target messages stay ignored", async () => {
  const h = harness();
  for (const data of [null, {}, [], { room_id: config.roomId }, message({}), { ...message(), room_id: "wrong" },
    message(undefined, { sender: config.agentId }), message(undefined, { sender_name: "bug-triager" }),
    message(undefined, { sender_type: "bot" }), message("BugBridge triage: TRIAGE BUGBRIDGE INC-001"),
    message("@other-agent TRIAGE BUGBRIDGE INC-001"), message("Please TRIAGE BUGBRIDGE INC-001"),
    message("```\nTRIAGE BUGBRIDGE INC-001\n```")]) await h.handle(data);
  assert.equal(h.calls.length, 0); assert.equal(h.replies.length, 0);
  assert.equal(classifyMessage(message("TRIAGE BUGBRIDGE INC-001"), config).type, "triage");
});

test("concurrent and completed triage duplicate prevention with shared ASK busy guard and responsive PING", async () => {
  let resolve;
  let calls = 0;
  const h = harness({ triageIncident: async () => { calls++; return new Promise(r => { resolve = r; }); } });
  const pending = h.handle(message());
  await h.handle(message());
  await h.handle(message("ASK BUGBRIDGE: question", { message_id: "ask-busy" }));
  await h.handle(message(undefined, { message_id: "triage-busy" }));
  await h.handle(message("PING BUGBRIDGE", { message_id: "ping" }));
  assert.equal(h.replies.at(-1), ONLINE_REPLY);
  resolve(proposal); await pending;
  await h.handle(message());
  assert.equal(calls, 1);
  assert.equal(h.replies.filter(text => text.includes("AWAITING_APPROVAL")).length, 1);
  assert.equal(h.replies.filter(text => text.includes("processing another")).length, 2);
});

test("Codex or evidence failures are private, release busy state and cannot accept a generic answer", async () => {
  let calls = 0;
  const h = harness({ triageIncident: async () => { if (++calls === 1) throw new Error("synthetic-private-key"); return "a chatbot response"; } });
  await h.handle(message());
  await h.handle(message());
  await h.handle(message(undefined, { message_id: "second" }));
  await h.handle(message("ASK BUGBRIDGE: recovery", { message_id: "ask" }));
  assert.equal(calls, 2);
  assert.match(h.replies[0], /INC-001 \| TRIAGE_FAILED/);
  assert.match(h.replies[1], /TRIAGE_FAILED/);
  assert.match(h.replies[2], /existing ASK answer/);
  assert.doesNotMatch(JSON.stringify([h.replies, h.logs]), /synthetic-private-key|a chatbot response|recovery/);
});

test("failed triage delivery does not retry or emit another fallback", async () => {
  let deliveries = 0;
  const h = harness({ sendMessage: async () => { deliveries++; throw new Error("private-remote-response"); } });
  await h.handle(message()); await h.handle(message());
  assert.equal(deliveries, 1); assert.equal(h.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(h.logs), /private-remote-response/);
});

test("local HTTP/WebSocket triage: same-room routing, heartbeat during slow analysis and reconnect dedup", { timeout: 8000 }, async t => {
  const events = new EventEmitter(), posts = [], sockets = [];
  let calls = 0, finish;
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/agents/agent-test/message");
    assert.equal(request.headers.authorization, "Bearer synthetic-test-key");
    let raw = "";
    for await (const chunk of request) raw += chunk;
    posts.push(JSON.parse(raw)); response.writeHead(200).end("{}");
  });
  const wss = new WebSocketServer({ server });
  let client;
  t.after(async () => {
    client?.stop(); for (const socket of wss.clients) socket.terminate();
    await new Promise(r => wss.close(r)); server.closeAllConnections(); await new Promise(r => server.close(r));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const log = (event, data) => events.emit(event, data);
  const handle = createMessageHandler({ ...config, log,
    sendMessage: text => client.sendMessage(text), askCodex: async () => "ASK preserved",
    triageIncident: async () => { calls++; events.emit("triage_started"); return new Promise(r => { finish = r; }); } });
  wss.on("connection", socket => {
    sockets.push(socket); socket.send(JSON.stringify({ event: "connection_state", data: { rooms: [config.roomId] } }));
  });
  client = createSwitchClient({ ...config, agentKey: "synthetic-test-key", log, onMessage: handle,
    baseUrl: `http://127.0.0.1:${server.address().port}`, random: () => 0,
    setTimer: (fn, ms) => setTimeout(fn, ms === 1000 ? 5 : ms) });
  const wait = (emitter, event) => once(emitter, event, { signal: AbortSignal.timeout(2500) });
  const connected = wait(events, "switch_connected"); client.start(); await connected;
  const frame = { event: "message", id: 1, data: message() };
  const started = wait(events, "triage_started"); sockets[0].send(JSON.stringify(frame)); await started;
  for (const id of [2, 3, 4]) {
    const pong = wait(sockets[0], "message"); sockets[0].send(JSON.stringify({ event: "ping", id }));
    assert.deepEqual(JSON.parse((await pong)[0].toString()), { type: "pong", cursor: id });
  }
  assert.equal(posts.length, 0, "analysis is still pending while heartbeats respond");
  const reconnected = wait(events, "switch_connected"); sockets[0].terminate(); await reconnected;
  const ignored = wait(events, "message_ignored"); sockets[1].send(JSON.stringify(frame));
  assert.equal((await ignored)[0].reason, "duplicate");
  const sent = wait(events, "reply_sent"); finish(proposal); await sent;
  assert.equal(calls, 1); assert.equal(posts.length, 1);
  assert.equal(posts[0].room_id, config.roomId);
  assert.match(posts[0].content, /INC-001 \| AWAITING_APPROVAL/);
  const next = wait(events, "reply_sent");
  sockets[1].send(JSON.stringify({ event: "message", id: 5, data: message("PING BUGBRIDGE", { message_id: "ping-next" }) }));
  await next; assert.equal(posts[1].content, ONLINE_REPLY);
});
