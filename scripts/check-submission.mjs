import { readdir, lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const releaseDirectories = new Set(["src", "scripts", "switch-bridge", "tests", "docs", "reports", "fixtures"]);
const excludedDirectory = name => ["node_modules", ".git", ".bugbridge-private", ".codex", ".aws", ".docker", "demo-captures", "database-exports"].includes(name) || /^\.bugbridge-(test|codex)-/.test(name);
const sensitiveName = name => /^\.env(?:\.|$)/i.test(name) || /\.(?:pem|key|p12|pfx|kdbx|har|log|pending|dpapi|clixml|pscredential|db|sqlite|sqlite3|dump|backup)$/i.test(name) || [".npmrc", "approval-config.json", "unsigned-intent.json", "signed-intent.json", "credentials.json", "auth.json"].includes(name);
const rules = [
  ["PRIVATE_KEY_MATERIAL", "CRITICAL", /^-----BEGIN (?:OPENSSH |RSA |EC |ENCRYPTED )?PRIVATE KEY-----\r?\n(?:[A-Za-z0-9+/=]{1,128}\r?\n)+-----END (?:OPENSSH |RSA |EC |ENCRYPTED )?PRIVATE KEY-----/m],
  ["TOKEN_PATTERN", "HIGH", /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["AUTH_HEADER_LITERAL", "HIGH", /\bBearer\s+(?!\[|synthetic|fixture|test)[A-Za-z0-9._~-]{24,}/i],
];

// Read-only release-surface scan. Never opens excluded private/config/key files,
// follows links, invokes Git/network/AI, prints matches or changes artifacts.
export async function checkSubmission(root = fileURLToPath(new URL("../", import.meta.url)), { env = process.env } = {}) {
  const base = await realpath(root), findings = [], personalData = [];
  let scannedFiles = 0, excludedEntries = 0;
  const environmentSecrets = Object.entries(env).filter(([key, value]) => /SECRET|TOKEN|PASSWORD|API_KEY|AGENT_KEY|CREDENTIAL/i.test(key) && typeof value === "string" && value.length >= 8).map(([, value]) => value);
  async function walk(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = prefix + entry.name, path = join(directory, entry.name);
      if (excludedDirectory(entry.name) || file === "reports/private" || sensitiveName(entry.name)) { excludedEntries++; continue; }
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) { findings.push({ file, category: "LINK_REQUIRES_REVIEW", severity: "HIGH" }); continue; }
      if (stat.isDirectory()) {
        if (prefix || releaseDirectories.has(entry.name)) await walk(path, file + "/");
        else findings.push({ file, category: "UNREVIEWED_DIRECTORY", severity: "MEDIUM" });
        continue;
      }
      if (!stat.isFile() || !/\.(?:md|json|mjs|js|ps1|sql)$/.test(entry.name) && entry.name !== ".gitignore") {
        findings.push({ file, category: "UNREVIEWED_ARTIFACT", severity: "MEDIUM" }); continue;
      }
      if (stat.size > 2_000_000) { findings.push({ file, category: "OVERSIZED_ARTIFACT", severity: "MEDIUM" }); continue; }
      const text = await readFile(path, "utf8"); scannedFiles++;
      for (const [category, severity, pattern] of rules) if (pattern.test(text)) findings.push({ file, category, severity });
      if (environmentSecrets.some(secret => text.includes(secret))) findings.push({ file, category: "CURRENT_ENV_SECRET_MATCH", severity: "CRITICAL" });
      // Record locations only, never personal values. Source test identities are
      // synthetic; all report/doc matches still need operator publication review.
      if (/^(?:reports|docs)\//.test(file) && /(?:[A-Z]:[\\/]Users[\\/][^\s\\/]+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|@switch-(?:user|agent)-[^\s"'`]+:[^\s"'`]+)/i.test(text)) personalData.push({ file, category: "PERSONAL_OR_PARTICIPANT_REFERENCE_REVIEW" });
    }
  }
  await walk(base);
  let gitHistory = "UNAVAILABLE_NO_GIT_METADATA";
  try { if ((await lstat(join(base, ".git"))).isDirectory() || (await lstat(join(base, ".git"))).isFile()) gitHistory = "NOT_SCANNED_OPERATOR_HISTORY_AUDIT_REQUIRED"; } catch (error) { if (error.code !== "ENOENT") gitHistory = "UNAVAILABLE_ACCESS"; }
  return { mode: "READ_ONLY_RELEASE_SURFACE", scannedFiles, excludedEntries, findings, personalData,
    gitHistory, status: findings.length ? "REVIEW_REQUIRED" : "NO_DETECTED_SECRET_PATTERNS", submissionApproved: false,
    limitations: "Heuristic current-file scan, not proof of absence. Excluded files were not opened. Git index/history, binary captures and third-party dependencies require separate review." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) { console.error("Usage: node scripts/check-submission.mjs"); process.exitCode = 1; }
  else checkSubmission().then(result => { console.log(JSON.stringify(result, null, 2)); if (result.findings.length) process.exitCode = 1; }).catch(() => { console.error("Submission scan unavailable. No security clearance claimed; no raw error or matched content displayed."); process.exitCode = 1; });
}
