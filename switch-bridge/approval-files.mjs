import { mkdir, lstat, realpath, open, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { checkedPath, readIncidentFile } from "./incident-files.mjs";
import { PRIVATE_DIRECTORY } from "./approval-protocol.mjs";

export async function ensureApprovalDirectories(root) {
  const base = await realpath(root);
  for (const directory of [PRIVATE_DIRECTORY, `${PRIVATE_DIRECTORY}/approvals`]) {
    const target = resolve(base, directory);
    try { await mkdir(target, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory() || (process.platform !== "win32" && (info.mode & 0o077))) throw new Error("Unsafe approval directory");
  }
}
export async function readPrivateApprovalFile(root, name) {
  const path = await checkedPath(root, `${PRIVATE_DIRECTORY}/${name}`);
  if (process.platform !== "win32" && ((await lstat(path)).mode & 0o077)) throw new Error("Unsafe private file permissions");
  return readIncidentFile(root, `${PRIVATE_DIRECTORY}/${name}`);
}
export async function writePrivateApprovalFile(root, name, text) {
  if (!["unsigned-intent.json", "signed-intent.json"].includes(name)) throw new Error("Unsupported approval output");
  await ensureApprovalDirectories(root);
  const path = await checkedPath(root, `${PRIVATE_DIRECTORY}/${name}`, { createParents: true });
  const temp = await checkedPath(root, `${PRIVATE_DIRECTORY}/${randomUUID()}.pending`, { createParents: true });
  const file = await open(temp, "wx", 0o600);
  try {
    await file.writeFile(text); await file.sync(); await file.close();
    await rename(temp, path);
  } finally { await file.close().catch(() => {}); await rm(temp, { force: true }); }
  return path;
}
