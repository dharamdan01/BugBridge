import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once, EventEmitter } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { WebSocketServer } from "ws";
import { collectEvidence, writeEvidenceReports } from "../../scripts/reproduce-bug.mjs";
import { approvalFixture, historicalFiles } from "./phase11-fixture.mjs";
import { createCodexRunner, projectDir } from "../codex-runner.mjs";
import { createIncidentTriager } from "../incident-triage.mjs";
import { createMessageHandler, ONLINE_REPLY } from "../message-handler.mjs";
import { createSwitchClient } from "../switch-client.mjs";
import { FIX_EXECUTION_ENABLED, executeApprovedFix } from "../fix-plan.mjs";

// REAL local HTTP/evidence/files/client/handler; MOCK Switch peer and Codex
// subprocess. This never connects to the deployed Switch or invokes real AI.
test("local workflow: real HTTP evidence -> mocked Codex -> persisted triage -> same-room fixture reply -> protected approval", { timeout: 20_000 }, async t => {
  const hash = value => createHash("sha256").update(value).digest("hex");
  const original = await Promise.all(historicalFiles.map(async file => [file, hash(await readFile(join(projectDir, file)))]));
  const h = await approvalFixture(t), evidence = await collectEvidence();
  assert.equal(evidence.outcome, "PASSED");
  assert.deepEqual(evidence.verifiedObservations.scenarios.map(s => [s.expected.status, s.observed.status]), [[400, 500], [400, 500]]);
  await writeEvidenceReports(evidence, join(h.root, "reports"));
  const events = new EventEmitter(), posts = [], logs = [], sockets = [];
  const wait = (emitter, event) => once(emitter, event, { signal: AbortSignal.timeout(5000) });
  let release, analysisCalls = 0, client;
  const assessment = { incidentId: "INC-001", mechanism: "GENERIC_ERROR_BEFORE_VALIDATION", fix: "REMOVE_EMPTY_INPUT_THROW_AND_UNUSED_IMPORT",
    evidenceRefs: ["empty-json", "empty-body", "controller-throw", "controller-validation", "validator-400", "handler-500"],
    verification: ["EMPTY_INPUT_400", "VALID_CREATE_201", "NO_INSERT_ON_REJECTION", "PRESERVE_ERROR_SANITIZATION", "ALL_SUITES_AFTER_APPROVAL"] };
  const askCodex = createCodexRunner({ cwd: h.root, env: { PATH: process.env.PATH, SWITCH_AGENT_KEY: "SYNTHETIC_PRIVATE_ONLY" },
    execute: (_program, args, options) => {
      analysisCalls++;
      assert.equal(options.shell, false); assert.equal(options.env.SWITCH_AGENT_KEY, undefined);
      assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
      assert.ok(args.includes("features.shell_tool=false")); assert.ok(args.includes("--ignore-user-config"));
      let resolve, reject;
      const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
      pending.child = { stdin: { on() {}, end(prompt) {
        assert.match(prompt, /untrusted evidence/); assert.match(prompt, /"observedStatus":500/);
        assert.match(prompt, /BUG-001: empty task body bypasses validation/);
        release = async () => { try { await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify(assessment)); resolve({ stdout: "", stderr: "" }); } catch (error) { reject(error); } };
        events.emit("analysis_pending");
      } }, kill() { reject(new Error("Synthetic subprocess cancelled")); } };
      return pending;
    } });
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/agents/agent-test/message");
    assert.equal(request.headers.authorization, "Bearer synthetic-local-key");
    let body = ""; for await (const chunk of request) body += chunk;
    posts.push(JSON.parse(body)); response.writeHead(200).end("{}");
  });
  const wss = new WebSocketServer({ server });
  t.after(async () => {
    client?.stop(); for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve)); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const log = (event, fields) => { logs.push({ event, ...fields }); events.emit(event, fields); };
  const handler = createMessageHandler({ ...h.config, log, triageIncident: createIncidentTriager({ askCodex, root: h.root }),
    approvalService: h.service, sendMessage: content => client.sendMessage(content) });
  wss.on("connection", socket => { sockets.push(socket); socket.send(JSON.stringify({ event: "connection_state", data: { rooms: [h.config.roomId] } })); });
  client = createSwitchClient({ ...h.config, baseUrl: `http://127.0.0.1:${server.address().port}`, agentKey: "synthetic-local-key", onMessage: handler, log });
  const connected = wait(events, "switch_connected"); client.start(); await connected;
  const send = (body, id) => sockets[0].send(JSON.stringify({ event: "message", id, data: { room_id: h.config.roomId,
    payload: { body, message_id: `fixture-${id}`, sender: h.config.authorizedHumans[0].senderId, sender_kind: "user" } } }));
  const pending = wait(events, "analysis_pending"); send("TRIAGE BUGBRIDGE INC-001", 1); await pending;
  const pong = wait(sockets[0], "message"); sockets[0].send(JSON.stringify({ event: "ping", id: 2 }));
  assert.deepEqual(JSON.parse((await pong)[0].toString()), { type: "pong", cursor: 2 });
  const pingReply = wait(events, "reply_sent"); send("PING BUGBRIDGE", 3); await pingReply;
  assert.equal(posts[0].content, ONLINE_REPLY);
  const triageReply = wait(events, "reply_sent"); await release(); await triageReply;
  assert.match(posts[1].content, /INC-001 \| AWAITING_APPROVAL/); assert.match(posts[1].content, /No fix applied/);
  const proposal = JSON.parse(await readFile(join(h.root, "reports/incidents/INC-001-triage.json")));
  assert.equal(proposal.approvalRequired, true); assert.equal(proposal.proposedFix.applied, false);
  assert.equal(proposal.observedBehavior.status, 500); assert.equal(proposal.expectedBehavior.status, 400);
  assert.equal(proposal.reproductionEvidence.reproducedAt, evidence.reproducedAt);
  assert.equal(proposal.reproductionEvidence.sha256, hash(await readFile(join(h.root, "reports/phase9-bug-evidence.json"))));
  assert.equal(await readFile(join(h.root, "reports/incidents/INC-001-triage.md"), "utf8").then(text => text.includes("AWAITING_APPROVAL")), true);
  const duplicate = wait(events, "message_ignored"); send("TRIAGE BUGBRIDGE INC-001", 1); assert.equal((await duplicate)[0].reason, "duplicate");
  const denied = wait(events, "reply_sent"); send("REQUEST FIX BUGBRIDGE INC-001", 4); await denied;
  assert.match(posts[2].content, /IDENTITY_UNAVAILABLE/); assert.equal(analysisCalls, 1);
  assert.ok(posts.every(post => post.room_id === h.config.roomId));
  assert.equal(FIX_EXECUTION_ENABLED, false); await assert.rejects(executeApprovedFix(), /PHASE_11A_EXECUTION_DISABLED/);
  for (const [file, before] of original) assert.equal(hash(await readFile(join(projectDir, file))), before);
  assert.doesNotMatch(JSON.stringify(logs), /SYNTHETIC_PRIVATE_ONLY|synthetic-local-key|fixture-human|PRIVATE KEY/);
});
