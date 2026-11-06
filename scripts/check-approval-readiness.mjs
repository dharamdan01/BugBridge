import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { projectDir } from "../switch-bridge/codex-runner.mjs";
import { loadApprovalProposal } from "../switch-bridge/approval-service.mjs";
import { FIX_EXECUTION_ENABLED, executeApprovedFix } from "../switch-bridge/fix-plan.mjs";
import { readPrivateApprovalFile } from "../switch-bridge/approval-files.mjs";
import { validateApprovalConfig } from "../switch-bridge/approval-protocol.mjs";

// Read-only: no lock, enrollment, intent, signature, state transition, source
// write or network connection. Config values and key material are never printed.
export async function checkApprovalReadiness(root = projectDir) {
  const result = { proposalIntegrity: "FAIL", patchExecutionEnabled: FIX_EXECUTION_ENABLED,
    executionEntryPointRefused: false, enrollmentConfiguration: "ABSENT",
    authorizedHumanIdentity: "PENDING", switchIdentity: "UNVERIFIED", liveApprovalTested: false,
    scope: "EVIDENCE_AND_DISABLED_EXECUTION_ONLY" };
  try {
    const loaded = await loadApprovalProposal(root);
    Object.assign(result, { proposalIntegrity: "PASS", incidentId: loaded.proposal.incidentId,
      status: loaded.proposal.status, proposalDigest: loaded.proposalDigest,
      evidenceDigest: loaded.proposal.reproductionEvidence.sha256,
      reproducedAt: loaded.proposal.reproductionEvidence.reproducedAt, generatedAt: loaded.proposal.generatedAt,
      analysisOrigin: loaded.proposal.rootCause.analyst, sourceFilesVerified: loaded.proposal.supportingFiles.length });
  } catch { /* Fixed FAIL result, no sensitive exceptions. */ }
  try { await executeApprovedFix(); } catch (error) { result.executionEntryPointRefused = error.message === "PHASE_11A_EXECUTION_DISABLED"; }
  try {
    await lstat(join(root, ".bugbridge-private/approval-config.json"));
    result.enrollmentConfiguration = "INVALID";
    const config = validateApprovalConfig(JSON.parse(await readPrivateApprovalFile(root, "approval-config.json")));
    result.enrollmentConfiguration = "VALID";
    result.switchIdentity = config.switchIdentity.enabled ? "OPERATOR_ATTESTED_NOT_INDEPENDENTLY_VERIFIED" : "DISABLED";
  } catch (error) {
    // A permissions/IO failure is not evidence that enrollment is absent.
    if (["EACCES", "EPERM"].includes(error.code) || (result.enrollmentConfiguration === "ABSENT" && error.code !== "ENOENT")) {
      result.enrollmentConfiguration = "UNREADABLE";
    }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    console.error("Usage: node scripts/check-approval-readiness.mjs"); process.exitCode = 1;
  } else {
    const result = await checkApprovalReadiness();
    console.log(JSON.stringify(result, null, 2));
    if (result.proposalIntegrity !== "PASS" || result.patchExecutionEnabled || !result.executionEntryPointRefused || ["INVALID", "UNREADABLE"].includes(result.enrollmentConfiguration)) process.exitCode = 1;
  }
}
