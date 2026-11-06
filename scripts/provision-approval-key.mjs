import { createInterface } from "node:readline/promises";
import { provisionApprovalKey, newKeyDirectory } from "./approval-key-provisioning.mjs";

try {
  const [directory, ...extra] = process.argv.slice(2);
  if (directory === "--help" && !extra.length) {
    console.log("Usage: node scripts/provision-approval-key.mjs <absolute-NEW-directory-outside-BugBridge>");
    console.log("Interactive Windows operator only. Creates Ed25519 PKCS8 private/SPKI public PEMs with a protected owner-only DACL. Never overwrites, enrolls, approves or patches.");
  } else {
    if (!directory || extra.length) throw new Error("USAGE");
    if (process.platform !== "win32") throw new Error("WINDOWS_ACL_REQUIRED");
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("INTERACTIVE_OPERATOR_REQUIRED");
    await newKeyDirectory(directory);
    console.log("New signing key only; not a Switch credential. Private PEM stays outside BugBridge; do not share it or provide it to the agent. Same Windows-account processes can access it. No enrollment will occur.");
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    let confirmation;
    try { confirmation = await prompt.question("Type CREATE APPROVAL SIGNING KEY to create this new pair: "); } finally { prompt.close(); }
    const result = await provisionApprovalKey({ directory, confirmation });
    console.log(JSON.stringify(result, null, 2)); // Paths and PUBLIC fingerprint only.
  }
} catch (error) {
  const codes = new Set(["USAGE", "WINDOWS_ACL_REQUIRED", "INTERACTIVE_OPERATOR_REQUIRED", "EXPLICIT_CONFIRMATION_REQUIRED", "UNSAFE_KEY_PATH", "KEY_PATH_MUST_BE_OUTSIDE_PROJECT", "KEY_PATH_INSIDE_GIT_REPOSITORY", "KEY_DIRECTORY_EXISTS", "KEY_STORAGE_NOT_VERIFIED", "KEY_CREATION_INCOMPLETE_REVIEW_STORAGE", "POWERSHELL_SCRIPT_POLICY_BLOCKED"]);
  console.error(`Key provisioning stopped: ${codes.has(error.message) ? error.message : "KEY_PROVISIONING_FAILED"}. Use a NEW directory under an existing operator-owned local NTFS parent outside BugBridge. Review any partial storage locally; never overwrite or relax ACLs. No enrollment or fix performed.`);
  // These properties are fixed enums validated by windowsKeyStorage; no
  // native exception, account SID, private path or key bytes are forwarded.
  if (error.message === "KEY_STORAGE_NOT_VERIFIED" && error.safeReason && error.safeStage) {
    console.error(`Storage refusal: ${error.safeReason}; stage: ${error.safeStage}.`);
  }
  process.exitCode = 1;
}
