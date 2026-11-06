import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { projectDir } from "../codex-runner.mjs";
import { SOURCE_FILES } from "../triage-contract.mjs";
import { canonical } from "../approval-protocol.mjs";
import { createApprovalService } from "../approval-service.mjs";
import { loadIncident, buildProposal, renderTriageMarkdown } from "../incident-triage.mjs";

export const historicalFiles = [...SOURCE_FILES,
  "reports/phase9-bug-evidence.json", "reports/phase9-bug-evidence.md",
  "reports/incidents/INC-001-triage.json", "reports/incidents/INC-001-triage.md"];
export async function approvalFixture(t, overrides = {}) {
  const root = await mkdtemp(join(projectDir, ".bugbridge-test-phase11-"));
  t.after(async () => {
    const local = relative(projectDir, root);
    assert.ok(local.startsWith(".bugbridge-test-phase11-") && !local.includes("\\") && !local.includes("/"));
    // Windows antivirus/indexing may briefly hold freshly closed fixture
    // files. Retry only this validated disposable directory, with a bound;
    // persistent locks still fail the test. No production storage is touched.
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  for (const name of historicalFiles) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await copyFile(join(projectDir, name), join(root, name));
  }
  // Existing historical reports may legitimately be stale. Positive tests use
  // a coherent, explicitly local-review proposal ONLY in this temporary copy.
  const old = JSON.parse(await readFile(join(root, "reports/incidents/INC-001-triage.json"), "utf8"));
  const proposal = buildProposal(await loadIncident("INC-001", { root }), old.rootCause.assessment, { analyst: "LOCAL_SOURCE_REVIEW" });
  await writeFile(join(root, "reports/incidents/INC-001-triage.json"), JSON.stringify(proposal, null, 2) + "\n");
  await writeFile(join(root, "reports/incidents/INC-001-triage.md"), renderTriageMarkdown(proposal));
  await mkdir(join(root, ".bugbridge-private"), { mode: 0o700 });
  const keys = [generateKeyPairSync("ed25519"), generateKeyPairSync("ed25519")];
  const config = { version: 1, roomId: "room-test", agentId: "agent-test", agentSenderIds: ["@switch-agent-triager:server"],
    switchIdentity: { enabled: false, verifiedDeployment: "" },
    authorizedHumans: keys.map((key, i) => ({ senderId: `@switch-user-reviewer${i}:server`, publicKey: key.publicKey.export({ type: "spki", format: "pem" }) })) };
  const saveConfig = () => writeFile(join(root, ".bugbridge-private/approval-config.json"), JSON.stringify(config), { mode: 0o600 });
  await saveConfig();
  let time = Date.now();
  const options = { root, roomId: config.roomId, agentId: config.agentId, now: () => time, ...overrides };
  const service = createApprovalService(options);
  const signIntent = (intent, keyIndex = 0) => ({ intent, signature: sign(null, Buffer.from(canonical(intent)), keys[keyIndex].privateKey).toString("base64url") });
  const signed = async (action, challenge = "", index = 0) => signIntent(await service.prepareLocalIntent(action, "INC-001", config.authorizedHumans[index].senderId, challenge), index);
  const request = async () => service.submitSigned(await signed("REQUEST"));
  const statePath = join(root, ".bugbridge-private/approvals/INC-001.json");
  const readState = async () => JSON.parse(await readFile(statePath, "utf8"));
  return { root, config, keys, saveConfig, service, signed, signIntent, request, readState, statePath,
    setTime: value => { time = value; }, advance: duration => { time += duration; }, restart: () => createApprovalService(options) };
}
