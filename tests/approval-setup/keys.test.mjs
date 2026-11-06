import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile, readdir, writeFile, rm, lstat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDirectory, provisionApprovalKey, verifyApprovalKey, newKeyDirectory, windowsKeyStorage } from "../../scripts/approval-key-provisioning.mjs";

const execute = promisify(execFile);
const confirmation = "CREATE APPROVAL SIGNING KEY";
// Query policy without changing it. Do not run blocked files through -Command
// or override execution policy to make integration tests pass.
let nativeAclSkip = process.platform !== "win32" ? "Windows required" : false;
if (!nativeAclSkip) {
  try {
    const ps = join(process.env.SystemRoot || process.env.SYSTEMROOT, "System32/WindowsPowerShell/v1.0/powershell.exe");
    const { stdout } = await execute(ps, ["-NoProfile", "-NonInteractive", "-Command", "Get-ExecutionPolicy"], { timeout: 10_000 });
    if (!["RemoteSigned", "Unrestricted", "Bypass"].includes(stdout.trim())) nativeAclSkip = "Native script execution is blocked by current policy; policy was not changed";
  } catch { nativeAclSkip = "Native PowerShell execution-policy probe unavailable"; }
}
const osEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "PSEXECUTIONPOLICYPREFERENCE",
]).has(key.toUpperCase())));
async function configureFixture(directory, operation = "SecureRoot") {
  const ps = join(process.env.SystemRoot || process.env.SYSTEMROOT, "System32/WindowsPowerShell/v1.0/powershell.exe");
  const child = execute(ps, ["-NoProfile", "-NonInteractive", "-File", join(projectDirectory, "tests/approval-setup/secure-key-fixture.ps1"), "-Directory", directory, "-Operation", operation],
    { shell: false, windowsHide: true, timeout: 15_000, env: osEnvironment() });
  child.child.stdin.end();
  const { stdout } = await child;
  return JSON.parse(stdout);
}
async function fixture(t, { secureParent = false } = {}) {
  // Keep key-storage fixtures outside the real repository. Workspace ACLs can
  // legitimately contain additional write principals and are not a secure
  // operator-owned key parent. Never loosen the production parent ACL gate.
  const temp = await mkdtemp(join(tmpdir(), "bugbridge-test-keysetup-"));
  t.after(async () => { for (let attempt = 0; ; attempt++) { try { await rm(temp, { recursive: true, force: true }); break; } catch (error) { if (attempt >= 5) throw error; await new Promise(resolve => setTimeout(resolve, 100)); } } });
  if (secureParent) {
    assert.deepEqual(await configureFixture(temp), { status: "VERIFIED", ownerOnly: true, empty: true });
  }
  const root = join(temp, "synthetic-repository"); await mkdir(join(root, "scripts"), { recursive: true });
  await copyFile(join(projectDirectory, "scripts/approval-key-storage.ps1"), join(root, "scripts/approval-key-storage.ps1"));
  const directory = join(temp, "new operator keys");
  return { temp, root, directory, confirmation, platform: "win32" };
}
test("no explicit key confirmation means no storage operation", async t => {
  const h = await fixture(t); let calls = 0;
  await assert.rejects(provisionApprovalKey({ ...h, confirmation: "yes", storage: async () => { calls++; } }), /EXPLICIT_CONFIRMATION_REQUIRED/);
  assert.equal(calls, 0); assert.deepEqual(await readdir(h.temp), ["synthetic-repository"]);
});
test("non-Windows platforms fail closed instead of pretending chmod verifies ACLs", async t => {
  const h = await fixture(t);
  await assert.rejects(provisionApprovalKey({ ...h, platform: "linux" }), /WINDOWS_ACL_REQUIRED/);
});
test("repository, ancestor and relative paths are refused", async t => {
  const h = await fixture(t);
  for (const directory of [h.root, join(h.root, "keys"), h.temp, "relative-keys"]) await assert.rejects(newKeyDirectory(directory, h.root), /KEY_PATH_MUST_BE_OUTSIDE_PROJECT|UNSAFE_KEY_PATH/);
});
test("existing directories and files are never reused or overwritten", async t => {
  const h = await fixture(t); await mkdir(h.directory); await writeFile(join(h.directory, "approval-private.pem"), "UNCHANGED");
  await assert.rejects(provisionApprovalKey(h), /KEY_DIRECTORY_EXISTS/);
  assert.equal(await readFile(join(h.directory, "approval-private.pem"), "utf8"), "UNCHANGED");
});
test("ACL failure occurs before generating or writing any key", async t => {
  const h = await fixture(t);
  await assert.rejects(provisionApprovalKey({ ...h, storage: async () => { throw new Error("FIXTURE_ACL_FAILURE"); } }), /FIXTURE_ACL_FAILURE/);
  await assert.rejects(lstat(h.directory), { code: "ENOENT" });
});
test("second ACL gate must pass before key creation", async t => {
  const h = await fixture(t); let calls = 0;
  await assert.rejects(provisionApprovalKey({ ...h, storage: async () => { if (++calls === 1) await mkdir(h.directory); else throw new Error("FIXTURE_VERIFY_FAILED"); } }), /FIXTURE_VERIFY_FAILED/);
  assert.deepEqual(await readdir(h.directory), []);
});
test("new Ed25519 pair works with existing SPKI enrollment and PKCS8 signing (mock ACL provider)", async t => {
  const h = await fixture(t), result = await provisionApprovalKey({ ...h, storage: async operation => { if (operation === "Prepare") await mkdir(h.directory); } });
  assert.equal(result.status, "CREATED");
  assert.equal(result.enrollmentPerformed, false); assert.equal(result.patchExecutionEnabled, false);
  assert.match(result.publicKeySpkiSha256, /^[a-f0-9]{64}$/);
  const privatePem = await readFile(result.privateKeyPath, "utf8"), publicPem = await readFile(result.publicKeyPath, "utf8");
  assert.match(privatePem, /^-----BEGIN PRIVATE KEY-----/); assert.match(publicPem, /^-----BEGIN PUBLIC KEY-----/);
  const privateKey = createPrivateKey(privatePem), publicKey = createPublicKey(publicPem);
  assert.equal(privateKey.asymmetricKeyType, "ed25519"); assert.equal(publicKey.asymmetricKeyType, "ed25519");
  assert.deepEqual(createPublicKey(privateKey).export({ type: "spki", format: "der" }), publicKey.export({ type: "spki", format: "der" }));
  const message = Buffer.from("SYNTHETIC-APPROVAL-TEST"); assert.equal(verify(null, message, publicKey, sign(null, message, privateKey)), true);
  const output = JSON.stringify(result); assert.equal(output.includes(privatePem), false); assert.doesNotMatch(output, /BEGIN PRIVATE KEY/);
  const { validateApprovalConfig, authorizeHuman } = await import("../../switch-bridge/approval-protocol.mjs");
  const config = validateApprovalConfig({ version: 1, roomId: "fixture-room", agentId: "fixture-agent", agentSenderIds: ["@fixture-agent:local"],
    switchIdentity: { enabled: false, verifiedDeployment: "" }, authorizedHumans: [{ senderId: "@fixture-human:local", publicKey: publicPem }] });
  assert.equal(authorizeHuman(config, "@fixture-human:local").keyFingerprint, result.publicKeySpkiSha256);
  await assert.rejects(provisionApprovalKey(h), /KEY_DIRECTORY_EXISTS/);
});
test("native Windows owner-only ACL verified before and after synthetic key provisioning", { skip: nativeAclSkip, timeout: 35_000 }, async t => {
  const h = await fixture(t, { secureParent: true }), result = await provisionApprovalKey(h);
  assert.equal(result.windowsAcl, "VERIFIED_OWNER_ONLY");
  await windowsKeyStorage("Verify", h.directory, h.root);
  const checked = await verifyApprovalKey(h);
  assert.equal(checked.publicKeySpkiSha256, result.publicKeySpkiSha256);
  assert.equal(checked.signatureSelfTest, "PASS"); assert.equal(checked.modified, false);
  const cli = await execute(process.execPath, [join(projectDirectory, "scripts/verify-approval-key.mjs"), h.directory],
    { shell: false, windowsHide: true, timeout: 15_000, env: osEnvironment() });
  assert.equal(JSON.parse(cli.stdout).publicKeySpkiSha256, result.publicKeySpkiSha256);
  assert.doesNotMatch(cli.stdout + cli.stderr, /BEGIN PRIVATE KEY/);
});
test("native parent preflight accepts a secure parent without creating the target", { skip: nativeAclSkip }, async t => {
  const h = await fixture(t, { secureParent: true });
  const before = await readdir(h.temp);
  await windowsKeyStorage("InspectParent", h.directory, h.root);
  await assert.rejects(lstat(h.directory), { code: "ENOENT" });
  assert.deepEqual(await readdir(h.temp), before);
});
test("post-write verification failure never reports success or retries/deletes private files", async t => {
  const h = await fixture(t); let calls = 0;
  await assert.rejects(provisionApprovalKey({ ...h, storage: async () => {
    calls++; if (calls === 1) await mkdir(h.directory); if (calls === 3) throw new Error("PRIVATE_EXCEPTION");
  } }), error => error.message === "KEY_CREATION_INCOMPLETE_REVIEW_STORAGE");
  assert.equal(calls, 3); assert.deepEqual(await readdir(h.directory), ["approval-private.pem"]);
});
test("exclusive key writes refuse an existing file introduced after preparation", async t => {
  const h = await fixture(t); let calls = 0;
  await assert.rejects(provisionApprovalKey({ ...h, storage: async () => {
    if (++calls === 1) { await mkdir(h.directory); await writeFile(join(h.directory, "approval-private.pem"), "DO_NOT_OVERWRITE"); }
  } }), /KEY_CREATION_INCOMPLETE_REVIEW_STORAGE/);
  assert.equal(await readFile(join(h.directory, "approval-private.pem"), "utf8"), "DO_NOT_OVERWRITE");
});
test("CLI help does not read credentials or create storage", async () => {
  const result = await execute(process.execPath, [join(projectDirectory, "scripts/provision-approval-key.mjs"), "--help"], { env: { SWITCH_AGENT_KEY: "SYNTHETIC_PRIVATE_CREDENTIAL" } });
  assert.match(result.stdout, /absolute-NEW-directory/); assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_CREDENTIAL|BEGIN PRIVATE KEY/);
});
test("headless CLI cannot provision even if confirmation is piped", async t => {
  const h = await fixture(t);
  await assert.rejects(execute(process.execPath, [join(projectDirectory, "scripts/provision-approval-key.mjs"), h.directory]), error => /INTERACTIVE_OPERATOR_REQUIRED/.test(error.stderr));
  await assert.rejects(lstat(h.directory), { code: "ENOENT" });
});
test("real Windows helper rejects inherited ACLs and does not repair existing directories", { skip: nativeAclSkip }, async t => {
  const h = await fixture(t, { secureParent: true }); await mkdir(h.directory);
  await assert.rejects(windowsKeyStorage("Verify", h.directory, h.root), error => error.message === "KEY_STORAGE_NOT_VERIFIED" && error.safeReason === "ROOT_INHERITANCE_ENABLED");
  await assert.rejects(windowsKeyStorage("Prepare", h.directory, h.root), error => error.message === "KEY_STORAGE_NOT_VERIFIED" && error.safeReason === "DIRECTORY_ALREADY_EXISTS");
  assert.deepEqual(await readdir(h.directory), []);
});
test("native Prepare still refuses an otherwise-owned parent with unauthorized write access", { skip: nativeAclSkip }, async t => {
  const h = await fixture(t, { secureParent: true });
  assert.equal((await configureFixture(h.temp, "AddParentWrite")).status, "NEGATIVE_TEST_FIXTURE_READY");
  await assert.rejects(windowsKeyStorage("Prepare", h.directory, h.root), error => {
    assert.equal(error.message, "KEY_STORAGE_NOT_VERIFIED");
    assert.equal(error.safeReason, "PARENT_UNAUTHORIZED_WRITE"); assert.equal(error.safeStage, "PARENT_WRITE_CHECK");
    assert.equal(Number.isSafeInteger(error.helperLine), true);
    assert.equal(JSON.stringify(error).includes(h.temp), false);
    return true;
  });
  await assert.rejects(lstat(h.directory), { code: "ENOENT" });
  await assert.rejects(windowsKeyStorage("InspectParent", h.directory, h.root), error => error.safeReason === "PARENT_UNAUTHORIZED_WRITE");
});
test("native Verify still refuses non-owner read permission on empty protected storage", { skip: nativeAclSkip }, async t => {
  const h = await fixture(t, { secureParent: true });
  await windowsKeyStorage("Prepare", h.directory, h.root);
  assert.equal((await configureFixture(h.temp, "AddStorageRead")).status, "NEGATIVE_TEST_FIXTURE_READY");
  await assert.rejects(windowsKeyStorage("Verify", h.directory, h.root), error => error.message === "KEY_STORAGE_NOT_VERIFIED" && error.safeReason === "NON_OWNER_ACL_RULE");
});
test("key storage inside any other Git repository is rejected", async t => {
  const h = await fixture(t); await mkdir(join(h.temp, ".git"));
  await assert.rejects(newKeyDirectory(h.directory, h.root), /KEY_PATH_INSIDE_GIT_REPOSITORY/);
});
test("blocked native script policy is actionable and does not silently authorize ACLs", { skip: !nativeAclSkip || process.platform !== "win32" ? "Requires a script-restricted Windows test host" : false }, async t => {
  const h = await fixture(t);
  await assert.rejects(windowsKeyStorage("Prepare", h.directory, h.root), /POWERSHELL_SCRIPT_POLICY_BLOCKED/);
  await assert.rejects(lstat(h.directory), { code: "ENOENT" });
});
test("junctions to another directory are refused", { skip: process.platform !== "win32" }, async t => {
  const h = await fixture(t); const { symlink } = await import("node:fs/promises");
  const junction = join(h.temp, "redirected"); await symlink(h.root, junction, "junction");
  await assert.rejects(newKeyDirectory(join(junction, "keys"), h.root), /UNSAFE_KEY_PATH/);
});

async function mockPair(t) {
  const h = await fixture(t);
  const storage = async operation => { if (operation === "Prepare") await mkdir(h.directory); };
  const created = await provisionApprovalKey({ ...h, storage });
  return { ...h, storage, created };
}
test("read-only verifier validates PKCS8/SPKI formats, matching fingerprint and unchanged files (mock ACL)", async t => {
  const h = await mockPair(t), before = await Promise.all([readFile(h.created.privateKeyPath), readFile(h.created.publicKeyPath)]);
  const calls = [], report = await verifyApprovalKey({ ...h, storage: async operation => { calls.push(operation); } });
  assert.deepEqual(calls, ["InspectParent", "Verify"]);
  assert.equal(report.publicKeySpkiSha256, h.created.publicKeySpkiSha256);
  assert.equal(report.algorithm, "Ed25519"); assert.equal(report.privateFormat, "PKCS8"); assert.equal(report.publicFormat, "SPKI");
  assert.equal(report.enrollmentPublicKeyCompatible, true); assert.equal(report.approvalPerformed, false); assert.equal(report.modified, false);
  assert.deepEqual(await Promise.all([readFile(h.created.privateKeyPath), readFile(h.created.publicKeyPath)]), before);
  assert.equal(JSON.stringify(report).includes(before[0].toString()), false);
});
for (const corruption of ["malformed-private", "malformed-public", "wrong-algorithm", "mismatched-pair", "oversized-private", "public-is-private"]) {
  test(`read-only verifier refuses ${corruption} without logging key bytes`, async t => {
    const h = await mockPair(t);
    if (corruption === "malformed-private") await writeFile(h.created.privateKeyPath, "SYNTHETIC_PRIVATE_MATERIAL_NOT_FOR_LOGS");
    if (corruption === "malformed-public") await writeFile(h.created.publicKeyPath, "invalid public PEM");
    if (corruption === "oversized-private") await writeFile(h.created.privateKeyPath, "SYNTHETIC_PRIVATE_MATERIAL_NOT_FOR_LOGS".repeat(200));
    if (corruption === "public-is-private") await copyFile(h.created.privateKeyPath, h.created.publicKeyPath);
    if (corruption === "wrong-algorithm") {
      const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      await writeFile(h.created.privateKeyPath, pair.privateKey.export({ type: "pkcs8", format: "pem" }));
      await writeFile(h.created.publicKeyPath, pair.publicKey.export({ type: "spki", format: "pem" }));
    }
    if (corruption === "mismatched-pair") await writeFile(h.created.publicKeyPath, generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }));
    await assert.rejects(verifyApprovalKey(h), error => error.message === "KEY_PAIR_VERIFICATION_FAILED" && !JSON.stringify(error).includes("SYNTHETIC_PRIVATE_MATERIAL"));
  });
}
test("read-only verifier never repairs or fills an incomplete key pair", async t => {
  const h = await mockPair(t); await rm(h.created.privateKeyPath);
  await assert.rejects(verifyApprovalKey(h), /KEY_PAIR_VERIFICATION_FAILED/);
  await assert.rejects(lstat(h.created.privateKeyPath), { code: "ENOENT" });
});
test("verifier help and errors never print private material or credentials", async t => {
  const h = await mockPair(t), program = join(projectDirectory, "scripts/verify-approval-key.mjs");
  const help = await execute(process.execPath, [program, "--help"], { env: { SWITCH_AGENT_KEY: "SYNTHETIC_CREDENTIAL" } });
  assert.match(help.stdout, /Read-only/); assert.doesNotMatch(help.stdout + help.stderr, /SYNTHETIC_CREDENTIAL|BEGIN PRIVATE KEY/);
  await assert.rejects(execute(process.execPath, [program, "relative-path"]), error => {
    assert.match(error.stderr, /UNSAFE_KEY_PATH/); assert.doesNotMatch(error.stderr, /BEGIN PRIVATE KEY/); return true;
  });
});
test("generated synthetic pair works with unchanged signing utility (mock ACL); no approval is submitted", async t => {
  const h = await mockPair(t);
  const { approvalFixture } = await import("../../switch-bridge/test/phase11-fixture.mjs");
  const { verifySignedIntent } = await import("../../switch-bridge/approval-protocol.mjs");
  const enrolled = await approvalFixture(t);
  enrolled.config.authorizedHumans[0].publicKey = await readFile(h.created.publicKeyPath, "utf8");
  await enrolled.saveConfig();
  const intent = await enrolled.service.prepareLocalIntent("REQUEST", "INC-001", enrolled.config.authorizedHumans[0].senderId);
  await writeFile(join(enrolled.root, ".bugbridge-private/unsigned-intent.json"), JSON.stringify(intent));
  await mkdir(join(enrolled.root, "switch-bridge"));
  for (const file of await readdir(join(projectDirectory, "switch-bridge"))) if (file.endsWith(".mjs")) await copyFile(join(projectDirectory, "switch-bridge", file), join(enrolled.root, "switch-bridge", file));
  await copyFile(join(projectDirectory, "scripts/sign-approval.mjs"), join(enrolled.root, "scripts/sign-approval.mjs"));
  const output = await execute(process.execPath, [join(enrolled.root, "scripts/sign-approval.mjs"), h.created.privateKeyPath],
    { cwd: enrolled.root, shell: false, windowsHide: true, timeout: 10_000, env: osEnvironment() });
  assert.match(output.stdout, /Signed reviewed REQUEST/); assert.doesNotMatch(output.stdout + output.stderr, /BEGIN PRIVATE KEY/);
  const envelope = JSON.parse(await readFile(join(enrolled.root, ".bugbridge-private/signed-intent.json"), "utf8"));
  assert.equal(verifySignedIntent(envelope, enrolled.config).human.keyFingerprint, h.created.publicKeySpkiSha256);
  await assert.rejects(readFile(enrolled.statePath), { code: "ENOENT" });
});
