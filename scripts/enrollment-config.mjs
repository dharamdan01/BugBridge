import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createPublicKey, randomUUID } from "node:crypto";
import { open, readFile, lstat, link, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateApprovalConfig, authorizeHuman, exactKeys } from "../switch-bridge/approval-protocol.mjs";
import { checkedPath } from "../switch-bridge/incident-files.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);
const messages = {
  USAGE: "Use the interactive enroll-approval-human.ps1 script; unsupported helper operation.",
  ACL_FAILED: "ACL verification failed or was unavailable. Run check-approval-acl.ps1 in the storage owner's normal PowerShell; do not relax permissions.",
  INPUT_INVALID: "Enrollment input was incomplete or malformed. Restart the interactive enrollment script.",
  PUBLIC_KEY_INVALID: "Provide the human operator's existing Ed25519 PUBLIC-key PEM. Private, malformed or non-Ed25519 keys cannot be enrolled.",
  CONFIG_INVALID: "Verified participant IDs or settings are invalid. Obtain exact IDs through authenticated Switch administration; room membership and display names do not authorize enrollment.",
  SWITCH_IDS_MISSING: "Use the existing Switch-configured terminal with SWITCH_AGENT_ID and SWITCH_ROOM_ID loaded; do not change credentials.",
  CONFIRMATION_REQUIRED: "Explicit ENROLL AUTHORIZED HUMAN confirmation is required. No configuration was created.",
  CONFIG_EXISTS: "Enrollment configuration already exists. It was not overwritten; have its owner review it locally.",
  WRITE_FAILED: "Configuration could not be atomically published. Check owner access and local filesystem hard-link support; no in-place fallback or automatic retry is permitted.",
  VERIFY_FAILED: "A published configuration needs local review. Run check-approval-acl.ps1 and check-approval-readiness.mjs; do not retry or overwrite it.",
};
function refuse(code) { const error = new Error(code); error.safeCode = code; throw error; }
async function checkAcl() {
  try {
    const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
    if (!systemRoot) refuse("ACL_FAILED");
    // Preserve an already-approved process policy; never set or override one.
    const safeKeys = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "PSEXECUTIONPOLICYPREFERENCE"]);
    const execution = execute(join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-File", join(root, "scripts/check-approval-acl.ps1")], {
        cwd: root, shell: false, windowsHide: true, timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 64_000,
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) => safeKeys.has(key.toUpperCase()))),
      });
    execution.child.stdin.end();
    const { stdout } = await execution;
    const report = JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
    if (report.status !== "VERIFIED" || report.modified !== false) refuse("ACL_FAILED");
  } catch { refuse("ACL_FAILED"); }
}
async function input() {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 32_000) refuse("INPUT_INVALID");
  }
  try { return JSON.parse(text.replace(/^\uFEFF/, "")); } catch { refuse("INPUT_INVALID"); }
}
function validate(config) {
  try {
    const key = createPublicKey(config?.authorizedHumans?.[0]?.publicKey ?? "");
    if (key.asymmetricKeyType !== "ed25519" || !config.authorizedHumans[0].publicKey.startsWith("-----BEGIN PUBLIC KEY-----")) refuse("PUBLIC_KEY_INVALID");
  } catch { refuse("PUBLIC_KEY_INVALID"); }
  try {
    validateApprovalConfig(config);
    if (config.authorizedHumans.length !== 1 || config.switchIdentity.enabled !== false || config.switchIdentity.verifiedDeployment !== "") refuse("CONFIG_INVALID");
    return authorizeHuman(config, config.authorizedHumans[0].senderId);
  } catch { refuse("CONFIG_INVALID"); }
}
async function writeConfirmed(envelope) {
  if (!exactKeys(envelope, ["config", "confirmation"]) || envelope.confirmation !== "ENROLL AUTHORIZED HUMAN") refuse("CONFIRMATION_REQUIRED");
  const config = envelope.config;
  validate(config);
  if (!process.env.SWITCH_AGENT_ID || !process.env.SWITCH_ROOM_ID || config.agentId !== process.env.SWITCH_AGENT_ID || config.roomId !== process.env.SWITCH_ROOM_ID) refuse("SWITCH_IDS_MISSING");
  await checkAcl();
  const directoryInfo = await lstat(join(root, ".bugbridge-private"));
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) refuse("WRITE_FAILED");
  const target = await checkedPath(root, ".bugbridge-private/approval-config.json", { createParents: true });
  try { await lstat(target); refuse("CONFIG_EXISTS"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const temporary = await checkedPath(root, `.bugbridge-private/enrollment-${randomUUID()}.pending`, { createParents: true });
  let published = false;
  try {
    const bytes = JSON.stringify(config, null, 2) + "\n";
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(bytes, "utf8"); await file.sync(); } finally { await file.close(); }
    await checkAcl(); // Also validate the staged file's inherited ACL; no ACL changes.
    try { await link(temporary, target); } catch (error) { if (error.code === "EEXIST") refuse("CONFIG_EXISTS"); throw error; }
    published = true;
    // Same-directory hard-link publication exposes only complete synced bytes,
    // shares the checked file ACL and cannot overwrite any existing config.
    const saved = await readFile(target, "utf8");
    if (saved !== bytes) refuse("VERIFY_FAILED");
    validate(JSON.parse(saved));
    return { ok: true, enrollmentConfiguration: "VALID", configurationSaved: true };
  } catch (error) {
    if (error.safeCode) throw error;
    refuse(published ? "VERIFY_FAILED" : "WRITE_FAILED");
  } finally {
    try { await rm(temporary, { force: true }); }
    catch { refuse(published ? "VERIFY_FAILED" : "WRITE_FAILED"); }
  }
}
try {
  const [operation, ...extra] = process.argv.slice(2);
  if (extra.length) refuse("USAGE");
  let result;
  if (operation === "check-acl") { await checkAcl(); result = { ok: true, status: "VERIFIED" }; }
  else if (operation === "validate") { const human = validate(await input()); result = { ok: true, fingerprint: human.keyFingerprint }; }
  else if (operation === "write-confirmed") result = await writeConfirmed(await input());
  else refuse("USAGE");
  console.log(JSON.stringify(result));
} catch (error) {
  const code = Object.hasOwn(messages, error.safeCode) ? error.safeCode : "WRITE_FAILED";
  console.log(JSON.stringify({ ok: false, code, message: messages[code] }));
  process.exitCode = 1;
}
