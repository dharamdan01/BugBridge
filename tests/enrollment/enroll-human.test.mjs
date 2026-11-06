import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { approvalFixture } from "../../switch-bridge/test/phase11-fixture.mjs";
import { projectDir } from "../../switch-bridge/codex-runner.mjs";
import { validateApprovalConfig } from "../../switch-bridge/approval-protocol.mjs";

const execute = promisify(execFile);
const powershell = join(process.env.SystemRoot || process.env.SYSTEMROOT, "System32/WindowsPowerShell/v1.0/powershell.exe");
const secret = "SYNTHETIC_ENROLLMENT_SECRET_2ab4";
const osKeys = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "PSEXECUTIONPOLICYPREFERENCE"]);

async function fixture(t) {
  const h = await approvalFixture({ after: cleanup => t.after(async () => {
    for (let attempt = 0; ; attempt++) {
      try { await cleanup(); return; } catch (error) {
        if (attempt >= 5 || !["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }) });
  h.config.authorizedHumans = [h.config.authorizedHumans[0]];
  const configPath = join(h.root, ".bugbridge-private/approval-config.json");
  const { rm } = await import("node:fs/promises");
  await rm(configPath); // Temporary synthetic enrollment only; never the real config.
  await mkdir(join(h.root, "switch-bridge"));
  for (const file of await readdir(join(projectDir, "switch-bridge"))) if (file.endsWith(".mjs")) await copyFile(join(projectDir, "switch-bridge", file), join(h.root, "switch-bridge", file));
  for (const file of ["enroll-approval-human.ps1", "enrollment-config.mjs", "check-approval-readiness.mjs"]) await copyFile(join(projectDir, "scripts", file), join(h.root, "scripts", file));
  const checkerPath = join(h.root, "scripts/check-approval-acl.ps1");
  // Explicit mocked ACL provider in the isolated copy. Production checker,
  // real ACLs and production enrollment are never changed by these tests.
  const setChecker = text => writeFile(checkerPath, text, "utf8");
  await setChecker('Write-Output \'{"status":"VERIFIED","modified":false}\'\nexit 0\n');
  const publicPath = join(h.root, "synthetic public key.pem");
  await writeFile(publicPath, h.config.authorizedHumans[0].publicKey);
  const defaults = [h.config.authorizedHumans[0].senderId, h.config.agentSenderIds[0], publicPath, "ENROLL AUTHORIZED HUMAN"];
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => osKeys.has(key.toUpperCase()))),
    SWITCH_ROOM_ID: h.config.roomId, SWITCH_AGENT_ID: h.config.agentId, SWITCH_AGENT_KEY: secret };
  const run = async ({ answers = defaults, missingEnv, interactiveMock = true, fromParent = false, staleExit = 0 } = {}) => {
    const valuesPath = join(h.root, "test-input.json");
    await writeFile(valuesPath, JSON.stringify(answers));
    const wrapper = join(h.root, "run-test.ps1");
    await writeFile(wrapper, `$global:LASTEXITCODE=${staleExit}\n` + (interactiveMock ? `
$global:EnrollmentInputs = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'test-input.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$global:EnrollmentInputIndex = 0
function global:Read-Host {
    param($Prompt)
    [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'prompt-count.txt'), [string]($global:EnrollmentInputIndex + 1))
    $value = $global:EnrollmentInputs[$global:EnrollmentInputIndex]
    $global:EnrollmentInputIndex++
    return $value
}
` : "") + `
& (Join-Path $PSScriptRoot 'scripts/enroll-approval-human.ps1')
$result = $LASTEXITCODE
Write-Output 'ENROLLMENT_SCRIPT_RETURNED'
exit $result
`);
    const childEnv = { ...env }; if (missingEnv) delete childEnv[missingEnv];
    try {
      const output = await execute(powershell, ["-NoProfile", "-NonInteractive", "-File", wrapper], { cwd: fromParent ? projectDir : h.root, env: childEnv, shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 200_000 });
      return { code: 0, text: output.stdout + output.stderr };
    } catch (error) { return { code: error.code, text: error.stdout + error.stderr }; }
  };
  const helper = async (operation, value) => {
    const promise = execute(process.execPath, [join(h.root, "scripts/enrollment-config.mjs"), operation], { cwd: h.root, env, shell: false, windowsHide: true, timeout: 30_000 });
    promise.child.stdin.end(JSON.stringify(value));
    try { const output = await promise; return { code: 0, data: JSON.parse(output.stdout), text: output.stdout + output.stderr }; }
    catch (error) { return { code: error.code, data: JSON.parse(error.stdout), text: error.stdout + error.stderr }; }
  };
  const absent = async () => { await assert.rejects(readFile(configPath), { code: "ENOENT" }); };
  return { ...h, configPath, publicPath, defaults, env, setChecker, run, helper, absent };
}

test("ACL VERIFIED returns to prompts; valid confirmed PowerShell enrollment creates a readiness-VALID config", { timeout: 35_000 }, async t => {
  const h = await fixture(t);
  const history = join(h.root, ".bugbridge-private/historical-state.txt"); await writeFile(history, "history must survive");
  const beforeMode = (await stat(join(h.root, ".bugbridge-private"))).mode;
  const response = await h.run({ staleExit: 37 });
  assert.equal(response.code, 0, response.text);
  assert.match(response.text, /ACL VERIFIED.*Continuing/);
  assert.match(response.text, /SAVED:.*approval-config.json; enrollmentConfiguration: VALID/);
  assert.match(response.text, /ENROLLMENT_SCRIPT_RETURNED/);
  const config = validateApprovalConfig(JSON.parse(await readFile(h.configPath, "utf8")));
  assert.equal(config.switchIdentity.enabled, false);
  assert.equal(config.authorizedHumans[0].senderId, h.defaults[0]);
  assert.equal(await readFile(join(h.root, "prompt-count.txt"), "utf8"), "4");
  assert.equal(await readFile(history, "utf8"), "history must survive");
  assert.equal((await stat(join(h.root, ".bugbridge-private"))).mode, beforeMode);
  assert.equal((await readdir(join(h.root, ".bugbridge-private"))).some(name => name.endsWith(".pending")), false);
  assert.equal(response.text.includes(secret), false); assert.equal(response.text.includes(h.config.authorizedHumans[0].publicKey), false);
});

test("failed ACL blocks every prompt and never creates enrollment", async t => {
  const h = await fixture(t); await h.setChecker('Write-Output \'{"status":"PENDING","modified":false}\'\nexit 1\n');
  const result = await h.run(); assert.equal(result.code, 1); assert.match(result.text, /ACL_FAILED/);
  await h.absent(); await assert.rejects(readFile(join(h.root, "prompt-count.txt")), { code: "ENOENT" });
});

test("Windows PowerShell stdin preserves a supplied opaque Unicode participant ID exactly", { timeout: 35_000 }, async t => {
  const h = await fixture(t), answers = [...h.defaults];
  answers[0] = "@switch-user-reviewer-\u03b1:server";
  const response = await h.run({ answers });
  assert.equal(response.code, 0, response.text);
  assert.equal(JSON.parse(await readFile(h.configPath, "utf8")).authorizedHumans[0].senderId, answers[0]);
});

test("a zero-exit ACL helper cannot authorize an unverified or modified ACL report", async t => {
  const h = await fixture(t); await h.setChecker('Write-Output \'{"status":"VERIFIED","modified":true}\'\nexit 0\n');
  assert.match((await h.run()).text, /ACL_FAILED/); await h.absent();
});

for (const field of ["SWITCH_AGENT_ID", "SWITCH_ROOM_ID"]) test(`missing ${field} explains the exact environment gate`, async t => {
  const h = await fixture(t), result = await h.run({ missingEnv: field });
  assert.equal(result.code, 1); assert.match(result.text, /SWITCH_IDS_MISSING/); assert.match(result.text, /existing Switch-configured terminal/);
  await h.absent();
});

for (const [index, value, code] of [[0, "", "HUMAN_ID_REQUIRED"], [1, "", "AGENT_PARTICIPANT_REQUIRED"],
  [2, "", "PUBLIC_KEY_REQUIRED"], [2, "Z:\\missing-enrollment-test-public-key.pem", "PUBLIC_KEY_NOT_FOUND"],
  [3, "NO", "CONFIRMATION_DECLINED"], [3, "", "CONFIRMATION_REQUIRED"]]) {
  test(`required human input fails safely: ${code}`, async t => {
    const h = await fixture(t), answers = [...h.defaults]; answers[index] = value;
    const result = await h.run({ answers }); assert.equal(result.code, 1); assert.match(result.text, new RegExp(code)); await h.absent();
  });
}

test("noninteractive Read-Host failure is actionable rather than silently swallowed", async t => {
  const h = await fixture(t), result = await h.run({ interactiveMock: false });
  assert.equal(result.code, 1); assert.match(result.text, /INPUT_UNAVAILABLE/); assert.match(result.text, /normal interactive PowerShell/); await h.absent();
});

for (const kind of ["malformed", "non-ed25519", "private-key"]) test(`invalid key rejected without printing material: ${kind}`, async t => {
  const h = await fixture(t);
  let key = `-----BEGIN PUBLIC KEY-----\n${secret}\n-----END PUBLIC KEY-----`;
  if (kind === "non-ed25519") key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" });
  if (kind === "private-key") key = `-----BEGIN PRIVATE KEY-----\n${secret}\n-----END PRIVATE KEY-----`;
  await writeFile(h.publicPath, key);
  const result = await h.run(); assert.equal(result.code, 1); assert.match(result.text, /PUBLIC_KEY_INVALID/);
  assert.equal(result.text.includes(secret), false); assert.equal(result.text.includes(key), false); await h.absent();
});

test("an agent participant cannot be enrolled as the human", async t => {
  const h = await fixture(t), answers = [...h.defaults]; answers[0] = h.config.agentSenderIds[0];
  const result = await h.run({ answers }); assert.equal(result.code, 1); assert.match(result.text, /CONFIG_INVALID/); await h.absent();
});

test("existing enrollment is never overwritten and no prompts are consumed", async t => {
  const h = await fixture(t), original = JSON.stringify(h.config); await writeFile(h.configPath, original);
  const result = await h.run(); assert.equal(result.code, 1); assert.match(result.text, /CONFIG_EXISTS/);
  assert.equal(await readFile(h.configPath, "utf8"), original);
});

test("wrong working directory prints exact corrective guidance", async t => {
  const h = await fixture(t), result = await h.run({ fromParent: true });
  assert.equal(result.code, 1); assert.match(result.text, /WRONG_DIRECTORY/); assert.match(result.text, /Set-Location/); await h.absent();
});

test("writer refuses absent confirmation and mismatched Switch scope", async t => {
  const h = await fixture(t);
  assert.equal((await h.helper("write-confirmed", { config: h.config, confirmation: "" })).data.code, "CONFIRMATION_REQUIRED");
  const wrong = structuredClone(h.config); wrong.roomId = "other-room";
  assert.equal((await h.helper("write-confirmed", { config: wrong, confirmation: "ENROLL AUTHORIZED HUMAN" })).data.code, "SWITCH_IDS_MISSING");
  await h.absent();
});

test("staged-file ACL failure leaves no partial final configuration or staging file", async t => {
  const h = await fixture(t); await h.setChecker(`
$pending = @(Get-ChildItem -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) '.bugbridge-private') -Filter '*.pending')
if ($pending.Count -gt 0) { Write-Output '{"status":"PENDING","modified":false}'; exit 1 }
Write-Output '{"status":"VERIFIED","modified":false}'
exit 0
`);
  const result = await h.run(); assert.equal(result.code, 1); assert.match(result.text, /ACL_FAILED/); await h.absent();
  assert.equal((await readdir(join(h.root, ".bugbridge-private"))).some(name => name.endsWith(".pending")), false);
});

test("atomic concurrent confirmed writers publish exactly one complete config and never clobber", { timeout: 35_000 }, async t => {
  const h = await fixture(t), input = { config: h.config, confirmation: "ENROLL AUTHORIZED HUMAN" };
  const results = await Promise.all([h.helper("write-confirmed", input), h.helper("write-confirmed", input)]);
  assert.equal(results.filter(result => result.code === 0).length, 1);
  assert.equal(results.filter(result => result.data.code === "CONFIG_EXISTS").length, 1);
  assert.deepEqual(JSON.parse(await readFile(h.configPath, "utf8")), h.config);
});

test("file publication errors produce an actionable refusal without raw exceptions or secret values", async t => {
  const h = await fixture(t);
  await mkdir(h.configPath);
  const result = await h.helper("write-confirmed", { config: h.config, confirmation: "ENROLL AUTHORIZED HUMAN" });
  assert.equal(result.code, 1); assert.match(result.text, /WRITE_FAILED|CONFIG_EXISTS/); assert.equal(result.text.includes(secret), false);
});
