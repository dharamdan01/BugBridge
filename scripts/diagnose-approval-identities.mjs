import { pathToFileURL } from "node:url";

const BASE = "http://127.0.0.1:8000"; // Same local server as switch-client.mjs.
const opaque = value => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\s\x00-\x1f\x7f]/.test(value);
const idFields = new Set(["id", "participant_id", "user_id", "agent_id", "sender", "member", "mxid", "message_id"]);
const containers = new Set(["participants", "members", "agents", "messages", "events", "payload", "data", "result", "items"]);

// Deliberately no display names, chat bodies, arbitrary result dumps or inferred
// identity types. Even an authenticated lookup is not an enrollment attestation.
export function candidateFields(result, secret) {
  const records = [];
  let visited = 0;
  function walk(value, path, depth) {
    if (++visited > 2000 || depth > 8 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.slice(0, 100).forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1)); return; }
    const fields = {};
    for (const key of idFields) {
      const item = value[key];
      if (opaque(item)) fields[key] = (secret && item.includes(secret)) || /bearer|token|password|secret|private.key/i.test(item) ? "[REDACTED]" : item;
    }
    for (const key of ["type", "sender_type"]) if (["agent", "user", "human", "bot", "bridge", "admin"].includes(value[key])) fields[key] = value[key];
    if (Object.keys(fields).length) records.push({ source: path, fields, independentlyVerified: false });
    for (const key of containers) if (Object.hasOwn(value, key)) walk(value[key], `${path}.${key}`, depth + 1);
  }
  walk(result, "result", 0);
  return records;
}

async function boundedJson(response) {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP_${response.status}`); }
  if (!response.body) throw new Error("INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 256 * 1024) throw new Error("RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); }
}

function argumentsFor(name, schema, { roomId, agentId, connectionId }) {
  if (!schema || schema.type !== "object" || !schema.properties || schema.$ref || schema.anyOf || schema.allOf) throw new Error("UNSUPPORTED_SCHEMA");
  const properties = schema.properties;
  const args = {};
  if (name === "get_agent_detail") {
    if (!Object.hasOwn(properties, "agent_id")) throw new Error("UNSUPPORTED_SCHEMA");
    args.agent_id = agentId;
  } else {
    if (Object.hasOwn(properties, "room_id")) args.room_id = roomId;
    else if (!connectionId) throw new Error("EXISTING_CONNECTION_CONTEXT_REQUIRED");
    if (name === "read_context") {
      // Do not fetch unbounded chat history. Only sender fields survive output.
      if (!Object.hasOwn(properties, "limit")) throw new Error("BOUNDED_HISTORY_UNSUPPORTED");
      args.limit = 10;
    }
  }
  if (!Array.isArray(schema.required ?? [])) throw new Error("UNSUPPORTED_SCHEMA");
  if ((schema.required ?? []).some(key => !Object.hasOwn(args, key))) throw new Error("ADDITIONAL_ARGUMENTS_REQUIRED");
  return args;
}

export async function diagnoseIdentities({ env = process.env, fetchImpl = fetch, connectionId = "" } = {}) {
  const { SWITCH_AGENT_ID: agentId, SWITCH_AGENT_KEY: agentKey, SWITCH_ROOM_ID: roomId } = env;
  if (![agentId, agentKey, roomId].every(opaque)) throw new Error("SWITCH_CONFIGURATION_REQUIRED");
  if (connectionId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(connectionId)) throw new Error("INVALID_EXISTING_CONNECTION_ID");
  const endpoint = `${BASE}/agents/${encodeURIComponent(agentId)}/ops`;
  async function request(url, body, context = false) {
    return boundedJson(await fetchImpl(url, {
      method: body === undefined ? "GET" : "POST", redirect: "error",
      headers: { Authorization: `Bearer ${agentKey}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(context && connectionId ? { "X-Switch-Connection-Id": connectionId } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    }));
  }
  let catalog;
  try { catalog = await request(endpoint); } catch { throw new Error("OPERATION_DISCOVERY_FAILED"); }
  const operations = [];
  // Fixed read-only allowlist. Never register, connect, subscribe, send or update.
  for (const name of ["list_participants", "get_agent_detail", "read_context"]) {
    try {
      const args = argumentsFor(name, catalog.operations?.[name]?.input_schema, { agentId, roomId, connectionId });
      const response = await request(`${endpoint}/${name}`, args, name !== "get_agent_detail");
      const candidates = candidateFields(response.result, agentKey);
      operations.push({ operation: name, status: candidates.length ? "CANDIDATE_FIELDS_ONLY" : "NO_RECOGNIZED_ID_FIELDS", candidates });
    } catch (error) {
      const safe = /^(UNSUPPORTED_SCHEMA|EXISTING_CONNECTION_CONTEXT_REQUIRED|BOUNDED_HISTORY_UNSUPPORTED|ADDITIONAL_ARGUMENTS_REQUIRED|HTTP_[0-9]{3}|RESPONSE_TOO_LARGE)$/.test(error.message);
      operations.push({ operation: name, status: "UNAVAILABLE", reason: safe ? error.message : "READ_FAILED" });
    }
  }
  return { mode: "READ_ONLY", newSessionCreated: false, authorizationGranted: false,
    humanParticipantIdentity: "UNVERIFIED", agentParticipantIdentity: "UNVERIFIED", switchSenderAuthentication: "UNVERIFIED",
    idWarning: "In the reviewed local Switch checkout, list_participants.id is an agent/external-user entity ID, not payload.sender. Enrollment requires the stored clients.matrix_user_id mapping; do not construct it from names or registration IDs.",
    operations, remainingVerification: ["Independently map the actual authenticated human account to its full Switch participant ID using local server/bridge administration.",
      "Independently map the existing registered SWITCH_AGENT_ID to its full agent participant ID.",
      "Audit the deployed Switch build and Mattermost adapter sender mapping before enabling metadata approval. Names, room membership and self-declared sender_type are insufficient."],
    nextStep: "Keep switchIdentity.enabled false. Enroll only after independent operator identity and public-key fingerprint review; use signed-local approval meanwhile." };
}

export async function diagnosticMain(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--help") {
    console.log("Usage: node scripts/diagnose-approval-identities.mjs [--connection-id <already-running-connection-UUID>]");
    console.log("Uses existing Switch environment; HTTP reads only. Omit connection-id unless independently known; never generate one for this diagnostic."); return;
  }
  if (argv.length && !(argv.length === 2 && argv[0] === "--connection-id")) throw new Error("USAGE");
  console.log(JSON.stringify(await diagnoseIdentities({ connectionId: argv[1] ?? "" }), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  diagnosticMain().catch(error => {
    const code = ["SWITCH_CONFIGURATION_REQUIRED", "INVALID_EXISTING_CONNECTION_ID", "USAGE", "OPERATION_DISCOVERY_FAILED"].includes(error.message) ? error.message : "DIAGNOSTIC_FAILED";
    console.error(`Diagnostic stopped: ${code}. Use the existing configured terminal; no connection or enrollment was created. Remote details and credentials are omitted.`);
    process.exitCode = 1;
  });
}
