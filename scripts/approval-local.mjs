import { createApprovalService, approvalReply } from "../switch-bridge/approval-service.mjs";
import { readPrivateApprovalFile, writePrivateApprovalFile } from "../switch-bridge/approval-files.mjs";
import { projectDir } from "../switch-bridge/codex-runner.mjs";
import { checkedPath } from "../switch-bridge/incident-files.mjs";
import { rm } from "node:fs/promises";

const usage = "Usage: node scripts/approval-local.mjs prepare REQUEST|APPROVE|REJECT INC-001 <authorized-sender-id> [challenge] | submit";
try {
  const [operation, ...args] = process.argv.slice(2);
  const service = createApprovalService();
  if (operation === "prepare" && (args.length === 3 || args.length === 4)) {
    const [action, id, sender, challenge] = args;
    const intent = await service.prepareLocalIntent(action, id, sender, challenge);
    await writePrivateApprovalFile(projectDir, "unsigned-intent.json", JSON.stringify(intent, null, 2) + "\n");
    console.log("Unsigned intent prepared in .bugbridge-private/unsigned-intent.json. Review the exact action, identity, room, incident and proposal digest before signing. No approval state changed.");
  } else if (operation === "submit" && !args.length) {
    const envelope = JSON.parse(await readPrivateApprovalFile(projectDir, "signed-intent.json"));
    const response = await service.submitSigned(envelope);
    console.log(approvalReply(response));
    if (!["CHALLENGE_CREATED", "DECISION_RECORDED"].includes(response.outcome)) process.exitCode = 1;
    else for (const name of ["unsigned-intent.json", "signed-intent.json"]) {
      await rm(await checkedPath(projectDir, `.bugbridge-private/${name}`), { force: true });
    }
  } else {
    console.log(usage); if (operation !== "--help") process.exitCode = 1;
  }
} catch {
  console.error("Local approval denied: configuration, signature, evidence, state or arguments could not be verified. No fix applied; execution remains disabled.");
  process.exitCode = 1;
}
