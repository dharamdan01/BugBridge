import test from "node:test";
import assert from "node:assert/strict";
import { classifyMessage, createMessageHandler, ONLINE_REPLY } from "../message-handler.mjs";

const config = { roomId: "room-test", agentId: "agent-test" };
function message(body = "PING BUGBRIDGE", overrides = {}) {
  return { room_id: config.roomId, payload: {
    body, sender: "human-1", sender_name: "human", message_id: "post-1", ...overrides,
  } };
}
function harness(options = {}) {
  const replies = [], questions = [], logs = [];
  const handle = createMessageHandler({ ...config,
    sendMessage: async content => { replies.push(content); },
    askCodex: async question => { questions.push(question); return "AI answer"; },
    log: (event, fields) => logs.push({ event, ...fields }), ...options,
  });
  return { handle, replies, questions, logs };
}

for (const [name, data, reason] of [
  ["wrong room", { ...message(), room_id: "other-room" }, "wrong_room"],
  ["own agent ID", message(undefined, { sender: config.agentId }), "self_or_agent"],
  ["own agent name", message(undefined, { sender_name: "@BUG-TRIAGER" }), "self_or_agent"],
  ["another agent", message(undefined, { sender_type: "agent" }), "self_or_agent"],
  ["another bot", message(undefined, { sender_type: "bot" }), "self_or_agent"],
  ["echoed answer with command text", message("BugBridge (Codex):\nASK BUGBRIDGE: recurse"), "self_or_agent"],
  ["normal conversation", message("hello team", { addressed: false }), "not_targeted_command"],
  ["command quoted in prose", message("Please explain PING BUGBRIDGE"), "not_targeted_command"],
  ["command in code fence", message("```\nPING BUGBRIDGE\n```"), "not_targeted_command"],
  ["another agent mention", message("@other-agent ASK BUGBRIDGE: task", { addressed: true }), "not_targeted_command"],
  ["only a mention", message("@bug-triager hi", { addressed: true }), "not_targeted_command"],
  ["empty question", message("ASK BUGBRIDGE:   "), "not_targeted_command"],
  ["non-string body", message({ command: "PING BUGBRIDGE" }), "invalid_payload"],
]) {
  test(`ignores ${name}`, async () => {
    assert.equal(classifyMessage(data, config).reason, reason);
    const h = harness();
    await h.handle(data);
    assert.deepEqual(h.replies, []);
    assert.deepEqual(h.questions, []);
  });
}

test("preserves direct broadcast commands and optional own mention", async () => {
  const h = harness();
  await h.handle(message("ping bugbridge", { addressed: false }));
  await h.handle(message("@bug-triager ASK BUGBRIDGE: analyze the failure", { message_id: "post-2", addressed: true }));
  assert.deepEqual(h.replies, [ONLINE_REPLY, "BugBridge (Codex):\nAI answer"]);
  assert.deepEqual(h.questions, ["analyze the failure"]);
});

test("a completed duplicate produces only one reply", async () => {
  const h = harness();
  await h.handle(message());
  await h.handle(message());
  assert.equal(h.replies.length, 1);
  assert.ok(h.logs.some(x => x.reason === "duplicate"));
});

test("claims concurrent duplicate requests before awaiting Codex", async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const h = harness({ askCodex: () => pending });
  const data = message("ASK BUGBRIDGE: why is it failing?");
  const first = h.handle(data);
  await h.handle(data);
  resolve("one answer");
  await first;
  assert.deepEqual(h.replies, ["BugBridge (Codex):\none answer"]);
});

test("identical text in distinct human posts gets separate replies", async () => {
  const h = harness();
  await h.handle(message());
  await h.handle(message(undefined, { message_id: "post-2" }));
  assert.equal(h.replies.length, 2);
});

test("deduplicates by event ID when the message ID is unavailable", async () => {
  const h = harness();
  const data = message(undefined, { message_id: undefined });
  await h.handle(data, 40);
  await h.handle(data, 40);
  assert.equal(h.replies.length, 1);
});

test("timestamp fallback includes sender identity", async () => {
  const h = harness();
  const data = message(undefined, { message_id: undefined, timestamp: "2026-11-05T10:00:00Z" });
  await h.handle(data);
  await h.handle(data);
  await h.handle({ ...data, payload: { ...data.payload, sender: "human-2" } });
  assert.equal(h.replies.length, 2);
});

test("missing stable identity is ignored safely", async () => {
  const h = harness();
  await h.handle(message(undefined, { message_id: undefined }));
  assert.deepEqual(h.replies, []);
  assert.equal(h.logs[0].reason, "missing_identity");
});

test("another question gets one busy reply; PING still works during Codex", async () => {
  let resolve;
  const h = harness({ askCodex: () => new Promise(r => { resolve = r; }) });
  const first = h.handle(message("ASK BUGBRIDGE: first"));
  const second = message("ASK BUGBRIDGE: second", { message_id: "post-2" });
  await h.handle(second);
  await h.handle(second);
  await h.handle(message(undefined, { message_id: "post-3" }));
  resolve("done");
  await first;
  assert.equal(h.replies.length, 3);
  assert.match(h.replies[0], /processing another/);
  assert.equal(h.replies[1], ONLINE_REPLY);
});

test("Codex failure returns one safe error and clears busy state", async () => {
  let calls = 0;
  const h = harness({ askCodex: async () => {
    if (++calls === 1) throw new Error("synthetic-sensitive-content");
    return "recovered";
  } });
  const data = message("ASK BUGBRIDGE: first");
  await h.handle(data);
  await h.handle(data);
  await h.handle(message("ASK BUGBRIDGE: second", { message_id: "post-2" }));
  assert.equal(h.replies.length, 2);
  assert.match(h.replies[0], /couldn't complete/);
  assert.match(h.replies[1], /recovered/);
  assert.doesNotMatch(JSON.stringify([h.replies, h.logs]), /synthetic-sensitive-content/);
});

test("delivery failure never causes a second fallback or duplicate retry", async () => {
  let posts = 0;
  const h = harness({ sendMessage: async () => { posts++; throw new Error("synthetic-secret"); } });
  const data = message("ASK BUGBRIDGE: question");
  await h.handle(data);
  await h.handle(data);
  assert.equal(posts, 1);
  assert.ok(h.logs.some(x => x.event === "reply_failed"));
  assert.doesNotMatch(JSON.stringify(h.logs), /synthetic-secret|question/);
});

test("in-flight requests stay protected if the bounded cache evicts them", async () => {
  let resolve;
  const h = harness({ maxProcessed: 1, askCodex: () => new Promise(r => { resolve = r; }) });
  const data = message("ASK BUGBRIDGE: first");
  const first = h.handle(data);
  await h.handle(message(undefined, { message_id: "post-2" }));
  await h.handle(data);
  resolve("answer");
  await first;
  assert.equal(h.replies.length, 2);
});

test("deduplication expires after the documented TTL", async () => {
  let time = 0;
  const h = harness({ now: () => time, dedupTtlMs: 100 });
  await h.handle(message());
  time = 99;
  await h.handle(message());
  time = 100;
  await h.handle(message());
  assert.equal(h.replies.length, 2);
});

test("questions are bounded and logs exclude prompts and answers", async () => {
  const h = harness();
  await h.handle(message(`ASK BUGBRIDGE: private-${"x".repeat(1000)}`));
  assert.equal(h.questions[0].length, 700);
  assert.doesNotMatch(JSON.stringify(h.logs), /private-|AI answer/);
});

const diagnosticNames = new Set([
  "inbound_filtered", "command_recognized", "reply_attempted", "reply_succeeded", "reply_failed",
]);
const diagnostics = h => h.logs.filter(entry => diagnosticNames.has(entry.event));

test("command and reply diagnostics bracket Switch acceptance with fixed fields only", async () => {
  const h = harness();
  await h.handle(message());
  assert.deepEqual(diagnostics(h), [
    { event: "command_recognized", request: 1, command: "ping" },
    { event: "reply_attempted", request: 1 },
    { event: "reply_succeeded", request: 1 },
  ]);
  assert.deepEqual(h.replies, [ONLINE_REPLY]);
});

test("filter diagnostics distinguish rejected schemas, rooms, commands, missing identities and duplicates", async () => {
  const h = harness();
  for (const data of [
    { ...message(), room_id: "synthetic-private-room" },
    { room_id: config.roomId, payload: { body: {} } },
    message(undefined, { sender_type: "bot" }),
    message("synthetic-private-message"),
    message(undefined, { message_id: undefined }),
    message(), message(),
  ]) await h.handle(data);
  assert.deepEqual(diagnostics(h).filter(x => x.event === "inbound_filtered").map(x => x.reason), [
    "wrong_room", "invalid_payload", "self_or_agent", "not_targeted_command", "missing_identity", "duplicate",
  ]);
  assert.equal(h.replies.length, 1);
  assert.doesNotMatch(JSON.stringify(h.logs), /synthetic-private|human-1|post-1|room-test|agent-test|PING BUGBRIDGE/);
});

test("failed reply diagnostics expose no exception details and do not retry delivery", async () => {
  let posts = 0;
  const h = harness({ sendMessage: async () => {
    posts++;
    throw new Error("synthetic-private-credential Authorization: Bearer synthetic-private-token");
  } });
  await h.handle(message());
  await h.handle(message());
  assert.deepEqual(diagnostics(h), [
    { event: "command_recognized", request: 1, command: "ping" },
    { event: "reply_attempted", request: 1 },
    { event: "reply_failed", request: 1 },
    { event: "inbound_filtered", reason: "duplicate" },
  ]);
  assert.equal(posts, 1);
  assert.doesNotMatch(JSON.stringify(h.logs), /synthetic-private|Authorization|Bearer/);
});
