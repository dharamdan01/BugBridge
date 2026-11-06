import { randomBytes, timingSafeEqual } from "node:crypto";
import { projectDir } from "./codex-runner.mjs";
import { readIncidentFile } from "./incident-files.mjs";
import { loadIncident, renderTriageMarkdown, assertIncidentId } from "./incident-triage.mjs";
import { validateProposal } from "./triage-contract.mjs";
import { prepareFixPlan } from "./fix-plan.mjs";
import { createApprovalStore } from "./approval-store.mjs";
import { readPrivateApprovalFile } from "./approval-files.mjs";
import {
  TEN_MINUTES, canonical, digest, validateApprovalConfig, authorizeHuman,
  resolveSwitchHuman, verifySignedIntent, validChallenge, parseApprovalCommand,
} from "./approval-protocol.mjs";

const randomChallenge = () => randomBytes(32).toString("base64url");
export async function loadApprovalProposal(root = projectDir) {
  const proposalText = await readIncidentFile(root, "reports/incidents/INC-001-triage.json");
  const proposal = validateProposal(JSON.parse(proposalText));
  const markdown = await readIncidentFile(root, "reports/incidents/INC-001-triage.md");
  const incident = await loadIncident("INC-001", { root });
  if (markdown !== renderTriageMarkdown(proposal) || canonical(proposal.supportingFiles) !== canonical(incident.supportingFiles) ||
      canonical(proposal.reproductionEvidence) !== canonical(incident.reproductionEvidence)) throw new Error("Stale approval proposal");
  const controllerText = await readIncidentFile(root, "src/controllers/tasks.controller.js");
  const plan = prepareFixPlan("INC-001", controllerText);
  return { proposal, proposalDigest: digest(proposalText), snapshot: {
    proposalText, proposalMarkdown: markdown, controllerText, controllerDigest: digest(controllerText),
    evidenceJson: await readIncidentFile(root, "reports/phase9-bug-evidence.json"),
    evidenceMarkdown: await readIncidentFile(root, "reports/phase9-bug-evidence.md"),
    evidenceDigest: incident.reproductionEvidence.sha256, markdownDigest: incident.markdownSha256,
    plan, planDigest: digest(canonical(plan)),
  } };
}
const result = (status, outcome, details = {}) => ({ incidentId: "INC-001", status, outcome, executionEnabled: false, ...details });

export function approvalReply(value) {
  const prefix = `BugBridge approval: ${value.incidentId} | ${value.status ?? "STATUS_UNAVAILABLE"} | ${value.outcome}.`;
  if (value.outcome === "CHALLENGE_CREATED") return `${prefix}\n` +
    "Proposed change: remove the empty-input generic throw and unused isObject import in src/controllers/tasks.controller.js. Expected impact: empty POST input returns 400 VALIDATION_ERROR; valid creation remains 201.\n" +
    "Verification after a separately enabled Phase 11B: unchanged 400 regression, valid creation, no inserted tasks, API and bridge suites, and reviewed preserved-bug acceptance policies.\n" +
    `Proposal SHA-256: ${value.proposalDigest}. Expires: ${new Date(value.expiresAt).toISOString()}.\n` +
    `APPROVE BUGBRIDGE INC-001 ${value.challenge}\nREJECT BUGBRIDGE INC-001 ${value.challenge}\n` +
    "Only the bound authorized human may decide for this room. If Switch sender authentication is unavailable, submit a signed local decision. Phase 11A records decisions only; execution is disabled and no fix is applied.";
  if (value.outcome === "IDENTITY_UNAVAILABLE") return `${prefix} Trusted sender authentication is unavailable. Use the documented signed local workflow. No approval state changed; no fix applied.`;
  return `${prefix} ${value.outcome === "DECISION_RECORDED" ? "Human decision recorded." : "Request not accepted."} Phase 11A execution is disabled. No fix applied.`;
}

export function createApprovalService({ root = projectDir, roomId, agentId, now = Date.now,
  store = createApprovalStore({ root }),
} = {}) {
  async function configuration() {
    const config = validateApprovalConfig(JSON.parse(await readPrivateApprovalFile(root, "approval-config.json")));
    if ((roomId && roomId !== config.roomId) || (agentId && agentId !== config.agentId)) throw new Error("Approval configuration mismatch");
    return config;
  }
  async function perform(command, human, config, messageHash, method, expectedDigest) {
    assertIncidentId(command.incidentId);
    authorizeHuman(config, human.id);
    return store.transaction(async state => {
      const current = state.records.at(-1);
      const reject = outcome => ({ write: false, value: result(current?.status ?? "AWAITING_APPROVAL", outcome) });
      if (state.records.some(record => record.requestMessageHash === messageHash || record.decisionMessageHash === messageHash)) return reject("REPLAY_REJECTED");
      const loaded = await loadApprovalProposal(root);
      if (expectedDigest && expectedDigest !== loaded.proposalDigest) return reject("PROPOSAL_CHANGED");
      const time = now();
      if (command.action === "REQUEST") {
        if (current && ["APPROVED", "APPLYING", "VERIFIED"].includes(current.status)) return reject("DECISION_ALREADY_FINAL");
        if (current?.status === "AWAITING_APPROVAL" && time >= current.issuedAt && time < current.expiresAt) return reject("ALREADY_PENDING");
        if (state.records.length >= 256) return reject("LEDGER_FULL");
        if (current?.status === "AWAITING_APPROVAL") {
          current.status = "FAILED"; current.reason = "EXPIRED_OR_CLOCK_CHANGED"; current.consumedAt = time;
        }
        const challenge = randomChallenge();
        const record = {
          requestId: randomChallenge(), status: "AWAITING_APPROVAL", subjectId: human.id, roomId: config.roomId,
          keyFingerprint: human.keyFingerprint, proposalDigest: loaded.proposalDigest,
          challengeHash: digest(challenge), issuedAt: time, expiresAt: time + TEN_MINUTES,
          requestMessageHash: messageHash, decisionMessageHash: null, consumedAt: null, reason: null,
          authorizationMethod: method, decisionMethod: null, snapshot: loaded.snapshot,
        };
        state.records.push(record);
        return { write: true, value: result(record.status, "CHALLENGE_CREATED", { challenge, proposalDigest: record.proposalDigest, expiresAt: record.expiresAt }) };
      }
      if (!validChallenge(command.challenge)) return reject("MALFORMED_COMMAND");
      const challengeHash = digest(command.challenge);
      const record = state.records.find(item => timingSafeEqual(Buffer.from(item.challengeHash, "hex"), Buffer.from(challengeHash, "hex")));
      if (!record) return reject("CHALLENGE_REJECTED");
      if (record.status !== "AWAITING_APPROVAL") return reject("REPLAY_REJECTED");
      if (record.subjectId !== human.id || record.roomId !== config.roomId || record.keyFingerprint !== human.keyFingerprint) return reject("BOUND_IDENTITY_REQUIRED");
      if (time < record.issuedAt || time >= record.expiresAt) {
        record.status = "FAILED"; record.reason = "EXPIRED_OR_CLOCK_CHANGED"; record.consumedAt = time;
        return { write: true, value: result("FAILED", "CHALLENGE_EXPIRED") };
      }
      if (record.proposalDigest !== loaded.proposalDigest || canonical(record.snapshot) !== canonical(loaded.snapshot)) {
        record.status = "FAILED"; record.reason = "PROPOSAL_CHANGED"; record.consumedAt = time;
        return { write: true, value: result("FAILED", "PROPOSAL_CHANGED") };
      }
      record.status = command.action === "APPROVE" ? "APPROVED" : "REJECTED";
      record.consumedAt = time; record.decisionMessageHash = messageHash; record.decisionMethod = method;
      return { write: true, value: result(record.status, "DECISION_RECORDED") };
    });
  }
  async function handleChat(command, data) {
    if (command.incidentId !== "INC-001") return { ...result(null, "UNSUPPORTED_INCIDENT"), incidentId: /^INC-\d{3}$/.test(command.incidentId) ? command.incidentId : "UNSUPPORTED" };
    try {
      const config = await configuration();
      const body = data?.payload?.body;
      const parsed = typeof body === "string" && parseApprovalCommand(body.trim().replace(/^@bug-triager[,:]?\s+/i, ""));
      if (!parsed || canonical(parsed) !== canonical(command)) return result(null, "MALFORMED_COMMAND");
      let human;
      try { human = resolveSwitchHuman(data, config, { roomId, agentId }); } catch { return result(null, "IDENTITY_UNAVAILABLE"); }
      return await perform(command, human, config, digest(canonical([config.roomId, data.payload.message_id])), "VERIFIED_SWITCH_METADATA");
    } catch { return result(null, "APPROVAL_DENIED"); }
  }
  async function prepareLocalIntent(action, incidentId, senderId, challenge = "") {
    assertIncidentId(incidentId);
    const config = await configuration(); authorizeHuman(config, senderId);
    if (!["REQUEST", "APPROVE", "REJECT"].includes(action) || (action === "REQUEST" ? challenge !== "" : !validChallenge(challenge))) throw new Error("Invalid local approval command");
    const loaded = await loadApprovalProposal(root);
    const issuedAt = now();
    return { version: 1, domain: "BUGBRIDGE_APPROVAL_V1", action, incidentId, roomId: config.roomId, senderId,
      proposalDigest: loaded.proposalDigest, challenge, nonce: randomChallenge(), issuedAt, expiresAt: issuedAt + TEN_MINUTES };
  }
  async function submitSigned(envelope) {
    try {
      const config = await configuration();
      const { human, intent } = verifySignedIntent(envelope, config, now());
      return await perform(intent, human, config, digest(canonical(["SIGNED_LOCAL", intent.nonce])), "ED25519_SIGNED_LOCAL", intent.proposalDigest);
    } catch { return result(null, "APPROVAL_DENIED"); }
  }
  return { handleChat, prepareLocalIntent, submitSigned };
}
