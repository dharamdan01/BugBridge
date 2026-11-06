import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
const osKeys = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH"]);
const name = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
const opaque = value => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\s\x00-\x1f\x7f]/.test(value);
const identifier = value => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value);
const schemaQuery = `SELECT json_build_object('schema', table_schema, 'table', table_name,
 'id_column', max(column_name) FILTER (WHERE lower(column_name) = 'id'),
 'bot_column', max(column_name) FILTER (WHERE lower(column_name) = 'isbot'),
 'delete_column', max(column_name) FILTER (WHERE lower(column_name) = 'deleteat'))
FROM information_schema.columns
WHERE lower(table_name) = 'users' AND lower(column_name) IN ('id','isbot','deleteat')
 AND table_schema NOT IN ('pg_catalog','information_schema')
GROUP BY table_schema, table_name
HAVING count(*) FILTER (WHERE lower(column_name) = 'id') = 1
 AND count(*) FILTER (WHERE lower(column_name) = 'isbot') = 1
 AND count(*) FILTER (WHERE lower(column_name) = 'deleteat') = 1
LIMIT 2;`;

// Read-only server-side classification, never proof of human account control.
// No default-false interpretation of a missing JSON is_bot field.
export async function auditMattermostAccount({ container, database, role, userId,
  env = process.env, executeImpl = execute } = {}) {
  if (![container, database, role].every(name) || !opaque(userId)) throw new Error("ACCOUNT_AUDIT_SCOPE_REQUIRED");
  async function query(statement) {
    const sql = `\\set ON_ERROR_STOP on\nBEGIN TRANSACTION READ ONLY;\nSET LOCAL statement_timeout = '5s';\nSET LOCAL lock_timeout = '1s';\n${statement}\nROLLBACK;\n`;
    try {
      const child = executeImpl(process.platform === "win32" ? "docker.exe" : "docker",
        ["exec", "-i", container, "psql", "-X", "-w", "-q", "-A", "-t", "-U", role, "-d", database,
          "--set", "ON_ERROR_STOP=1", "--set", `user_id=${userId}`, "--file", "-"],
        { shell: false, windowsHide: true, timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 32_000,
          env: Object.fromEntries(Object.entries(env).filter(([key]) => osKeys.has(key.toUpperCase()))) });
      child.child.stdin.on("error", () => {}); child.child.stdin.end(sql);
      const { stdout } = await child;
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length > 2) throw new Error();
      return lines.map(line => JSON.parse(line));
    } catch { throw new Error("ACCOUNT_AUDIT_READ_UNAVAILABLE"); }
  }
  const schemas = await query(schemaQuery);
  if (schemas.length !== 1 || !["schema", "table", "id_column", "bot_column", "delete_column"].every(key => identifier(schemas[0]?.[key]))) throw new Error("ACCOUNT_SCHEMA_UNVERIFIED");
  const s = schemas[0], quote = value => `"${value}"`;
  const rows = await query(`SELECT json_build_object('is_bot', ${quote(s.bot_column)},
 'is_active', (${quote(s.delete_column)} = 0), 'account_id_matches', (${quote(s.id_column)} = :'user_id'))
FROM ${quote(s.schema)}.${quote(s.table)} WHERE ${quote(s.id_column)} = :'user_id' LIMIT 2;`);
  if (rows.length !== 1 || typeof rows[0]?.is_bot !== "boolean" || typeof rows[0]?.is_active !== "boolean" || rows[0]?.account_id_matches !== true) throw new Error("ACCOUNT_CLASSIFICATION_UNVERIFIED");
  return { mode: "READ_ONLY", accountFound: true, accountIdMatches: true, isBot: rows[0].is_bot, active: rows[0].is_active,
    classification: rows[0].is_bot ? "BOT_ACCOUNT_REJECT" : rows[0].is_active ? "NON_BOT_ACTIVE_ACCOUNT_RECORD" : "INACTIVE_ACCOUNT_REJECT",
    humanAuthentication: "REQUIRES_INDEPENDENT_ACCOUNT_CONTROL_AND_BRIDGE_REVIEW", modified: false, enrollmentPerformed: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node scripts/audit-mattermost-account.mjs <existing-postgres-container> <Mattermost-database> <existing-authorized-role> <independently-authenticated-Mattermost-user-id>");
    console.log("Discovers the existing account-table schema, reads only bot/active/match booleans. No IDs, passwords, tokens or message contents are printed. No Switch session or enrollment.");
  } else {
    const run = async () => {
      if (args.length !== 4) throw new Error("ACCOUNT_AUDIT_SCOPE_REQUIRED");
      return auditMattermostAccount({ container: args[0], database: args[1], role: args[2], userId: args[3] });
    };
    run().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
      const allowed = ["ACCOUNT_AUDIT_SCOPE_REQUIRED", "ACCOUNT_AUDIT_READ_UNAVAILABLE", "ACCOUNT_SCHEMA_UNVERIFIED", "ACCOUNT_CLASSIFICATION_UNVERIFIED"];
      console.error(`Account audit stopped: ${allowed.includes(error.message) ? error.message : "ACCOUNT_CLASSIFICATION_UNVERIFIED"}. Use existing authorized access; do not change roles/RLS, infer false from missing fields, or dump raw database errors.`);
      process.exitCode = 1;
    });
  }
}
