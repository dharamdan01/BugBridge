import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { EventEmitter, once } from "node:events";
import { WebSocketServer } from "ws";
import { createSwitchClient } from "../switch-client.mjs";
import { createMessageHandler } from "../message-handler.mjs";

// A local protocol fixture, NOT a live Switch/Mattermost or real Codex test.
// It exercises the installed ws library, real HTTP POSTs and reconnect replay.
test("local protocol fixture: same-room replies, heartbeat and replay suppression across reconnect", { timeout: 8000 }, async t => {
  const events = new EventEmitter();
  const posts = [], connections = [], questions = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/agents/agent-test/message") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    posts.push({ authorization: request.headers.authorization, ...JSON.parse(body) });
    response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  const wss = new WebSocketServer({ server });
  let client;
  t.after(async () => {
    client?.stop();
    for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const config = { roomId: "room-test", agentId: "agent-test" };
  const log = (event, fields) => events.emit(event, fields);
  const handler = createMessageHandler({ ...config, log,
    askCodex: async question => { questions.push(question); return "synthetic AI fixture answer"; },
    sendMessage: content => client.sendMessage(content),
  });
  const task = (messageId, question) => ({
    event: "message", id: messageId === "post-1" ? 10 : 12,
    data: { room_id: "room-test", payload: {
      message_id: messageId, sender: "human-test", sender_name: "human",
      body: `ASK BUGBRIDGE: ${question}`, addressed: true,
    } },
  });
  wss.on("connection", (socket, request) => {
    connections.push({ socket, request });
    socket.send(JSON.stringify({ event: "connection_state", data: { rooms: ["room-test"] } }));
  });
  client = createSwitchClient({ ...config, agentKey: "synthetic-key", log,
    baseUrl: `http://127.0.0.1:${server.address().port}`, onMessage: handler,
    random: () => 0, setTimer: (fn, ms) => setTimeout(fn, ms === 1000 ? 5 : ms),
  });
  const wait = (emitter, event) => once(emitter, event, { signal: AbortSignal.timeout(3000) });
  const connected = wait(events, "switch_connected");
  client.start();
  assert.equal((await connected)[0].subscribed, true);
  const first = connections[0].socket;
  const firstReply = wait(events, "reply_sent");
  first.send(JSON.stringify(task("post-1", "analyze the incident")));
  await firstReply;
  assert.equal(posts.length, 1);
  assert.equal(posts[0].room_id, "room-test");
  assert.equal(posts[0].content, "BugBridge (Codex):\nsynthetic AI fixture answer");
  assert.equal(posts[0].authorization, "Bearer synthetic-key");

  const pong = wait(first, "message");
  first.send(JSON.stringify({ event: "ping", id: 11 }));
  assert.deepEqual(JSON.parse((await pong)[0].toString()), { type: "pong", cursor: 11 });

  const reconnected = wait(events, "switch_connected");
  first.terminate();
  await reconnected;
  assert.equal(connections.length, 2);
  const second = connections[1].socket;
  const duplicate = wait(events, "message_ignored");
  second.send(JSON.stringify(task("post-1", "analyze the incident")));
  assert.equal((await duplicate)[0].reason, "duplicate");
  const nextReply = wait(events, "reply_sent");
  second.send(JSON.stringify(task("post-2", "next incident")));
  await nextReply;
  assert.equal(posts.length, 2);
  assert.deepEqual(questions, ["analyze the incident", "next incident"]);
  assert.ok(posts.every(post => post.room_id === "room-test"));
  assert.equal(connections[0].request.headers.authorization, "Bearer synthetic-key");
  const query = new URL(connections[0].request.url, "http://localhost").searchParams;
  assert.equal(query.get("rooms"), "room-test");
});
