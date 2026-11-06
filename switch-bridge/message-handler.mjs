import { createHash } from "node:crypto";
import { summarizeTriage } from "./incident-triage.mjs";
import { parseApprovalCommand } from "./approval-protocol.mjs";
import { approvalReply } from "./approval-service.mjs";

export const ONLINE_REPLY = "BugBridge online! Mattermost -> Switch -> Node.js -> Mattermost is working.";
const FAILURE_REPLY = "BugBridge couldn't complete that request. Check the agent terminal for details.";

// These direct commands explicitly target BugBridge even when Switch's mention
// metadata is false. An optional mention must name this agent, never another one.
export function classifyMessage(data, { roomId, agentId }) {
  if (!data || data.room_id !== roomId) return { reason: "wrong_room" };
  const payload = data.payload;
  if (!payload || typeof payload.body !== "string") return { reason: "invalid_payload" };
  const content = payload.body.trim();
  const sender = typeof payload.sender_name === "string"
    ? payload.sender_name.trim().replace(/^@/, "").toLowerCase() : "";
  if (payload.sender === agentId || sender === "bug-triager" ||
      payload.sender_type === "agent" || payload.sender_type === "bot" ||
      /^(?:BugBridge online!|BugBridge \(Codex\):|BugBridge triage:|BugBridge approval:|BugBridge couldn't|BugBridge is processing)/i.test(content)) {
    return { reason: "self_or_agent" };
  }
  const command = content.replace(/^@bug-triager[,:]?\s+/i, "");
  const approval = parseApprovalCommand(command);
  if (approval) return { type: "approval", approval, payload };
  if (/^PING BUGBRIDGE$/i.test(command)) return { type: "ping", payload };
  const triage = command.match(/^TRIAGE BUGBRIDGE(?:\s+([\s\S]*))?$/i);
  if (triage) return { type: "triage", incidentId: triage[1]?.trim().toUpperCase() ?? "", payload };
  const match = command.match(/^ASK BUGBRIDGE\s*:\s*([\s\S]+)$/i);
  if (!match || !match[1].trim()) return { reason: "not_targeted_command" };
  return { type: "ask", question: match[1].trim().slice(0, 700), payload };
}

function messageKey(payload, roomId, eventId) {
  if (typeof payload.message_id === "string" && payload.message_id.trim()) {
    return JSON.stringify([roomId, "message", payload.message_id]);
  }
  if (Number.isSafeInteger(eventId) && eventId >= 0) {
    return JSON.stringify([roomId, "event", eventId]);
  }
  const sender = payload.sender || payload.sender_name;
  if (!sender || !payload.timestamp) return null;
  return createHash("sha256").update(JSON.stringify([
    roomId, sender, payload.timestamp, payload.body,
  ])).digest("hex");
}

export function createMessageHandler({
  agentId, roomId, sendMessage, askCodex, triageIncident, approvalService, log = () => {},
  now = Date.now, maxProcessed = 1000, dedupTtlMs = 30 * 60_000,
}) {
  const processed = new Map();
  const inFlight = new Set();
  let busy = false;
  let sequence = 0;

  // A failed POST may already have reached Switch. Never retry automatically or
  // send a second fallback for a delivery error; that could create two replies.
  async function reply(content, request) {
    log("reply_attempted", { request });
    try {
      await sendMessage(content);
      log("reply_sent", { request });
      // HTTP acceptance by Switch; Mattermost rendering still needs observation.
      log("reply_succeeded", { request });
    } catch {
      log("reply_failed", { request });
    }
  }

  return async function handleMessage(data, eventId) {
    const result = classifyMessage(data, { roomId, agentId });
    if (result.reason) {
      log("message_ignored", { reason: result.reason });
      log("inbound_filtered", { reason: result.reason });
      return;
    }
    const key = messageKey(result.payload, roomId, eventId);
    if (!key) {
      log("message_ignored", { reason: "missing_identity" });
      log("inbound_filtered", { reason: "missing_identity" });
      return;
    }
    const time = now();
    for (const [oldKey, expires] of processed) {
      if (expires <= time) processed.delete(oldKey);
    }
    if (inFlight.has(key) || processed.has(key)) {
      log("message_ignored", { reason: "duplicate" });
      log("inbound_filtered", { reason: "duplicate" });
      return;
    }
    // Claim synchronously, before the first await, including concurrent replays.
    processed.set(key, time + dedupTtlMs);
    while (processed.size > maxProcessed) processed.delete(processed.keys().next().value);
    inFlight.add(key);
    const request = ++sequence;
    log("message_accepted", { request, command: result.type });
    log("command_recognized", { request, command: result.type });
    try {
      if (result.type === "ping") {
        await reply(ONLINE_REPLY, request);
        return;
      }
      if (result.type === "approval") {
        try {
          const response = await approvalService.handleChat(result.approval, data);
          await reply(approvalReply(response), request);
        } catch {
          await reply("BugBridge approval: INC-001 | STATUS_UNAVAILABLE | APPROVAL_DENIED. Approval could not be verified. No fix applied; execution is disabled.", request);
        }
        return;
      }
      if (result.type === "triage" && result.incidentId !== "INC-001") {
        await reply("BugBridge triage: REJECTED | incident missing or unsupported. Use TRIAGE BUGBRIDGE INC-001. No fix applied; human approval is required.", request);
        return;
      }
      if (busy) {
        log("codex_busy", { request });
        await reply("BugBridge is processing another question. Please try again shortly.", request);
        return;
      }
      busy = true;
      const started = now();
      log("codex_started", { request });
      try {
        let answer;
        try {
          answer = result.type === "triage"
            ? summarizeTriage(await triageIncident(result.incidentId))
            : await askCodex(result.question);
          log("codex_completed", { request, durationMs: now() - started });
        } catch {
          log("codex_failed", { request, durationMs: now() - started });
          await reply(result.type === "triage"
            ? "BugBridge triage: INC-001 | TRIAGE_FAILED. Evidence, source, Codex analysis or report persistence could not be verified. No new proposal accepted; existing reports may be stale. No fix applied. Human approval is required."
            : FAILURE_REPLY, request);
          return;
        }
        await reply(result.type === "triage" ? answer : `BugBridge (Codex):\n${answer}`, request);
      } finally {
        busy = false;
      }
    } finally {
      inFlight.delete(key);
    }
  };
}
