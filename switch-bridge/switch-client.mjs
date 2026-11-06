import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { markSwitchMessage } from "./approval-protocol.mjs";

export function createSwitchClient({
  agentId, agentKey, roomId, onMessage, log = () => {},
  baseUrl = "http://127.0.0.1:8000", WebSocketClass = WebSocket,
  fetchImpl = fetch, setTimer = setTimeout, clearTimer = clearTimeout,
  heartbeatTimeoutMs = 90_000, random = Math.random,
}) {
  if (!agentId || !agentKey || !roomId) throw new Error("Missing Switch configuration");
  const connectionId = randomUUID();
  let socket;
  let stopped = true;
  let reconnectTimer;
  let heartbeatTimer;
  let shutdownTimer;
  let attempt = 0;
  let cursor = 0;

  function clearTimers() {
    clearTimer(reconnectTimer);
    clearTimer(heartbeatTimer);
    clearTimer(shutdownTimer);
    reconnectTimer = heartbeatTimer = shutdownTimer = undefined;
  }

  function armHeartbeat(current) {
    clearTimer(heartbeatTimer);
    heartbeatTimer = setTimer(() => {
      if (stopped || current !== socket) return;
      log("heartbeat_timeout");
      current.terminate();
    }, heartbeatTimeoutMs);
  }

  function connect() {
    if (stopped) return;
    reconnectTimer = undefined;
    const url = new URL(`/agents/${encodeURIComponent(agentId)}/connection/ws`, baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("connection_id", connectionId);
    url.searchParams.set("scope", "single");
    // Preserve broadcast command delivery. The handler enforces explicit intent.
    url.searchParams.set("filter", "all");
    url.searchParams.set("rooms", roomId);
    log("connecting", { attempt: attempt + 1 });
    const current = new WebSocketClass(url.toString(), {
      headers: { Authorization: `Bearer ${agentKey}` },
      handshakeTimeout: 10_000, maxPayload: 1024 * 1024,
    });
    socket = current;
    current.on("open", () => {
      if (stopped || current !== socket) return;
      log("socket_open");
      armHeartbeat(current);
    });
    current.on("message", (raw) => {
      if (stopped || current !== socket) return;
      let frame;
      try { frame = JSON.parse(raw.toString()); } catch {
        log("invalid_frame");
        return;
      }
      if (!frame || typeof frame !== "object" || typeof frame.event !== "string") {
        log("invalid_frame");
        return;
      }
      armHeartbeat(current);
      if (Number.isSafeInteger(frame.id) && frame.id >= 0) cursor = Math.max(cursor, frame.id);
      if (frame.event === "ping") {
        if (current.readyState === WebSocketClass.OPEN) {
          current.send(JSON.stringify({ type: "pong", cursor }), (error) => {
            if (stopped || current !== socket) return;
            if (error) {
              log("heartbeat_send_failed");
              current.terminate();
            } else {
              log("heartbeat_pong", { cursor });
            }
          });
        }
      } else if (frame.event === "connection_state") {
        attempt = 0;
        const subscribed = Array.isArray(frame.data?.rooms) && frame.data.rooms.includes(roomId);
        log("switch_connected", { subscribed });
        if (!subscribed) log("room_subscription_missing");
      } else if (frame.event === "refused" || frame.event === "evicted") {
        log("session_rejected", { event: frame.event });
        stop();
      } else if (frame.event === "subscription_changed") {
        const subscribed = Array.isArray(frame.data?.rooms) && frame.data.rooms.includes(roomId);
        log("subscription_changed", { subscribed });
      } else if (frame.event === "message") {
        log("inbound_received");
        markSwitchMessage(frame.data, { roomId, agentId });
        void Promise.resolve().then(() => {
          if (!stopped && current === socket) return onMessage(frame.data, frame.id);
        }).catch(() => {
          log("message_handler_failed");
        });
      }
    });
    // ws automatically responds to protocol ping; these also prove liveness.
    for (const event of ["ping", "pong"]) {
      current.on(event, () => {
        if (!stopped && current === socket) armHeartbeat(current);
      });
    }
    current.on("unexpected-response", (request, response) => {
      const status = response.statusCode;
      log("handshake_rejected", { status });
      if (status === 401 || status === 403) stop();
      response.resume();
      request.destroy();
      current.terminate();
    });
    current.on("error", () => log("socket_error"));
    current.on("close", (code) => {
      if (current !== socket) return;
      clearTimer(heartbeatTimer);
      clearTimer(shutdownTimer);
      if (stopped) return;
      const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.floor(random() * 500);
      log("reconnect_scheduled", { code, delayMs });
      clearTimer(reconnectTimer);
      reconnectTimer = setTimer(connect, delayMs);
    });
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    connect();
  }

  function stop() {
    stopped = true;
    clearTimers();
    if (socket?.readyState === WebSocketClass.OPEN) {
      const current = socket;
      current.close();
      shutdownTimer = setTimer(() => current.terminate(), 2000);
      shutdownTimer?.unref?.();
    } else if (socket?.readyState === WebSocketClass.CONNECTING) {
      socket.terminate();
    }
    log("connection_stopped");
  }

  async function sendMessage(content) {
    const response = await fetchImpl(new URL(`/agents/${encodeURIComponent(agentId)}/message`, baseUrl), {
      method: "POST",
      headers: { Authorization: `Bearer ${agentKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ room_id: roomId, content }),
      signal: AbortSignal.timeout(15_000),
    });
    // Remote bodies/errors may echo secrets or chat content. Do not log them.
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Switch reply failed: HTTP ${response.status}`);
  }

  return { start, stop, sendMessage };
}
