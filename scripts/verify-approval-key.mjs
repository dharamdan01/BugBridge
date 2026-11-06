import { verifyApprovalKey } from "./approval-key-provisioning.mjs";

try {
  const [directory, ...extra] = process.argv.slice(2);
  if (directory === "--help" && !extra.length) {
    console.log("Usage: node scripts/verify-approval-key.mjs <absolute-existing-key-directory-outside-BugBridge>");
    console.log("Read-only: verifies native parent/storage ACLs, PKCS8/SPKI Ed25519 pair and public fingerprint. No keys, approval or enrollment are created.");
  } else {
    if (!directory || extra.length) throw new Error("USAGE");
    console.log(JSON.stringify(await verifyApprovalKey({ directory }), null, 2));
  }
} catch (error) {
  const codes = new Set(["USAGE", "WINDOWS_ACL_REQUIRED", "UNSAFE_KEY_PATH", "KEY_PATH_MUST_BE_OUTSIDE_PROJECT", "KEY_PATH_INSIDE_GIT_REPOSITORY", "KEY_STORAGE_NOT_VERIFIED", "POWERSHELL_SCRIPT_POLICY_BLOCKED", "KEY_PAIR_VERIFICATION_FAILED"]);
  console.error(`Key verification stopped: ${codes.has(error.message) ? error.message : "KEY_PAIR_VERIFICATION_FAILED"}. No files or approval state changed; private material and native exceptions are omitted.`);
  if (error.message === "KEY_STORAGE_NOT_VERIFIED" && error.safeReason && error.safeStage) console.error(`Storage refusal: ${error.safeReason}; stage: ${error.safeStage}.`);
  process.exitCode = 1;
}
