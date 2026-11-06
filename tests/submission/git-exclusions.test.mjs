import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("actual Git exclusions protect local secrets/database artifacts while retaining reproducible public evidence", async t => {
  const parent = tmpdir(), directory = await mkdtemp(join(parent, "bugbridge-git-ignore-"));
  t.after(async () => {
    assert.match(relative(parent, directory), /^bugbridge-git-ignore-[^\\/]+$/);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  await copyFile(new URL("../../.gitignore", import.meta.url), join(directory, ".gitignore"));
  const execute = promisify(execFile);
  const options = { shell: false, windowsHide: true, timeout: 10_000 };
  // Disposable metadata only; empty template, no remotes, no global settings,
  // no production Git initialization and no real secret/key files are created.
  await execute("git", ["-c", "init.templateDir=", "-C", directory, "init", "--quiet"], options);
  const excluded = [".env", ".env.local", "switch-bridge/.env", ".bugbridge-private/approval-config.json",
    ".bugbridge-private/approvals/INC-001.json", ".bugbridge-test-fixture/key.pem", ".bugbridge-codex-fixture/answer.txt",
    "keys/operator.pem", "keys/operator.key", "keys/operator.pfx", "keys/operator.p12", "credential.dpapi", "credential.clixml",
    "credential.pscredential", "credentials.json", "auth.json", "debug.log", "capture.har", "demo-captures/screen.png",
    "database-exports/users.json", "reports/private/account.json", "records.db", "records.sqlite", "records.sqlite3", "database.dump", "database.backup",
    "approval-config.json", "unsigned-intent.json", "signed-intent.json", ".npmrc", ".aws/credentials", ".docker/config.json", ".codex/auth.json",
    "node_modules/dependency/index.js", "switch-bridge/node_modules/ws/index.js",
    "keys/operator.p8", "database.bak", "source.js.old", "notes.txt~",
    "nested/.codex/auth.toml", "nested/.aws/credentials", "nested/.docker/config.json",
    "nested/.ssh/id_ed25519", "nested/.agents/settings.json",
    "recording.mp4", "recording.mov", "recording.mkv", "recording.webm", "recording.avi",
    "recording.wav", "recording.mp3", "recording.m4a", "recording.aac", "recording.flac", "recording.ogg",
    "screenshot.png", "screenshot.jpg", "screenshot.jpeg", "archive.zip", "archive.7z", "archive.tar", "archive.tar.gz",
    "reports/raw/incident.json", "reports/raw-incident.json", "reports/raw-session.txt",
    "reports/private/publication-audit/inventory.json", "nested/.bugbridge-private/approvals/INC-001.json"];
  const retained = ["README.md", "package.json", "package-lock.json", ".gitignore", "src/controllers/tasks.controller.js",
    "switch-bridge/package-lock.json", "scripts/switch-identity-mapping.sql", "docs/architecture.md", "docs/submission-checklist.md",
    "reports/phase9-bug-evidence.json", "reports/incidents/INC-001-triage.md", "reports/history/example/manifest.json",
    "fixtures/bug-reports.json", "docs/examples/incident-report.sample.json", "switch-bridge/agent-runtime.mjs",
    "tests/regression/empty-body.test.js", "scripts/check-submission.mjs", "reports/local-demo/example/verification.json"];
  const { stdout } = await execute("git", ["-C", directory, "check-ignore", "--no-index", "--", ...excluded, ...retained], options);
  assert.deepEqual(new Set(stdout.trim().split(/\r?\n/)), new Set(excluded));
});
