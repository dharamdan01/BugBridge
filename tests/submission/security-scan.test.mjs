import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { checkSubmission } from "../../scripts/check-submission.mjs";

async function fixture(t) {
  const parent = tmpdir(), root = await mkdtemp(join(parent, "bugbridge-scan-"));
  t.after(async () => { assert.match(relative(parent, root), /^bugbridge-scan-[^\\/]+$/); await rm(root, { recursive: true, force: true, maxRetries: 3 }); });
  return root;
}
test("clean scan is read-only and never grants submission approval", async t => {
  const root = await fixture(t); await writeFile(join(root, "README.md"), "Synthetic demo");
  const result = await checkSubmission(root, { env: {} });
  assert.equal(result.scannedFiles, 1); assert.deepEqual(result.findings, []); assert.equal(result.submissionApproved, false);
  assert.equal(result.gitHistory, "UNAVAILABLE_NO_GIT_METADATA");
});
test("private directories and key/environment files are excluded without reading their contents", async t => {
  const root = await fixture(t); await mkdir(join(root, ".bugbridge-private"));
  for (const name of [".env", "private.pem", ".bugbridge-private/approval-config.json"]) await writeFile(join(root, name), "SYNTHETIC_SECRET_ONLY");
  const result = await checkSubmission(root, { env: { API_KEY: "SYNTHETIC_SECRET_ONLY" } });
  assert.equal(result.scannedFiles, 0); assert.equal(result.excludedEntries, 3); assert.deepEqual(result.findings, []);
});
test("DPAPI credentials and private database exports are excluded without opening them", async t => {
  const root = await fixture(t);
  for (const name of ["credential.dpapi", "credential.clixml", "credential.pscredential", "credentials.json", "auth.json", "records.db", "database.dump"]) await writeFile(join(root, name), "SYNTHETIC_SECRET_ONLY");
  await mkdir(join(root, "database-exports")); await writeFile(join(root, "database-exports/users.json"), "SYNTHETIC_SECRET_ONLY");
  await mkdir(join(root, "reports/private"), { recursive: true }); await writeFile(join(root, "reports/private/account.json"), "SYNTHETIC_SECRET_ONLY");
  const result = await checkSubmission(root, { env: { API_KEY: "SYNTHETIC_SECRET_ONLY" } });
  assert.equal(result.scannedFiles, 0); assert.equal(result.excludedEntries, 9); assert.deepEqual(result.findings, []);
});
test("current secret values are detected without appearing in output", async t => {
  const root = await fixture(t); await writeFile(join(root, "README.md"), "SYNTHETIC_VALUE_ONLY");
  const result = await checkSubmission(root, { env: { SWITCH_AGENT_KEY: "SYNTHETIC_VALUE_ONLY" } });
  assert.equal(result.findings[0].category, "CURRENT_ENV_SECRET_MATCH"); assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_VALUE_ONLY/);
});
test("private key blocks and realistic token patterns are reported without contents", async t => {
  const root = await fixture(t), token = "sk-" + "X".repeat(40);
  await writeFile(join(root, "README.md"), [["-----", "BEGIN PRIVATE KEY", "-----"].join(""), "X".repeat(40), ["-----", "END PRIVATE KEY", "-----"].join(""), token].join("\n"));
  const result = await checkSubmission(root, { env: {} });
  assert.deepEqual(result.findings.map(x => x.category), ["PRIVATE_KEY_MATERIAL", "TOKEN_PATTERN"]);
  assert.equal(JSON.stringify(result).includes(token), false); assert.doesNotMatch(JSON.stringify(result), /BEGIN PRIVATE KEY/);
});
test("links are refused without inspecting an external target", async t => {
  const root = await fixture(t), outside = await fixture(t); await writeFile(join(outside, "README.md"), "SYNTHETIC_OUTSIDE_SECRET");
  await symlink(outside, join(root, "docs"), process.platform === "win32" ? "junction" : "dir");
  const result = await checkSubmission(root, { env: {} }); assert.equal(result.findings[0].category, "LINK_REQUIRES_REVIEW"); assert.equal(result.scannedFiles, 0);
});
test("personal references return file locations rather than values", async t => {
  const root = await fixture(t); await mkdir(join(root, "reports")); await writeFile(join(root, "reports/example.md"), "fictional@example.invalid");
  const result = await checkSubmission(root, { env: {} }); assert.equal(result.personalData.length, 1); assert.doesNotMatch(JSON.stringify(result), /fictional@example/);
});
test("unknown and oversized release artifacts require explicit review", async t => {
  const root = await fixture(t); await mkdir(join(root, "unreviewed")); await writeFile(join(root, "capture.bin"), "fake"); await writeFile(join(root, "README.md"), "x".repeat(2_000_001));
  const result = await checkSubmission(root, { env: {} }); assert.equal(result.findings.length, 3); assert.equal(result.status, "REVIEW_REQUIRED");
});
test("Git metadata is never mistaken for a completed history audit", async t => {
  const root = await fixture(t); await mkdir(join(root, ".git")); await writeFile(join(root, ".git/config"), "SYNTHETIC_SECRET_ONLY");
  const result = await checkSubmission(root, { env: {} }); assert.equal(result.scannedFiles, 0); assert.equal(result.gitHistory, "NOT_SCANNED_OPERATOR_HISTORY_AUDIT_REQUIRED");
});
test("PEM validation expressions in source are not mistaken for actual key blocks", async t => {
  const root = await fixture(t); await mkdir(join(root, "scripts"));
  const pattern = ["/^-----", "BEGIN PRIVATE KEY-----\\r?\\n[A-Za-z0-9+/=\\r\\n]+-----", "END PRIVATE KEY-----\\r?\\n?$/"].join("");
  await writeFile(join(root, "scripts/validator.mjs"), `const validator = ${pattern};`);
  const result = await checkSubmission(root, { env: {} }); assert.deepEqual(result.findings, []);
});
