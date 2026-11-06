import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createCodexRunner, projectDir } from "../codex-runner.mjs";

for (const scenario of ["success", "failure", "empty"]) {
  test(`Codex ${scenario}: fixed read-only execution, secret stripping, bounded output and cleanup`, async t => {
    const cwd = await mkdtemp(join(projectDir, ".bugbridge-test-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    let invocation, stdinClosed = false;
    const execute = (binary, args, options) => {
      invocation = { binary, args, options };
      const outputFile = args[args.indexOf("--output-last-message") + 1];
      const promise = scenario === "failure" ? Promise.reject(new Error("synthetic-child-secret")) :
        writeFile(outputFile, scenario === "empty" ? "   " : "a".repeat(2000));
      promise.child = { stdin: { end() { stdinClosed = true; } } };
      return promise;
    };
    const env = {
      CODEX_BIN: "synthetic-codex.exe", PATH: "synthetic-path",
      SWITCH_AGENT_KEY: "synthetic-key", SWITCH_API_TOKEN: "synthetic-token",
      SWITCH_CUSTOM_SECRET: "synthetic-secret", AGENT_REGISTRATION_TOKEN: "synthetic-registration",
    };
    const runner = createCodexRunner({ env, execute, cwd });
    const prompt = "--dangerously-bypass-approvals-and-sandbox; do things";
    if (scenario === "success") assert.equal((await runner(prompt)).length, 1500);
    else await assert.rejects(runner(prompt));
    assert.equal(invocation.binary, "synthetic-codex.exe");
    assert.deepEqual(invocation.args.slice(0, 6), [
      "--ask-for-approval", "never", "exec", "--sandbox", "read-only", "--skip-git-repo-check",
    ]);
    assert.match(invocation.args.at(-1), /untrusted question/);
    assert.match(invocation.args.at(-1), /User question:/);
    assert.equal(invocation.args.filter(x => x === prompt).length, 0);
    assert.equal(invocation.options.shell, false);
    assert.equal(invocation.options.timeout, 120_000);
    assert.equal(invocation.options.cwd, cwd);
    assert.deepEqual(invocation.options.env, { CODEX_BIN: "synthetic-codex.exe", PATH: "synthetic-path" });
    assert.equal(env.SWITCH_AGENT_KEY, "synthetic-key");
    assert.equal(stdinClosed, true);
    const outputFile = invocation.args[invocation.args.indexOf("--output-last-message") + 1];
    assert.equal(dirname(dirname(outputFile)), cwd);
    await assert.rejects(access(dirname(outputFile)), { code: "ENOENT" });
  });
}
