import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createSwitchClient } from "../switch-client.mjs";

function harness(options = {}) {
  const sockets = [], timers = new Map(), logs = [], received = [];
  let timerId = 0;
  class FakeSocket extends EventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor(url, config) {
      super();
      this.url = new URL(url);
      this.config = config;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    open() { this.readyState = 1; this.emit("open"); }
    frame(value) { this.emit("message", Buffer.from(JSON.stringify(value))); }
    send(data, callback) { this.sent.push(JSON.parse(data)); callback?.(); }
    close() { this.readyState = 2; }
    terminate() { this.terminated = true; this.readyState = 3; this.emit("close", 1006); }
  }
  const client = createSwitchClient({
    agentId: "agent-test", agentKey: "synthetic-key", roomId: "room-test",
    WebSocketClass: FakeSocket,
    onMessage: (...args) => { received.push(args); },
    log: (event, fields) => logs.push({ event, ...fields }),
    setTimer: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimer: id => timers.delete(id), random: () => 0, ...options,
  });
  function runTimer(ms) {
    const entry = [...timers].find(([, timer]) => timer.ms === ms);
    assert.ok(entry, `expected timer ${ms}`);
    timers.delete(entry[0]);
    entry[1].fn();
  }
  client.start();
  return { client, sockets, timers, logs, received, runTimer };
}

test("preserves the authenticated single-room Switch connection", () => {
  const h = harness();
  const socket = h.sockets[0];
  assert.equal(socket.url.pathname, "/agents/agent-test/connection/ws");
  assert.equal(socket.url.searchParams.get("scope"), "single");
  assert.equal(socket.url.searchParams.get("filter"), "all");
  assert.equal(socket.url.searchParams.get("rooms"), "room-test");
  assert.equal(socket.config.headers.Authorization, "Bearer synthetic-key");
  assert.equal(socket.config.handshakeTimeout, 10_000);
  h.client.start();
  assert.equal(h.sockets.length, 1);
  h.client.stop();
});

test("application heartbeat replies carry the monotonic observed cursor", () => {
  const h = harness();
  const s = h.sockets[0];
  s.open();
  s.frame({ event: "message", id: 12, data: {} });
  s.frame({ event: "ping", id: 8 });
  s.frame({ event: "ping", id: "untrusted" });
  assert.deepEqual(s.sent, [{ type: "pong", cursor: 12 }, { type: "pong", cursor: 12 }]);
  h.client.stop();
});

test("malformed frames are ignored and subscription status is logged safely", () => {
  const h = harness();
  const s = h.sockets[0];
  s.open();
  for (const raw of ["{", "null", "[]", "{}", '"text"']) s.emit("message", Buffer.from(raw));
  s.frame({ event: "connection_state", data: { rooms: ["room-test"] } });
  s.frame({ event: "subscription_changed", data: { rooms: [] } });
  assert.equal(h.logs.filter(x => x.event === "invalid_frame").length, 5);
  assert.ok(h.logs.some(x => x.event === "switch_connected" && x.subscribed));
  assert.ok(h.logs.some(x => x.event === "subscription_changed" && !x.subscribed));
  assert.doesNotMatch(JSON.stringify(h.logs), /synthetic-key|Bearer/);
  h.client.stop();
});

test("silent sockets terminate and schedule exactly one reconnect", () => {
  const h = harness();
  h.sockets[0].open();
  h.runTimer(90_000);
  assert.equal(h.sockets[0].terminated, true);
  assert.equal([...h.timers.values()].filter(t => t.ms === 1000).length, 1);
  h.runTimer(1000);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.sockets[1].url.searchParams.get("connection_id"), h.sockets[0].url.searchParams.get("connection_id"));
  h.client.stop();
});

test("native ping/pong refresh the liveness timer", () => {
  const h = harness();
  const s = h.sockets[0];
  s.open();
  const initial = [...h.timers.keys()][0];
  s.emit("ping");
  assert.equal(h.timers.has(initial), false);
  const next = [...h.timers.keys()][0];
  s.emit("pong");
  assert.equal(h.timers.has(next), false);
  assert.equal(h.timers.size, 1);
  h.client.stop();
});

test("reconnect backs off to a cap and resets only on Switch acceptance", () => {
  const h = harness();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    h.sockets.at(-1).terminate();
    h.runTimer(delay);
  }
  h.sockets.at(-1).open();
  h.sockets.at(-1).frame({ event: "connection_state", data: { rooms: ["room-test"] } });
  h.sockets.at(-1).terminate();
  h.runTimer(1000);
  h.client.stop();
});

for (const event of ["refused", "evicted"]) {
  test(`${event} stops reconnecting without exposing server detail`, () => {
    const h = harness();
    const s = h.sockets[0];
    s.open();
    s.frame({ event, data: { reason: "synthetic-sensitive-detail" } });
    s.emit("close", 1000);
    assert.equal(h.timers.size, 0);
    assert.doesNotMatch(JSON.stringify(h.logs), /synthetic-sensitive-detail/);
  });
}

test("shutdown clears pending reconnects and stale frames are ignored", async () => {
  const h = harness();
  const old = h.sockets[0];
  old.terminate();
  h.runTimer(1000);
  old.frame({ event: "message", data: { body: "old" } });
  await Promise.resolve();
  assert.equal(h.received.length, 0);
  h.sockets[1].terminate();
  h.client.stop();
  assert.equal(h.timers.size, 0);
});

test("rejected handshakes stop retries for invalid authorization", () => {
  const h = harness();
  let destroyed = false, resumed = false;
  h.sockets[0].emit("unexpected-response",
    { destroy() { destroyed = true; } },
    { statusCode: 401, resume() { resumed = true; } });
  assert.equal(destroyed && resumed, true);
  assert.equal(h.timers.size, 0);
  assert.ok(h.logs.some(x => x.event === "handshake_rejected" && x.status === 401));
});

test("handler failures are contained without logging raw errors", async () => {
  const h = harness({ onMessage: async () => { throw new Error("synthetic-secret"); } });
  h.sockets[0].frame({ event: "message", id: 1, data: {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(h.logs.some(x => x.event === "message_handler_failed"));
  assert.doesNotMatch(JSON.stringify(h.logs), /synthetic-secret/);
  h.client.stop();
});

test("replies use the existing room endpoint, bounded timeout and safe HTTP errors", async () => {
  let captured;
  const h = harness({ fetchImpl: async (url, options) => {
    captured = { url, options };
    return new Response("synthetic-server-secret", { status: 503 });
  } });
  await assert.rejects(h.client.sendMessage("answer"), error => {
    assert.equal(error.message, "Switch reply failed: HTTP 503");
    return true;
  });
  assert.equal(captured.url.pathname, "/agents/agent-test/message");
  assert.equal(captured.options.headers.Authorization, "Bearer synthetic-key");
  assert.deepEqual(JSON.parse(captured.options.body), { room_id: "room-test", content: "answer" });
  assert.ok(captured.options.signal instanceof AbortSignal);
  h.client.stop();
});

test("shutdown cancels message dispatch that has not started yet", async () => {
  const h = harness();
  h.sockets[0].open();
  h.sockets[0].frame({ event: "message", id: 1, data: {} });
  h.client.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.received.length, 0);
});

test("heartbeat send failure terminates the failed socket", () => {
  const h = harness();
  const s = h.sockets[0];
  s.open();
  s.send = (_data, callback) => callback(new Error("synthetic-sensitive-error"));
  s.frame({ event: "ping", id: 3 });
  assert.equal(s.terminated, true);
  assert.ok(h.logs.some(x => x.event === "heartbeat_send_failed"));
  assert.doesNotMatch(JSON.stringify(h.logs), /synthetic-sensitive-error/);
  h.client.stop();
});

test("inbound diagnostic marks only active message frames before handler dispatch without frame data", async () => {
  const h = harness();
  const old = h.sockets[0];
  old.terminate();
  h.runTimer(1000);
  const current = h.sockets[1];
  old.frame({ event: "message", data: {} });
  current.frame({ event: "ping", id: 1 });
  assert.equal(h.logs.filter(x => x.event === "inbound_received").length, 0);
  const data = { room_id: "room-test", payload: {
    sender: "synthetic-private-participant", body: "synthetic-private-message",
    credentials: "synthetic-private-credential",
  } };
  current.frame({ event: "message", id: 2, data });
  assert.deepEqual(h.logs.filter(x => x.event === "inbound_received"), [{ event: "inbound_received" }]);
  assert.equal(h.received.length, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.received, [[data, 2]]);
  assert.doesNotMatch(JSON.stringify(h.logs), /synthetic-private|room-test|agent-test|synthetic-key|Bearer/);
  h.client.stop();
});
