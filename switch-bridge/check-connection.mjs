
import WebSocket from "ws";
import { randomUUID } from "node:crypto";

const agentId = process.env.SWITCH_AGENT_ID;
const agentKey = process.env.SWITCH_AGENT_KEY;

if (!agentId || !agentKey) {
  console.error("FAILED: Agent credentials missing");
  process.exit(1);
}

const url =
  `ws://127.0.0.1:8000/agents/${encodeURIComponent(agentId)}/connection/ws` +
  `?connection_id=${randomUUID()}&scope=all&filter=addressed`;

const ws = new WebSocket(url, {
  headers: {
    Authorization: `Bearer ${agentKey}`,
  },
  handshakeTimeout: 10_000,
  maxPayload: 1024 * 1024,
});

let verified = false;
let cursor = 0;

const timer = setTimeout(() => {
  console.error("FAILED: Connection timeout");
  ws.terminate();
  process.exitCode = 1;
}, 15000);

ws.on("message", (raw) => {
  let frame;
  try {
    frame = JSON.parse(raw.toString());
  } catch {
    console.error("IGNORED: Invalid Switch frame");
    return;
  }
  if (!frame || typeof frame !== "object") return;
  if (Number.isSafeInteger(frame.id) && frame.id >= 0) cursor = Math.max(cursor, frame.id);

  if (frame.event === "connection_state") {
    verified = true;
    clearTimeout(timer);

    console.log("SUCCESS: Connected to Switch!");
    const rooms = frame.data?.rooms;
    console.log("Subscribed room count:", Array.isArray(rooms) ? rooms.length : 0);

    ws.close();
  }

  if (frame.event === "refused" || frame.event === "evicted") {
    clearTimeout(timer);
    console.error("FAILED: Switch rejected the verification session");
    process.exitCode = 1;
    ws.close();
  }

  if (frame.event === "ping" && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "pong", cursor }));
  }
});

ws.on("error", () => {
  clearTimeout(timer);
  console.error("FAILED: Switch connection error");
  process.exitCode = 1;
});

ws.on("close", () => {
  clearTimeout(timer);

  if (!verified && process.exitCode !== 1) {
    console.error("FAILED: Connection closed before verification");
    process.exitCode = 1;
  }
});
