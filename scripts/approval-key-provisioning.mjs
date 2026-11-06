import { generateKeyPairSync, createPublicKey, createPrivateKey, createHash, sign, verify } from "node:crypto";
import { open, lstat, realpath, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, dirname, join, parse, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const osKeys = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "PSEXECUTIONPOLICYPREFERENCE"]);
const inside = (parent, child) => { const local = relative(parent, child); return !local || (!isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`)); };

export async function windowsKeyStorage(operation, directory, root = projectDirectory) {
  if (process.platform !== "win32" || !["Prepare", "Verify", "InspectParent"].includes(operation)) throw new Error("WINDOWS_ACL_REQUIRED");
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
  if (!systemRoot) throw new Error("WINDOWS_ACL_REQUIRED");
  try {
    const execution = execute(join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-File", join(root, "scripts/approval-key-storage.ps1"), "-Operation", operation, "-Directory", directory],
      { shell: false, windowsHide: true, timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 64_000,
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) => osKeys.has(key.toUpperCase()))) });
    execution.child.stdin.end();
    const { stdout } = await execution;
    const result = JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
    if (result.status !== "VERIFIED" || (operation === "InspectParent" ? result.parentApproved !== true || result.modified !== false : result.ownerOnly !== true)) throw new Error();
  } catch (error) {
    if (/PSSecurityException|UnauthorizedAccess|running scripts is disabled/i.test(error.stderr ?? "")) throw new Error("POWERSHELL_SCRIPT_POLICY_BLOCKED");
    const refusal = new Error("KEY_STORAGE_NOT_VERIFIED");
    // Native stdout is untrusted. Copy fixed diagnostic enums/numbers only,
    // never the remote action text, raw exception, paths, SID or key material.
    try {
      const report = JSON.parse((error.stdout ?? "").trim().replace(/^\uFEFF/, ""));
      const details = new Set(["LOCAL_ABSOLUTE_PATH_REQUIRED", "PROJECT_OR_UNSAFE_PATH", "LOCAL_FIXED_NTFS_REQUIRED", "GIT_ANCESTRY_FORBIDDEN", "REPARSE_OR_UNSAFE_ANCESTOR", "DIRECTORY_ALREADY_EXISTS", "PARENT_NOT_FOUND", "PARENT_OWNER_MISMATCH", "PARENT_UNAUTHORIZED_WRITE", "REPARSE_POINT_FORBIDDEN", "STORAGE_OWNER_MISMATCH", "ROOT_INHERITANCE_ENABLED", "OWNER_ACCESS_MISSING", "NON_OWNER_ACL_RULE", "OWNER_FULL_CONTROL_MISSING", "UNEXPECTED_STORAGE_CONTENTS", "NATIVE_OPERATION_FAILED"]);
      const stages = new Set(["PATH_VALIDATION", "ANCESTOR_VALIDATION", "PARENT_VALIDATION", "PARENT_ACL_READ", "PARENT_OWNER_CHECK", "PARENT_WRITE_CHECK", "SECURE_DIRECTORY_CREATE", "DIRECTORY_VERIFICATION"]);
      if (report.status === "REFUSED" && report.reason === "KEY_STORAGE_NOT_VERIFIED") {
        if (details.has(report.detail)) refusal.safeReason = report.detail;
        if (stages.has(report.stage)) refusal.safeStage = report.stage;
        if (Number.isSafeInteger(report.helperLine) && report.helperLine > 0 && report.helperLine < 1000) refusal.helperLine = report.helperLine;
      }
    } catch { /* Preserve the generic fail-closed error. */ }
    throw refusal;
  }
}

async function keyDirectoryLocation(directory, root = projectDirectory) {
  if (typeof directory !== "string" || !isAbsolute(directory) || directory.startsWith("\\\\") || /[\x00-\x1f]/.test(directory)) throw new Error("UNSAFE_KEY_PATH");
  const target = resolve(directory), repository = await realpath(root);
  if (inside(repository, target) || inside(target, repository) || target === parse(target).root) throw new Error("KEY_PATH_MUST_BE_OUTSIDE_PROJECT");
  const parent = dirname(target);
  // Reject junction/symlink ancestors before resolving them, including parent.
  for (let cursor = parent; ; cursor = dirname(cursor)) {
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("UNSAFE_KEY_PATH");
    try { await lstat(join(cursor, ".git")); throw new Error("KEY_PATH_INSIDE_GIT_REPOSITORY"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (dirname(cursor) === cursor) break;
  }
  if (inside(repository, await realpath(parent))) throw new Error("KEY_PATH_MUST_BE_OUTSIDE_PROJECT");
  return target;
}

export async function newKeyDirectory(directory, root = projectDirectory) {
  const target = await keyDirectoryLocation(directory, root);
  try { await lstat(target); throw new Error("KEY_DIRECTORY_EXISTS"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  return target;
}

// Read-only operator self-test, never an approval signature or enrollment.
// The fixed self-test message is outside the BUGBRIDGE_APPROVAL_V1 domain.
export async function verifyApprovalKey({ directory, root = projectDirectory,
  storage = windowsKeyStorage, platform = process.platform } = {}) {
  if (platform !== "win32") throw new Error("WINDOWS_ACL_REQUIRED");
  const target = await keyDirectoryLocation(directory, root);
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("UNSAFE_KEY_PATH");
  await storage("InspectParent", target, root);
  await storage("Verify", target, root);
  let privateBytes;
  try {
    const privatePath = join(target, "approval-private.pem"), publicPath = join(target, "approval-public.pem");
    for (const [path, limit] of [[privatePath, 4096], [publicPath, 500]]) {
      const file = await lstat(path);
      if (!file.isFile() || file.isSymbolicLink() || file.size > limit) throw new Error();
    }
    privateBytes = await readFile(privatePath);
    const publicPem = await readFile(publicPath, "utf8");
    if (!/^-----BEGIN PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PRIVATE KEY-----\r?\n?$/.test(privateBytes.toString("utf8")) ||
        !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(publicPem)) throw new Error();
    const privateKey = createPrivateKey(privateBytes), publicKey = createPublicKey(publicPem);
    if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") throw new Error();
    const publicDer = publicKey.export({ type: "spki", format: "der" });
    if (!createPublicKey(privateKey).export({ type: "spki", format: "der" }).equals(publicDer)) throw new Error();
    const selfTest = Buffer.from("BUGBRIDGE_ED25519_KEY_SELF_TEST_V1");
    if (!verify(null, selfTest, publicKey, sign(null, selfTest, privateKey))) throw new Error();
    return { status: "VERIFIED", algorithm: "Ed25519", privateFormat: "PKCS8", publicFormat: "SPKI",
      publicKeySpkiSha256: createHash("sha256").update(publicDer).digest("hex"), signatureSelfTest: "PASS",
      enrollmentPublicKeyCompatible: true, approvalPerformed: false, modified: false };
  } catch { throw new Error("KEY_PAIR_VERIFICATION_FAILED"); }
  finally { privateBytes?.fill(0); }
}

export async function provisionApprovalKey({ directory, confirmation, root = projectDirectory,
  storage = windowsKeyStorage, platform = process.platform } = {}) {
  if (confirmation !== "CREATE APPROVAL SIGNING KEY") throw new Error("EXPLICIT_CONFIRMATION_REQUIRED");
  if (platform !== "win32") throw new Error("WINDOWS_ACL_REQUIRED");
  const target = await newKeyDirectory(directory, root);
  await storage("Prepare", target, root);
  await storage("Verify", target, root); // No key material generated before ACL verification.
  let privateBytes;
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    privateBytes = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }));
    const publicPem = publicKey.export({ type: "spki", format: "pem" });
    const privatePath = join(target, "approval-private.pem"), publicPath = join(target, "approval-public.pem");
    for (const [path, bytes] of [[privatePath, privateBytes], [publicPath, publicPem]]) {
      const handle = await open(path, "wx", 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await storage("Verify", target, root);
    }
    const fingerprint = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
    const savedPublic = createPublicKey(await readFile(publicPath));
    if (savedPublic.asymmetricKeyType !== "ed25519" || createHash("sha256").update(savedPublic.export({ type: "spki", format: "der" })).digest("hex") !== fingerprint) throw new Error("KEY_READBACK_FAILED");
    return { status: "CREATED", privateKeyPath: privatePath, publicKeyPath: publicPath,
      publicKeySpkiSha256: fingerprint, windowsAcl: "VERIFIED_OWNER_ONLY", enrollmentPerformed: false, patchExecutionEnabled: false };
  } catch {
    // Do not delete or retry partially created key material. It remains inside
    // the verified private directory for explicit owner review.
    throw new Error("KEY_CREATION_INCOMPLETE_REVIEW_STORAGE");
  } finally { privateBytes?.fill(0); }
}
