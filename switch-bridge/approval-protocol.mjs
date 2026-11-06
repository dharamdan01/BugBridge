import { createHash, createPublicKey, verify } from "node:crypto";

export const PRIVATE_DIRECTORY = ".bugbridge-private";
export const TEN_MINUTES = 600_000;
export const APPROVAL_STATUSES = Object.freeze(["AWAITING_APPROVAL", "APPROVED", "REJECTED", "APPLYING", "VERIFIED", "FAILED"]);
export const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
export const digest = value => createHash("sha256").update(value).digest("hex");
export const challengePattern = /^[A-Za-z0-9_-]{43}$/;
export function validChallenge(value) {
  return typeof value === "string" && challengePattern.test(value) && Buffer.from(value, "base64url").toString("base64url") === value;
}
export function exactKeys(value, names) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...names].sort().join("\0");
}
const validId = value => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\s\x00-\x1f\x7f]/.test(value);

export function parseApprovalCommand(command) {
  let match = /^REQUEST FIX BUGBRIDGE (INC-\d{3})$/.exec(command);
  if (match) return { action: "REQUEST", incidentId: match[1], challenge: "" };
  match = /^(APPROVE|REJECT) BUGBRIDGE (INC-\d{3}) ([A-Za-z0-9_-]{43})$/.exec(command);
  if (!match || !validChallenge(match[3])) return null;
  return { action: match[1], incidentId: match[2], challenge: match[3] };
}

export function validateApprovalConfig(config) {
  if (!exactKeys(config, ["version", "roomId", "agentId", "agentSenderIds", "switchIdentity", "authorizedHumans"]) ||
      config.version !== 1 || !validId(config.roomId) || !validId(config.agentId) ||
      !Array.isArray(config.agentSenderIds) || !config.agentSenderIds.length || !config.agentSenderIds.every(validId) ||
      !exactKeys(config.switchIdentity, ["enabled", "verifiedDeployment"]) || typeof config.switchIdentity.enabled !== "boolean" ||
      typeof config.switchIdentity.verifiedDeployment !== "string" || config.switchIdentity.verifiedDeployment.length > 200 ||
      (config.switchIdentity.enabled && !config.switchIdentity.verifiedDeployment.trim()) ||
      !Array.isArray(config.authorizedHumans) || !config.authorizedHumans.length || config.authorizedHumans.length > 32) throw new Error("Invalid approval configuration");
  const ids = new Set(), fingerprints = new Set();
  for (const human of config.authorizedHumans) {
    if (!exactKeys(human, ["senderId", "publicKey"]) || !validId(human.senderId) || human.senderId === config.agentId ||
        config.agentSenderIds.includes(human.senderId) || human.senderId.toLowerCase().replace(/^@/, "") === "bug-triager" ||
        typeof human.publicKey !== "string" || !human.publicKey.startsWith("-----BEGIN PUBLIC KEY-----") || human.publicKey.length > 500) throw new Error("Invalid approval allowlist");
    const key = createPublicKey(human.publicKey);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("Approval requires Ed25519");
    const fingerprint = digest(key.export({ type: "spki", format: "der" }));
    if (ids.has(human.senderId) || fingerprints.has(fingerprint)) throw new Error("Duplicate approval principal");
    ids.add(human.senderId); fingerprints.add(fingerprint);
  }
  return config;
}
export function authorizeHuman(config, id) {
  if (!validId(id) || id === config.agentId || config.agentSenderIds.includes(id)) throw new Error("Unauthorized human");
  const human = config.authorizedHumans.find(item => item.senderId === id);
  if (!human) throw new Error("Unauthorized human");
  return { id, keyFingerprint: digest(createPublicKey(human.publicKey).export({ type: "spki", format: "der" })), publicKey: human.publicKey };
}

export function validateIntent(intent, now = Date.now()) {
  if (!exactKeys(intent, ["version", "domain", "action", "incidentId", "roomId", "senderId", "proposalDigest", "challenge", "nonce", "issuedAt", "expiresAt"]) ||
      intent.version !== 1 || intent.domain !== "BUGBRIDGE_APPROVAL_V1" || !["REQUEST", "APPROVE", "REJECT"].includes(intent.action) ||
      intent.incidentId !== "INC-001" || !validId(intent.roomId) || !validId(intent.senderId) ||
      !/^[a-f0-9]{64}$/.test(intent.proposalDigest) || !validChallenge(intent.nonce) ||
      (intent.action === "REQUEST" ? intent.challenge !== "" : !validChallenge(intent.challenge)) ||
      !Number.isSafeInteger(intent.issuedAt) || !Number.isSafeInteger(intent.expiresAt) ||
      intent.expiresAt - intent.issuedAt !== TEN_MINUTES || now < intent.issuedAt || now >= intent.expiresAt) throw new Error("Invalid or expired signed intent");
  return intent;
}
export function verifySignedIntent(envelope, config, now = Date.now()) {
  if (!exactKeys(envelope, ["intent", "signature"]) || typeof envelope.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) throw new Error("Invalid approval signature");
  const intent = validateIntent(envelope.intent, now);
  if (intent.roomId !== config.roomId) throw new Error("Wrong approval room");
  const human = authorizeHuman(config, intent.senderId);
  const signature = Buffer.from(envelope.signature, "base64url");
  if (signature.toString("base64url") !== envelope.signature || !verify(null, Buffer.from(canonical(intent)), human.publicKey, signature)) throw new Error("Invalid approval signature");
  return { human, intent };
}

// The public protocol documents payload.sender as an opaque participant ID.
// The private capability is attached ONLY by our existing Switch transport;
// neither message text nor JSON fields such as trusted/authenticated can mint it.
const transportMessages = new WeakMap();
export function markSwitchMessage(data, { roomId, agentId }) {
  if (data && typeof data === "object" && data.room_id === roomId && typeof data.payload?.sender === "string") {
    transportMessages.set(data, { roomId, agentId, sender: data.payload.sender, senderKind: data.payload.sender_kind, senderType: data.payload.sender_type, body: data.payload.body, messageId: data.payload.message_id });
  }
}
export function resolveSwitchHuman(data, config, { roomId, agentId }) {
  if (!config.switchIdentity.enabled) throw new Error("Switch sender mapping not verified");
  const proof = transportMessages.get(data);
  if (!proof || proof.roomId !== roomId || proof.agentId !== agentId || roomId !== config.roomId || agentId !== config.agentId ||
      data.room_id !== roomId || proof.sender !== data.payload?.sender || proof.body !== data.payload.body || proof.messageId !== data.payload.message_id ||
      proof.senderKind !== data.payload.sender_kind || proof.senderType !== data.payload.sender_type ||
      // The actual Switch contract uses sender_kind. Missing/unknown kinds
      // cannot be upgraded to human by an allowlist or a legacy text claim.
      proof.senderKind !== "user" ||
      (proof.senderType !== undefined && !["user", "human"].includes(proof.senderType)) ||
      typeof proof.messageId !== "string" || !proof.messageId.trim()) throw new Error("Trusted human metadata unavailable");
  return authorizeHuman(config, proof.sender);
}
