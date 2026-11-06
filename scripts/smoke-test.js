import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// Exercise the actual CLI entrypoint on a private ephemeral port; no Switch or AI.
const child = spawn(process.execPath, ["src/server.js"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: { ...process.env, HOST: "127.0.0.1", PORT: "0" },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
const exited = once(child, "exit");
try {
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("API startup timed out")), 5000);
    timer.unref();
    let output = "";
    child.stdout.on("data", chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("API exited before startup")); });
  });
  async function request(path, options = {}) {
    const response = await fetch(origin + path, { ...options, signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: await response.json() };
  }
  const jsonOptions = (method, data) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  assert.deepEqual(await request("/health"), { status: 200, body: { success: true, data: { status: "ok" } } });
  const created = await request("/api/tasks", jsonOptions("POST", { title: "Smoke test" }));
  assert.equal(created.status, 201);
  const taskPath = `/api/tasks/${created.body.data.id}`;
  assert.equal((await request("/api/tasks")).body.data.length, 1);
  assert.equal((await request(taskPath)).body.data.title, "Smoke test");
  assert.equal((await request(taskPath, jsonOptions("PATCH", { status: "done" }))).body.data.status, "done");
  assert.equal((await request(taskPath, { method: "DELETE" })).status, 200);
  assert.equal((await request(taskPath)).status, 404);
  const bug = await request("/api/tasks", jsonOptions("POST", {}));
  assert.equal(bug.status, 500, "BUG-001 must remain reproducible in Phase 8");
  assert.equal(bug.body.error.code, "INTERNAL_ERROR");
  // The failed create must leave the server healthy and storage empty.
  assert.equal((await request("/health")).status, 200);
  assert.deepEqual((await request("/api/tasks")).body.data, []);
  console.log("API smoke passed: health, CRUD and recovery; BUG-001 reproduced as HTTP 500.");
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await exited;
}
