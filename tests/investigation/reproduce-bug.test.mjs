import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app.js";
import {
  collectEvidence, classifyScenario, renderMarkdown, runReproduction, withTemporaryApi,
} from "../../scripts/reproduce-bug.mjs";

// Every observation below comes from real local HTTP; no fetch stubs or external services.
const report = await collectEvidence();
const observations = report.verifiedObservations;

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "bugbridge-phase9-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("valid baseline creates the expected task over HTTP", () => {
  const baseline = observations.baseline;
  assert.equal(baseline.passed, true);
  assert.equal(baseline.observed.status, 201);
  assert.equal(baseline.observed.success, true);
  assert.equal(baseline.observed.task.title, baseline.request.body.title);
  assert.equal(baseline.observed.task.description, "");
  assert.equal(baseline.observed.task.status, "todo");
  assert.match(baseline.observed.task.id, /^[\da-f-]{36}$/i);
  assert.equal(baseline.observed.locationMatchesTask, true);
});

for (const id of ["empty-json", "empty-body"]) {
  test(`${id} preserves and reproduces the known HTTP 500 bug`, () => {
    const scenario = observations.scenarios.find(item => item.id === id);
    assert.deepEqual(scenario.expected, { status: 400, errorCode: "VALIDATION_ERROR" });
    assert.equal(scenario.observed.status, 500);
    assert.equal(scenario.observed.success, false);
    assert.deepEqual(scenario.observed.error, {
      code: "INTERNAL_ERROR", message: "Internal server error.", detailsCount: 0,
    });
    assert.equal(scenario.matchesExpected, false);
    assert.equal(scenario.classification, "KNOWN_BUG_REPRODUCED");
    assert.equal(scenario.request.bodyBytes, id === "empty-json" ? 2 : 0);
    assert.deepEqual(scenario.request.body, id === "empty-json" ? {} : null);
    assert.deepEqual(scenario.request.headers, id === "empty-json" ? { "Content-Type": "application/json" } : {});
  });
}

test("report schema separates verified observations, analysis and recommendations", () => {
  assert.deepEqual(Object.keys(report).sort(), [
    "analysis", "bugId", "incidentId", "outcome", "recommendations", "reproducedAt",
    "reproductionSteps", "schemaVersion", "status", "title", "verifiedObservations",
  ].sort());
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.incidentId, "INC-001");
  assert.equal(report.bugId, "BUG-001");
  assert.equal(report.title, "Empty task creation causes HTTP 500");
  assert.equal(report.status, "OPEN / UNFIXED");
  assert.equal(new Date(report.reproducedAt).toISOString(), report.reproducedAt);
  assert.equal(observations.method, "POST");
  assert.equal(observations.route, "/api/tasks");
  assert.equal(observations.scenarios.length, 2);
  for (const scenario of observations.scenarios) {
    assert.deepEqual(Object.keys(scenario).sort(), ["id", "label", "request", "expected", "observed", "matchesExpected", "classification"].sort());
    assert.equal(typeof scenario.observed.status, "number");
    assert.equal(typeof scenario.observed.error.code, "string");
    assert.equal(typeof scenario.observed.error.message, "string");
    assert.equal(scenario.request.route, "/api/tasks");
  }
  assert.ok(report.reproductionSteps.length >= 5);
  assert.match(report.analysis.rootCause, /before calling validateTaskInput/);
  assert.ok(report.analysis.sourceLocations.some(source => source.file === "src/controllers/tasks.controller.js"));
  for (const source of report.analysis.sourceLocations) {
    assert.doesNotMatch(source.file, /^(?:[A-Za-z]:|\/)/);
    assert.equal(typeof source.relevance, "string");
  }
  assert.equal(typeof report.recommendations.suggestedMinimalFix, "string");
  assert.ok(report.recommendations.verificationRequirements.length >= 4);
  assert.equal(report.outcome, "PASSED");
});

test("classification distinguishes correct behavior, preserved bug and unexpected results", () => {
  const scenario = observations.scenarios[0];
  assert.equal(classifyScenario(scenario.expected, scenario.observed), "KNOWN_BUG_REPRODUCED");
  const corrected = {
    status: 400, success: false, jsonContentType: true,
    error: { code: "VALIDATION_ERROR", message: "Invalid task input.", detailsCount: 1 },
  };
  assert.equal(classifyScenario(scenario.expected, corrected), "EXPECTED_BEHAVIOR");
  for (const changed of [
    { status: 503 }, { success: true }, { jsonContentType: false },
    { error: { code: "INTERNAL_ERROR", message: "Different error", detailsCount: 0 } },
  ]) {
    assert.equal(classifyScenario(scenario.expected, { ...scenario.observed, ...changed }), "UNEXPECTED_RESULT");
  }
});

test("invalid requests leave only the control task, and isolated runs cannot alter existing app data", async () => {
  assert.equal(observations.storageUnchangedAfterInvalidRequests, true);
  assert.equal(observations.healthyAfterErrors, true);
  await withTemporaryApi(async origin => {
    const created = await fetch(origin + "/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Existing task must survive" }), signal: AbortSignal.timeout(5000),
    });
    assert.equal(created.status, 201);
    const before = await (await fetch(origin + "/api/tasks")).json();
    await collectEvidence();
    const after = await (await fetch(origin + "/api/tasks")).json();
    assert.deepEqual(after, before);
  });
});

test("generated JSON and Markdown contain the actual collected report and safe source locations", async t => {
  const directory = await temporaryDirectory(t);
  const result = await runReproduction({ directory });
  assert.equal(result.exitCode, 0);
  const json = await readFile(join(directory, "phase9-bug-evidence.json"), "utf8");
  const markdown = await readFile(join(directory, "phase9-bug-evidence.md"), "utf8");
  assert.deepEqual(JSON.parse(json), result.report);
  assert.equal(markdown, renderMarkdown(result.report));
  for (const content of [json, markdown]) {
    assert.match(content, /INC-001/);
    assert.match(content, /OPEN \/ UNFIXED/);
    assert.match(content, /KNOWN_BUG_REPRODUCED/);
    assert.doesNotMatch(content, /(?:Bearer\s|sk-proj-|password["']?\s*:|process\.env|[A-Za-z]:[\\/]|\/home\/|\/Users\/|SWITCH_AGENT_KEY)/i);
    assert.doesNotMatch(content, /BUG-001: empty task body bypasses validation/);
  }
});

test("unknown HTTP fields and error strings cannot leak secrets into either report", async t => {
  const directory = await temporaryDirectory(t);
  const secret = "PHASE9_SYNTHETIC_SECRET_73ad";
  const app = (req, res) => {
    req.resume();
    res.writeHead(500, { "Content-Type": "application/json", "X-Private": secret });
    res.end(JSON.stringify({
      success: false, token: secret, stack: secret,
      error: { code: secret, message: secret, details: [{ password: secret }], private: secret },
      data: { id: secret, title: secret, description: secret, status: secret, createdAt: secret, updatedAt: secret },
    }));
  };
  const result = await runReproduction({ app, directory });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.outcome, "FAILED");
  for (const name of ["phase9-bug-evidence.json", "phase9-bug-evidence.md"]) {
    const content = await readFile(join(directory, name), "utf8");
    assert.equal(content.includes(secret), false);
    assert.match(content, /\[REDACTED\]/);
  }
});

test("a corrected API is recorded honestly and returns a nonzero reproduction result", async t => {
  const directory = await temporaryDirectory(t);
  const realApp = createApp();
  let posts = 0;
  const app = (req, res) => {
    if (req.method === "POST" && ++posts > 1) {
      req.resume();
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid task input.", details: [] } }));
    } else realApp(req, res);
  };
  const { exitCode, report: corrected } = await runReproduction({ app, directory });
  assert.equal(exitCode, 1);
  assert.equal(corrected.outcome, "FAILED");
  assert.equal(corrected.verifiedObservations.baseline.passed, true);
  for (const scenario of corrected.verifiedObservations.scenarios) {
    assert.equal(scenario.observed.status, 400);
    assert.equal(scenario.matchesExpected, true);
    assert.equal(scenario.classification, "EXPECTED_BEHAVIOR");
  }
});

test("a failed valid baseline cannot produce a successful reproduction outcome", async t => {
  const directory = await temporaryDirectory(t);
  const realApp = createApp();
  let posts = 0;
  const app = (req, res) => {
    if (req.method === "POST" && ++posts === 1) {
      req.resume();
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false }));
    } else realApp(req, res);
  };
  const result = await runReproduction({ app, directory });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.verifiedObservations.baseline.passed, false);
  assert.ok(result.report.verifiedObservations.scenarios.every(s => s.classification === "KNOWN_BUG_REPRODUCED"));
});

test("temporary server closes after success and no longer accepts connections", async () => {
  let savedServer;
  let savedOrigin;
  await withTemporaryApi(async (origin, server) => {
    savedServer = server;
    savedOrigin = origin;
    assert.equal((await fetch(origin + "/health")).status, 200);
  });
  assert.equal(savedServer.listening, false);
  assert.equal(observations.temporaryServerClosed, true);
  await assert.rejects(fetch(savedOrigin + "/health", { signal: AbortSignal.timeout(1000) }));
});

test("temporary server closes if the operation throws", async () => {
  let savedServer;
  await assert.rejects(withTemporaryApi(async (_origin, server) => {
    savedServer = server;
    throw new Error("Synthetic operation failure");
  }), /Synthetic operation failure/);
  assert.equal(savedServer.listening, false);
});

test("temporary server closes active sockets when a request times out", async () => {
  let savedServer;
  await assert.rejects(withTemporaryApi(async (origin, server) => {
    savedServer = server;
    await fetch(origin + "/health", { signal: AbortSignal.timeout(50) });
  }, { app: req => req.resume() }), { name: "TimeoutError" });
  assert.equal(savedServer.listening, false);
  assert.equal(await new Promise((resolve, reject) => savedServer.getConnections((error, count) => error ? reject(error) : resolve(count))), 0);
});

test("malformed JSON is an infrastructure/protocol failure and still closes the server", async () => {
  let savedServer;
  const app = (req, res) => {
    savedServer = req.socket.server;
    req.resume();
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end("not JSON");
  };
  await assert.rejects(collectEvidence({ app }), SyntaxError);
  assert.equal(savedServer.listening, false);
});

test("report-writing failures reject after the HTTP server has already closed", async t => {
  const directory = await temporaryDirectory(t);
  const blockedPath = join(directory, "a-file-not-a-directory");
  await writeFile(blockedPath, "Synthetic filesystem obstruction");
  let savedServer;
  const realApp = createApp();
  await assert.rejects(runReproduction({
    directory: blockedPath,
    app: (req, res) => { savedServer = req.socket.server; realApp(req, res); },
  }));
  assert.equal(savedServer.listening, false);
});
