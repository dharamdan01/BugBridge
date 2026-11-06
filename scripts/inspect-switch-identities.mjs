import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
const osKeys = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH"]);
const opaque = value => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\s\x00-\x1f\x7f]/.test(value);
const name = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
const fields = {
  agent: ["tenant_id", "agent_id", "agent_participant_id", "client_type", "room_id", "bridge_id", "bridge_type", "mattermost_channel_id"],
  human: ["tenant_id", "bridge_id", "external_user_id", "human_participant_id", "client_type"],
  connection: ["connection_id", "agent_id", "room_id", "scope", "transport"],
  sender_event: ["message_id", "sender", "sender_kind"],
};

// No application imports, Switch HTTP/WS, dotenv, key access or role changes.
// The operator must independently authenticate the supplied Mattermost ID.
export async function inspectSwitchIdentities({ container, database, role, mattermostUserId,
  env = process.env, executeImpl = execute } = {}) {
  if (![container, database, role].every(name) || !opaque(mattermostUserId) ||
      !opaque(env.SWITCH_AGENT_ID) || !opaque(env.SWITCH_ROOM_ID)) throw new Error("NON_SECRET_SCOPE_REQUIRED");
  const sql = await readFile(new URL("./switch-identity-mapping.sql", import.meta.url), "utf8");
  const args = ["exec", "-i", container, "psql", "-X", "-w", "-q", "-A", "-t",
    "-U", role, "-d", database, "--set", "ON_ERROR_STOP=1",
    "--set", `agent_id=${env.SWITCH_AGENT_ID}`, "--set", `room_id=${env.SWITCH_ROOM_ID}`,
    "--set", `mattermost_user_id=${mattermostUserId}`, "--file", "-"];
  let stdout;
  try {
    const child = executeImpl(process.platform === "win32" ? "docker.exe" : "docker", args, {
      shell: false, windowsHide: true, timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 256 * 1024,
      env: Object.fromEntries(Object.entries(env).filter(([key]) => osKeys.has(key.toUpperCase()))),
    });
    child.child.stdin.on("error", () => {});
    child.child.stdin.end(sql);
    ({ stdout } = await child);
  } catch { throw new Error("AUTHORIZED_DATABASE_READ_UNAVAILABLE"); }
  const rows = [];
  try {
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length > 20) throw new Error();
    for (const line of lines) {
      const row = JSON.parse(line);
      if (!Object.hasOwn(fields, row.section) || !row.data || typeof row.data !== "object" || Array.isArray(row.data)) throw new Error();
      const data = {};
      for (const key of fields[row.section]) {
        const value = row.data[key];
        if (value === null) data[key] = null;
        else if (opaque(value)) data[key] = /bearer|password|secret|token|private.key|^sk-/i.test(value) ? "[REDACTED]" : value;
      }
      rows.push({ section: row.section, data });
    }
  } catch { throw new Error("DATABASE_RESPONSE_NOT_VERIFIED"); }
  return { mode: "READ_ONLY_DATABASE", identityVerification: "UNVERIFIED_REQUIRES_INDEPENDENT_ACCOUNT_AND_BUILD_REVIEW",
    newSwitchSessionCreated: false, enrollmentPerformed: false, rows,
    warning: "Stored IDs are runtime evidence only. Confirm the supplied Mattermost ID through your own authenticated account, match deployed source/build, and compare full sender IDs. Empty results/absent sections can mean missing rows, RLS, schema drift or insufficient access; never guess or change permissions." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node scripts/inspect-switch-identities.mjs <existing-postgres-container> <database> <authorized-role> <independently-authenticated-Mattermost-user-id>");
    console.log("Requires existing SWITCH_AGENT_ID and SWITCH_ROOM_ID. Uses read-only psql with no password prompt; never opens Switch connections, enrolls, or reads credentials/configuration/key columns.");
  } else {
    const run = async () => {
      if (args.length !== 4) throw new Error("NON_SECRET_SCOPE_REQUIRED");
      return inspectSwitchIdentities({ container: args[0], database: args[1], role: args[2], mattermostUserId: args[3] });
    };
    run().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
      const safe = ["NON_SECRET_SCOPE_REQUIRED", "AUTHORIZED_DATABASE_READ_UNAVAILABLE", "DATABASE_RESPONSE_NOT_VERIFIED"].includes(error.message) ? error.message : "IDENTITY_READ_FAILED";
      console.error(`Identity inspection stopped: ${safe}. Use existing authorized Docker/psql access and verify the deployed schema. No permission change, credential dump, new Switch session or enrollment was attempted.`);
      process.exitCode = 1;
    });
  }
}
