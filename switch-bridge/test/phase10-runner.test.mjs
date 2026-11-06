import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir, access } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCodexRunner, projectDir, safeCodexEnvironment, redactPrivateText } from "../codex-runner.mjs";
import { analysisSchema } from "../triage-contract.mjs";

async function temporaryRoot(t) {
  const root = await mkdtemp(join(projectDir, ".bugbridge-test-runner-"));
  t.after(async () => {
    assert.ok(relative(projectDir, root).startsWith(".bugbridge-test-runner-"));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test("triage reuses read-only runner with stdin EOF, disabled tools/integrations and no secret environment", async t => {
  const cwd = await temporaryRoot(t);
  const env = { CODEX_BIN: "synthetic.exe", PATH: "synthetic-path", USERPROFILE: "synthetic-user",
    SWITCH_AGENT_KEY: "private-agent", CUSTOM_PASSWORD: "private-password", OPENAI_API_KEY: "private-key",
    GITHUB_TOKEN: "private-token", DATABASE_URL: "private-url", NODE_OPTIONS: "private-options" };
  let invocation, input, ended = false;
  const prompt = "Analyze only approved evidence. untrusted question; $(do-bad) & fix";
  const runner = createCodexRunner({ cwd, env, execute: (binary, args, options) => {
    invocation = { binary, args, options };
    const promise = writeFile(args[args.indexOf("--output-last-message") + 1], '{"synthetic":"assessment"}');
    promise.child = { stdin: { end(value) { input = value; ended = true; }, on() {} } };
    return promise;
  } });
  assert.equal(await runner(prompt, { mode: "triage", schema: analysisSchema }), '{"synthetic":"assessment"}');
  assert.equal(input, prompt); assert.equal(ended, true);
  assert.equal(invocation.args.at(-1), "-");
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.killSignal, "SIGKILL");
  assert.equal(invocation.options.timeout, 120_000);
  assert.equal(invocation.args[invocation.args.indexOf("--sandbox") + 1], "read-only");
  assert.equal(invocation.args[invocation.args.indexOf("--ask-for-approval") + 1], "never");
  for (const arg of ["--ignore-user-config", "--ignore-rules", "--strict-config", "--ephemeral",
    "features.shell_tool=false", "features.view_image=false", "features.apps=false", "features.code_mode.enabled=false",
    "features.hooks=false", "agents.enabled=false", "features.multi_agent=false", "mcp_servers={}", 'web_search="disabled"', "project_doc_max_bytes=0", "plugins._default.enabled=false"]) {
    assert.ok(invocation.args.includes(arg), arg);
  }
  assert.deepEqual(invocation.options.env, { CODEX_BIN: "synthetic.exe", PATH: "synthetic-path", USERPROFILE: "synthetic-user" });
  assert.equal(dirname(invocation.options.cwd), cwd);
  await assert.rejects(access(invocation.options.cwd), { code: "ENOENT" });
  assert.equal(env.OPENAI_API_KEY, "private-key");
});

test("child environment allowlist excludes unrelated secrets and runner redacts private ASK answers", async t => {
  const cwd = await temporaryRoot(t);
  const env = { CODEX_BIN: "synthetic.exe", PATH: "path", AWS_SECRET_ACCESS_KEY: "synthetic-aws-value", SWITCH_AGENT_KEY: "synthetic-agent-key" };
  assert.deepEqual(safeCodexEnvironment(env), { CODEX_BIN: "synthetic.exe", PATH: "path" });
  const runner = createCodexRunner({ cwd, env, execute: (_binary, args) => {
    const promise = writeFile(args[args.indexOf("--output-last-message") + 1], "synthetic-aws-value synthetic-agent-key Bearer synthetic-bearer sk-proj-private person@example.com C:\\Users\\private\\secret");
    promise.child = { stdin: { end() {} } };
    return promise;
  } });
  const result = await runner("safe question");
  assert.doesNotMatch(result, /synthetic-|person@|sk-proj-|C:\\Users/);
  assert.match(result, /REDACTED/);
  assert.equal(redactPrivateText("fine text", env), "fine text");
});

for (const kind of ["reject", "empty", "oversize", "missing-schema", "oversize-input"]) {
  test(`triage runner cleanup on ${kind}`, async t => {
    const cwd = await temporaryRoot(t);
    const runner = createCodexRunner({ cwd, env: { CODEX_BIN: "synthetic.exe" }, execute: (_binary, args) => {
      const promise = kind === "reject" ? Promise.reject(new Error("private-child-error")) :
        writeFile(args[args.indexOf("--output-last-message") + 1], kind === "empty" ? " " : "x".repeat(17_000));
      promise.child = { stdin: { end() {} } };
      return promise;
    } });
    await assert.rejects(runner(kind === "oversize-input" ? "x".repeat(49_000) : "analyze", { mode: "triage", schema: kind === "missing-schema" ? undefined : analysisSchema }));
    assert.deepEqual(await readdir(cwd), []);
  });
}

test("real child receives EOF, times out, is killed and temporary artifacts are removed", { timeout: 5000 }, async t => {
  const cwd = await temporaryRoot(t);
  const execute = promisify(execFile);
  let child;
  // Only the injected test adapter reduces the timeout and substitutes Node for
  // Codex. No model, external service or live Switch connection is used.
  const runner = createCodexRunner({ cwd, env: {}, execute: (_binary, _args, options) => {
    const original = execute(process.execPath, ["-e", "process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write('EOF_SEEN'); setInterval(() => {}, 1000); });"], { ...options, timeout: 400 });
    child = original.child;
    const promise = original.catch(error => { assert.equal(error.stdout, "EOF_SEEN"); throw error; });
    promise.child = child;
    return promise;
  } });
  await assert.rejects(runner("question"));
  assert.equal(child.killed, true);
  assert.deepEqual(await readdir(cwd), []);
});

test("schema written for Codex is exactly the application-owned contract", async t => {
  const cwd = await temporaryRoot(t);
  const runner = createCodexRunner({ cwd, env: {}, execute: (_binary, args) => {
    const promise = (async () => {
      assert.deepEqual(JSON.parse(await readFile(args[args.indexOf("--output-schema") + 1], "utf8")), analysisSchema);
      await writeFile(args[args.indexOf("--output-last-message") + 1], "{}");
    })();
    promise.child = { stdin: { end() {} } };
    return promise;
  } });
  await runner("analyze", { mode: "triage", schema: analysisSchema });
});

test("stdin setup failure kills and awaits the child before cleanup", async t => {
  const cwd = await temporaryRoot(t);
  let killed = false;
  const runner = createCodexRunner({ cwd, env: {}, execute: () => {
    let finish;
    const promise = new Promise(resolve => { finish = resolve; });
    promise.child = {
      stdin: { end() { throw new Error("private-stdin-error"); } },
      kill(signal) { assert.equal(signal, "SIGKILL"); killed = true; finish(); },
    };
    return promise;
  } });
  await assert.rejects(runner("analyze", { mode: "triage", schema: analysisSchema }), /Codex execution failed/);
  assert.equal(killed, true);
  assert.deepEqual(await readdir(cwd), []);
});
