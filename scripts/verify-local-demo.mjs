import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { runReproduction } from "./reproduce-bug.mjs";
import { checkSubmission } from "./check-submission.mjs";
import { checkApprovalReadiness } from "./check-approval-readiness.mjs";
import { SOURCE_FILES } from "../switch-bridge/triage-contract.mjs";
import { checkedPath } from "../switch-bridge/incident-files.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);
const hash = text => createHash("sha256").update(text).digest("hex");
const allowedEnv = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "PSEXECUTIONPOLICYPREFERENCE"]);
const report = { phase: "12+13", startedAt: new Date().toISOString(), nodeVersion: process.version,
  suites: [], checks: [], liveMattermostVerifiedThisRun: false, realCodexInvokedThisRun: false,
  productionEnrollmentPerformed: false, patchExecutionEnabled: false, submissionApproved: false };
let destination;
try {
  if (process.argv.length !== 2 || resolve(process.cwd()) !== resolve(root)) throw new Error("Run from project root with no arguments");
  const guardedFiles = [...SOURCE_FILES, "reports/phase9-bug-evidence.json", "reports/phase9-bug-evidence.md", "reports/incidents/INC-001-triage.json", "reports/incidents/INC-001-triage.md", "reports/phase11/phase9-bug-evidence.json", "reports/phase11/phase9-bug-evidence.md"];
  const before = await Promise.all(guardedFiles.map(async file => [file, hash(await readFile(await checkedPath(root, file)))]));
  const directory = `reports/local-demo/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  // checkedPath rejects links/junctions and traversal; only a fresh fixed-prefix
  // report directory is created. Existing historical artifacts are not targets.
  destination = await checkedPath(root, directory + "/verification.json", { createParents: true });
  const workingDirectory = join(root, directory);
  async function run(args) {
    const child = execute(process.execPath, args, { cwd: root, shell: false, windowsHide: true,
      timeout: 180_000, maxBuffer: 2_000_000, killSignal: "SIGKILL",
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => allowedEnv.has(key.toUpperCase()))) });
    child.child.stdin.on("error", () => {}); child.child.stdin.end();
    try { return { code: 0, ...(await child) }; }
    catch (error) { return { code: Number.isInteger(error.code) ? error.code : -1, stdout: error.stdout || "", stderr: "" }; }
  }
  for (const [name, pattern] of [["api", "tests/tasks.test.js"], ["investigation", "tests/investigation/*.test.mjs"],
    ["switch-bridge-including-triage-approval-and-local-e2e", "switch-bridge/test/*.test.mjs"],
    ["approval-setup-including-native-ACL", "tests/approval-setup/*.test.mjs"], ["enrollment-fixtures", "tests/enrollment/*.test.mjs"],
    ["submission-scan", "tests/submission/*.test.mjs"]]) {
    console.log(`Verifying ${name}...`);
    const result = await run(["--test", "--test-concurrency=1", "--test-reporter=tap", pattern]);
    const count = key => Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(result.stdout)?.[1] ?? NaN);
    const counts = { name, passed: count("pass"), failed: count("fail"), skipped: count("skipped"), cancelled: count("cancelled") };
    const complete = [counts.passed, counts.failed, counts.skipped, counts.cancelled].every(Number.isSafeInteger);
    const requiredNativeTests = [
      "native Windows owner-only ACL verified before and after synthetic key provisioning",
      "native parent preflight accepts a secure parent without creating the target",
      "real Windows helper rejects inherited ACLs and does not repair existing directories",
      "native Prepare still refuses an otherwise-owned parent with unauthorized write access",
      "native Verify still refuses non-owner read permission on empty protected storage",
    ];
    const nativeRequired = name === "approval-setup-including-native-ACL";
    const nativeVerified = !nativeRequired || process.platform === "win32" && requiredNativeTests.every(label =>
      result.stdout.split(/\r?\n/).some(line => /^ok \d+ - /.test(line) && line.includes(` - ${label}`) && !line.includes("# SKIP")));
    const failureCodes = ["EBUSY", "EPERM", "EACCES", "ETIMEDOUT", "ERR_ASSERTION", "POWERSHELL_SCRIPT_POLICY_BLOCKED", "KEY_STORAGE_NOT_VERIFIED"].filter(code => result.stdout.includes(code));
    const failedTestNumbers = [...result.stdout.matchAll(/^not ok (\d+) -/gm)].map(match => Number(match[1]));
    report.suites.push({ ...counts, status: result.code === 0 && complete && counts.failed === 0 && counts.cancelled === 0 && nativeVerified ? "PASS" : "FAILED_OR_BLOCKED",
      ...(nativeRequired ? { nativeAcl: nativeVerified ? "VERIFIED_SYNTHETIC_FIXTURES" : "BLOCKED_OR_UNVERIFIED" } : {}),
      ...(failureCodes.length || failedTestNumbers.length ? { failureCodes, failedTestNumbers } : {}) });
    console.log(JSON.stringify(report.suites.at(-1)));
    if (report.suites.at(-1).status !== "PASS") throw new Error("Suite did not pass; do not count unavailable cases as successful");
  }
  const syntaxFiles = [];
  async function syntaxFilesIn(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      if (entry.isDirectory()) await syntaxFilesIn(join(directory, entry.name));
      else if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) syntaxFiles.push(join(directory, entry.name));
    }
  }
  for (const name of ["src", "scripts", "switch-bridge", "tests"]) await syntaxFilesIn(join(root, name));
  for (const file of syntaxFiles) if ((await run(["--check", file])).code !== 0) throw new Error("JavaScript syntax failed");
  report.checks.push({ name: "javascript-syntax", status: "PASS", files: syntaxFiles.length });
  if ((await run(["scripts/smoke-test.js"])).code !== 0) throw new Error("HTTP smoke failed");
  report.checks.push({ name: "real-entrypoint-health-CRUD-error-recovery-smoke", status: "PASS" });
  const reproduction = await runReproduction({ directory: workingDirectory });
  if (reproduction.exitCode !== 0) throw new Error("Real reproduction did not match known bug");
  report.httpEvidence = { file: directory + "/phase9-bug-evidence.json", baselineStatus: reproduction.report.verifiedObservations.baseline.observed.status,
    cases: reproduction.report.verifiedObservations.scenarios.map(s => ({ id: s.id, expected: s.expected.status, observed: s.observed.status })), temporaryServerClosed: reproduction.report.verifiedObservations.temporaryServerClosed };
  const regression = await run(["--test", "--test-reporter=tap", "tests/regression/empty-body.test.js"]);
  if (regression.code !== 1 || !/^# fail 1$/m.test(regression.stdout) || !/INTERNAL_ERROR/.test(regression.stdout) || !/VALIDATION_ERROR/.test(regression.stdout)) throw new Error("Intentional regression failed for an unverified reason");
  report.intentionalRegression = { status: "EXPECTED_FAILURE", failed: 1, reason: "Both empty variants return 500 INTERNAL_ERROR instead of 400 VALIDATION_ERROR; confirmed by independent real HTTP evidence" };
  report.readiness = await checkApprovalReadiness();
  report.patchExecutionEnabled = report.readiness.patchExecutionEnabled;
  if (report.readiness.proposalIntegrity !== "PASS" || report.readiness.patchExecutionEnabled || !report.readiness.executionEntryPointRefused ||
      ["INVALID", "UNREADABLE"].includes(report.readiness.enrollmentConfiguration) ||
      !["UNVERIFIED", "DISABLED"].includes(report.readiness.switchIdentity)) throw new Error("Review/execution boundary failed");
  for (const [file, value] of before) if (hash(await readFile(await checkedPath(root, file))) !== value) throw new Error("Source or historical report changed");
  report.historicalEvidenceAndSourceUnchanged = true;
  report.submissionScan = await checkSubmission();
  if (report.submissionScan.findings.length) throw new Error("Submission surface needs security review");
  report.status = "LOCAL_AUTOMATED_CHECKS_PASSED_MANUAL_LIVE_CHECKS_PENDING";
} catch {
  report.status = "FAILED_OR_BLOCKED";
  process.exitCode = 1;
  console.error("Local verification stopped. Inspect suite status and run that suite directly; no blocked case is claimed as passed. No raw subprocess errors or secrets printed.");
} finally {
  report.finishedAt = new Date().toISOString();
  report.totals = report.suites.reduce((total, suite) => ({ passed: total.passed + (suite.passed || 0), failed: total.failed + (suite.failed || 0), skipped: total.skipped + (suite.skipped || 0), cancelled: total.cancelled + (suite.cancelled || 0) }), { passed: 0, failed: 0, skipped: 0, cancelled: 0 });
  if (destination) {
    try { await writeFile(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log(`Verification report: ${destination.slice(root.length).replaceAll("\\", "/")}`); }
    catch { process.exitCode = 1; console.error("Verification report could not be saved; no completion claim."); }
  }
  console.log(JSON.stringify({ status: report.status, totals: report.totals, patchExecutionEnabled: report.patchExecutionEnabled, liveMattermostVerifiedThisRun: false }));
}
