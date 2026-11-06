import test from "node:test";
import assert from "node:assert/strict";
import { readdir, copyFile, mkdir, writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { approvalFixture } from "./phase11-fixture.mjs";
import { projectDir } from "../codex-runner.mjs";

const execute = promisify(execFile);
async function cliFixture(t) {
  const h = await approvalFixture(t);
  await mkdir(join(h.root, "switch-bridge"));
  for (const file of await readdir(join(projectDir, "switch-bridge"))) if (file.endsWith(".mjs")) await copyFile(join(projectDir, "switch-bridge", file), join(h.root, "switch-bridge", file));
  for (const file of ["approval-local.mjs", "sign-approval.mjs"]) await copyFile(join(projectDir, "scripts", file), join(h.root, "scripts", file));
  const keyDirectory = await mkdtemp(join(projectDir, ".bugbridge-test-signing-key-"));
  t.after(async () => {
    assert.ok(relative(projectDir, keyDirectory).startsWith(".bugbridge-test-signing-key-"));
    await rm(keyDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const keyPath = join(keyDirectory, "synthetic-private-key.pem");
  await writeFile(keyPath, h.keys[0].privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const run = async (file, args = []) => {
    try { const out = await execute(process.execPath, [join("scripts", file), ...args], { cwd: h.root, timeout: 5000, windowsHide: true, shell: false }); return { code: 0, output: out.stdout + out.stderr }; }
    catch (error) { return { code: error.code, output: error.stdout + error.stderr }; }
  };
  const prepareAndSign = async (action, challenge) => {
    const prepared = await run("approval-local.mjs", ["prepare", action, "INC-001", h.config.authorizedHumans[0].senderId, ...(challenge ? [challenge] : [])]);
    assert.equal(prepared.code, 0, prepared.output);
    const signed = await run("sign-approval.mjs", [keyPath]); assert.equal(signed.code, 0, signed.output);
  };
  return { ...h, keyPath, run, prepareAndSign };
}

test("operator-only CLI signs/records synthetic request and approval without any application patch", { timeout: 15_000 }, async t => {
  const h = await cliFixture(t);
  const before = await readFile(join(h.root, "src/controllers/tasks.controller.js"));
  await h.prepareAndSign("REQUEST");
  const requested = await h.run("approval-local.mjs", ["submit"]);
  assert.equal(requested.code, 0, requested.output);
  const challenge = /APPROVE BUGBRIDGE INC-001 ([A-Za-z0-9_-]{43})/.exec(requested.output)[1];
  await h.prepareAndSign("APPROVE", challenge);
  const approved = await h.run("approval-local.mjs", ["submit"]);
  assert.equal(approved.code, 0, approved.output); assert.match(approved.output, /APPROVED/);
  assert.deepEqual(await readFile(join(h.root, "src/controllers/tasks.controller.js")), before);
  assert.equal((await h.readState()).records[0].status, "APPROVED");
  const files = await readdir(join(h.root, ".bugbridge-private"));
  assert.deepEqual(files.sort(), ["approval-config.json", "approvals"]);
  for (const text of [approved.output, JSON.stringify(await h.readState())]) {
    assert.doesNotMatch(text, /PRIVATE KEY/); assert.equal(text.includes(challenge), false);
  }
});

test("two independent CLI processes cannot consume the same signed decision twice", { timeout: 15_000 }, async t => {
  const h = await cliFixture(t); await h.prepareAndSign("REQUEST");
  const requested = await h.run("approval-local.mjs", ["submit"]); assert.equal(requested.code, 0);
  const challenge = /APPROVE BUGBRIDGE INC-001 ([A-Za-z0-9_-]{43})/.exec(requested.output)[1];
  await h.prepareAndSign("APPROVE", challenge);
  const responses = await Promise.all([h.run("approval-local.mjs", ["submit"]), h.run("approval-local.mjs", ["submit"])]);
  assert.equal(responses.filter(response => response.code === 0).length, 1);
  assert.equal((await h.readState()).revision, 2);
  assert.equal((await h.readState()).records[0].status, "APPROVED");
});

test("signer refuses an in-project key and arbitrary CLI input never executes chat code", { timeout: 10_000 }, async t => {
  const h = await cliFixture(t);
  const inProject = join(h.root, "synthetic-key.pem"); await copyFile(h.keyPath, inProject);
  assert.equal((await h.run("sign-approval.mjs", [inProject])).code, 1);
  assert.equal((await h.run("approval-local.mjs", ["prepare", "REQUEST; fix", "INC-001", h.config.authorizedHumans[0].senderId])).code, 1);
  assert.equal((await h.run("approval-local.mjs", ["--help"])).code, 0);
  await assert.rejects(readFile(h.statePath), { code: "ENOENT" });
});
