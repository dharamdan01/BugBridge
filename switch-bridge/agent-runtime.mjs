import { createMessageHandler } from "./message-handler.mjs";
import { createSwitchClient } from "./switch-client.mjs";
import { createCodexRunner } from "./codex-runner.mjs";
import { createIncidentTriager } from "./incident-triage.mjs";
import { createApprovalService } from "./approval-service.mjs";

const agentId = process.env.SWITCH_AGENT_ID;
const agentKey = process.env.SWITCH_AGENT_KEY;
const roomId = process.env.SWITCH_ROOM_ID;

if (!agentId || !agentKey || !roomId) {
  console.error("Missing SWITCH_AGENT_ID, SWITCH_AGENT_KEY or SWITCH_ROOM_ID");
  process.exit(1);
}

// Only fixed event names, counters, booleans and reason codes go to logs.
// Never pass frames, headers, message text, subprocess output or Error objects.
function log(event, fields = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}

const askCodex = createCodexRunner();
const handleMessage = createMessageHandler({
  agentId, roomId, log, askCodex,
  triageIncident: createIncidentTriager({ askCodex }),
  approvalService: createApprovalService({ roomId, agentId }),
  sendMessage: (content) => client.sendMessage(content),
});
const client = createSwitchClient({ agentId, agentKey, roomId, log, onMessage: handleMessage });

function shutdown() {
  log("shutdown_requested");
  client.stop();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
client.start();
