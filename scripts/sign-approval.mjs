import { readFile, realpath, lstat } from "node:fs/promises";
import { relative, isAbsolute } from "node:path";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { projectDir } from "../switch-bridge/codex-runner.mjs";
import { readPrivateApprovalFile, writePrivateApprovalFile } from "../switch-bridge/approval-files.mjs";
import { validateIntent, validateApprovalConfig, authorizeHuman, canonical, digest } from "../switch-bridge/approval-protocol.mjs";

// Operator-only utility. No chat route can invoke it or provide a key path.
// Keys must live outside this workspace and must never be given to the agent.
try {
  const [keyArgument, ...extra] = process.argv.slice(2);
  if (!keyArgument || keyArgument === "--help" || extra.length) {
    console.log("Usage: node scripts/sign-approval.mjs <absolute-path-to-operator-Ed25519-private-key-outside-project>");
    if (keyArgument !== "--help") process.exitCode = 1;
  } else {
    if (!isAbsolute(keyArgument)) throw new Error("Private key path must be absolute");
    const keyPath = await realpath(keyArgument);
    const local = relative(await realpath(projectDir), keyPath);
    if (!isAbsolute(local) && !local.startsWith("..")) throw new Error("Private key must stay outside BugBridge");
    const info = await lstat(keyPath);
    if (!info.isFile() || info.size > 4096 || (process.platform !== "win32" && (info.mode & 0o077))) throw new Error("Unsafe signing key");
    const intent = validateIntent(JSON.parse(await readPrivateApprovalFile(projectDir, "unsigned-intent.json")));
    const config = validateApprovalConfig(JSON.parse(await readPrivateApprovalFile(projectDir, "approval-config.json")));
    if (intent.roomId !== config.roomId) throw new Error("Wrong signing room");
    const human = authorizeHuman(config, intent.senderId);
    const privateKey = createPrivateKey(await readFile(keyPath));
    if (privateKey.asymmetricKeyType !== "ed25519" || digest(createPublicKey(privateKey).export({ type: "spki", format: "der" })) !== human.keyFingerprint) throw new Error("Wrong signing identity");
    const envelope = { intent, signature: sign(null, Buffer.from(canonical(intent)), privateKey).toString("base64url") };
    await writePrivateApprovalFile(projectDir, "signed-intent.json", JSON.stringify(envelope, null, 2) + "\n");
    console.log(`Signed reviewed ${intent.action} intent for INC-001. Submit .bugbridge-private/signed-intent.json locally. No source changes or approval state transitions performed by this signing utility.`);
  }
} catch {
  console.error("Approval signing failed. Private key and error details are not displayed. No fix applied.");
  process.exitCode = 1;
}
