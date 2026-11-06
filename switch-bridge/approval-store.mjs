import { open, readFile, rename, rm, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { checkedPath } from "./incident-files.mjs";
import { ensureApprovalDirectories } from "./approval-files.mjs";
import { PRIVATE_DIRECTORY, APPROVAL_STATUSES, digest, canonical, exactKeys } from "./approval-protocol.mjs";

const directory = `${PRIVATE_DIRECTORY}/approvals`;
const stateName = `${directory}/INC-001.json`;
export function validateApprovalState(state) {
  if (!exactKeys(state, ["version", "incidentId", "revision", "records"]) || state.version !== 1 || state.incidentId !== "INC-001" || !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      !Array.isArray(state.records) || state.records.length > 256) throw new Error("Invalid approval state");
  const ids = new Set(), hashes = new Set(), messages = new Set();
  for (const record of state.records) {
    if (!exactKeys(record, ["requestId", "status", "subjectId", "roomId", "keyFingerprint", "proposalDigest", "challengeHash", "issuedAt", "expiresAt",
      "requestMessageHash", "decisionMessageHash", "consumedAt", "reason", "authorizationMethod", "decisionMethod", "snapshot"]) ||
        !APPROVAL_STATUSES.includes(record.status) || !/^[a-f0-9]{64}$/.test(record.challengeHash) ||
        !/^[a-f0-9]{64}$/.test(record.proposalDigest) || !/^[a-f0-9]{64}$/.test(record.keyFingerprint) ||
        typeof record.roomId !== "string" || typeof record.subjectId !== "string" || typeof record.requestId !== "string" ||
        !Number.isSafeInteger(record.issuedAt) || record.expiresAt - record.issuedAt !== 600_000 ||
        !["ED25519_SIGNED_LOCAL", "VERIFIED_SWITCH_METADATA"].includes(record.authorizationMethod) ||
        (["APPROVED", "REJECTED"].includes(record.status) && (!/^[a-f0-9]{64}$/.test(record.decisionMessageHash) ||
          !["ED25519_SIGNED_LOCAL", "VERIFIED_SWITCH_METADATA"].includes(record.decisionMethod))) ||
        !exactKeys(record.snapshot, ["proposalText", "proposalMarkdown", "controllerText", "controllerDigest", "evidenceJson", "evidenceMarkdown", "evidenceDigest", "markdownDigest", "plan", "planDigest"]) ||
        digest(record.snapshot.proposalText) !== record.proposalDigest ||
        digest(record.snapshot.evidenceJson) !== record.snapshot.evidenceDigest ||
        digest(record.snapshot.evidenceMarkdown) !== record.snapshot.markdownDigest ||
        digest(record.snapshot.controllerText) !== record.snapshot.controllerDigest ||
        digest(canonical(record.snapshot.plan)) !== record.snapshot.planDigest ||
        !/^[a-f0-9]{64}$/.test(record.requestMessageHash) || ids.has(record.requestId) || hashes.has(record.challengeHash) || messages.has(record.requestMessageHash) ||
        (record.status === "AWAITING_APPROVAL" ? record.consumedAt !== null : !Number.isSafeInteger(record.consumedAt))) throw new Error("Invalid approval record");
    ids.add(record.requestId); hashes.add(record.challengeHash); messages.add(record.requestMessageHash);
  }
  if (state.records.filter(record => record.status === "AWAITING_APPROVAL").length > 1) throw new Error("Concurrent pending approvals");
  return state;
}

// A single atomically replaced file includes the ledger AND immutable snapshots.
// Exclusive lock files coordinate independent processes. A crash leaves the
// lock in place and fails closed until an operator confirms recovery is safe.
export function createApprovalStore({ root }) {
  async function transaction(operation) {
    await ensureApprovalDirectories(root);
    const lockPath = await checkedPath(root, `${directory}/INC-001.lock`, { createParents: true });
    let lock;
    try { lock = await open(lockPath, "wx", 0o600); } catch { throw new Error("Approval storage busy or unavailable"); }
    let temporary;
    try {
      await lock.writeFile(JSON.stringify({ version: 1, pid: process.pid, id: randomUUID() }));
      await lock.sync();
      let state = { version: 1, incidentId: "INC-001", revision: 0, records: [] };
      const path = await checkedPath(root, stateName, { createParents: true });
      try {
        const info = await lstat(path);
        if (info.size > 16 * 1024 * 1024 || (process.platform !== "win32" && (info.mode & 0o077))) throw new Error("Unsafe approval state");
        state = validateApprovalState(JSON.parse(await readFile(path, "utf8")));
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      const result = await operation(state);
      if (result.write) {
        state.revision++;
        validateApprovalState(state);
        const serialized = JSON.stringify(state, null, 2) + "\n";
        if (Buffer.byteLength(serialized) > 16 * 1024 * 1024) throw new Error("Approval ledger full");
        temporary = await checkedPath(root, `${directory}/${randomUUID()}.pending`, { createParents: true });
        const output = await open(temporary, "wx", 0o600);
        try { await output.writeFile(serialized); await output.sync(); } finally { await output.close(); }
        await rename(temporary, path);
        temporary = undefined;
        if (process.platform !== "win32") {
          const folder = await open(dirname(path), "r");
          try { await folder.sync(); } finally { await folder.close(); }
        }
      }
      return result.value;
    } finally {
      if (temporary) await rm(temporary, { force: true });
      await lock.close();
      await rm(lockPath);
    }
  }
  return { transaction };
}
