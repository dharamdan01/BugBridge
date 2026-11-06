import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";

const route = "/api/tasks";
const title = "Phase 9 isolated reproduction baseline";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeMessages = new Set(["Internal server error.", "Invalid task input."]);
const safeCodes = new Set(["INTERNAL_ERROR", "VALIDATION_ERROR"]);
const redacted = "[REDACTED]";

// A fixed loopback origin and a fresh app prevent access to existing task data.
// The optional app argument is only a test seam; the CLI always uses createApp().
export async function withTemporaryApi(operation, { app = createApp() } = {}) {
  const server = createServer(app);
  server.requestTimeout = 5000;
  try {
    await new Promise((resolveListen, reject) => {
      const onError = error => reject(error);
      server.once("error", onError);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", onError);
        resolveListen();
      });
    });
    return await operation(`http://127.0.0.1:${server.address().port}`, server);
  } finally {
    // Force-close sockets too, including a request that timed out or never ended.
    await new Promise((resolveClose, reject) => {
      server.close(error => {
        if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
        else resolveClose();
      });
      server.closeAllConnections();
    });
  }
}

// Store only explicitly permitted fields, never arbitrary bodies, headers or logs.
function projectResponse(response, body) {
  const result = {
    status: response.status,
    jsonContentType: /^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? ""),
    success: typeof body?.success === "boolean" ? body.success : null,
  };
  if (body?.error) {
    result.error = {
      code: safeCodes.has(body.error.code) ? body.error.code : redacted,
      message: safeMessages.has(body.error.message) ? body.error.message : redacted,
      detailsCount: Array.isArray(body.error.details) ? body.error.details.length : null,
    };
  }
  if (body?.data && !Array.isArray(body.data)) {
    const task = body.data;
    const safeDate = value => typeof value === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
    result.task = {
      id: typeof task.id === "string" && uuid.test(task.id) ? task.id : redacted,
      title: task.title === title ? task.title : redacted,
      description: task.description === "" ? "" : redacted,
      status: task.status === "todo" ? "todo" : redacted,
      createdAt: safeDate(task.createdAt) ? task.createdAt : redacted,
      updatedAt: safeDate(task.updatedAt) ? task.updatedAt : redacted,
    };
    result.locationMatchesTask = uuid.test(result.task.id) &&
      response.headers.get("location") === `${route}/${result.task.id}`;
  }
  return result;
}

async function request(origin, path, options = {}) {
  const response = await fetch(origin + path, {
    ...options, redirect: "error", signal: AbortSignal.timeout(5000),
  });
  // Malformed/non-JSON responses are infrastructure/protocol failures, never evidence of the bug.
  return { response, body: await response.json() };
}

export function classifyScenario(expected, observed) {
  if (observed.status === expected.status && observed.jsonContentType &&
      observed.success === false && observed.error?.code === expected.errorCode &&
      observed.error?.message === "Invalid task input.") return "EXPECTED_BEHAVIOR";
  if (observed.status === 500 && observed.jsonContentType && observed.success === false &&
      observed.error?.code === "INTERNAL_ERROR" &&
      observed.error?.message === "Internal server error." && observed.error.detailsCount === 0) {
    return "KNOWN_BUG_REPRODUCED";
  }
  return "UNEXPECTED_RESULT";
}

export async function collectEvidence({ app } = {}) {
  const report = await withTemporaryApi(async origin => {
    const reproducedAt = new Date().toISOString();
    const controlRequest = { method: "POST", headers: { "Content-Type": "application/json" }, body: { title } };
    const control = await request(origin, route, {
      method: "POST", headers: controlRequest.headers, body: JSON.stringify(controlRequest.body),
    });
    const observed = projectResponse(control.response, control.body);
    const task = observed.task;
    const baselinePassed = observed.status === 201 && observed.jsonContentType &&
      observed.success === true && !observed.error && observed.locationMatchesTask &&
      task && Object.values(task).every(value => value !== redacted) && task.createdAt === task.updatedAt;
    const scenarios = [];
    for (const variant of [
      { id: "empty-json", label: "Empty JSON object", headers: { "Content-Type": "application/json" }, body: "{}", json: {} },
      { id: "empty-body", label: "Absent request body (zero bytes)", headers: {}, json: null },
    ]) {
      const result = await request(origin, route, {
        method: "POST", headers: variant.headers,
        ...(variant.body === undefined ? {} : { body: variant.body }),
      });
      const expected = { status: 400, errorCode: "VALIDATION_ERROR" };
      const actual = projectResponse(result.response, result.body);
      scenarios.push({
        id: variant.id, label: variant.label,
        request: { method: "POST", route, headers: variant.headers, body: variant.json, bodyBytes: variant.body === undefined ? 0 : 2 },
        expected, observed: actual, matchesExpected: actual.status === expected.status && actual.error?.code === expected.errorCode,
        classification: classifyScenario(expected, actual),
      });
    }
    const remaining = await request(origin, route);
    const health = await request(origin, "/health");
    const storageUnchangedAfterInvalidRequests = baselinePassed && remaining.response.status === 200 &&
      remaining.body.success === true && Array.isArray(remaining.body.data) && remaining.body.data.length === 1 &&
      JSON.stringify(remaining.body.data[0]) === JSON.stringify(control.body.data);
    const healthyAfterErrors = health.response.status === 200 && health.body.success === true && health.body.data?.status === "ok";
    return {
      schemaVersion: 1, incidentId: "INC-001", bugId: "BUG-001",
      title: "Empty task creation causes HTTP 500", status: "OPEN / UNFIXED", reproducedAt,
      verifiedObservations: {
        method: "POST", route, transport: "Real HTTP via built-in Node.js fetch; 127.0.0.1 on an ephemeral port",
        storage: "Fresh createApp() instance with private in-memory task storage",
        baseline: { request: { ...controlRequest, route }, expected: { status: 201 }, observed, passed: Boolean(baselinePassed) },
        scenarios, storageUnchangedAfterInvalidRequests: Boolean(storageUnchangedAfterInvalidRequests),
        healthyAfterErrors, temporaryServerClosed: false,
      },
      reproductionSteps: [
        "Run npm run reproduce:bug from the project root.",
        "Start a fresh createApp() on 127.0.0.1 port 0; the OS assigns a free port.",
        "POST /api/tasks with the fixed valid title; verify 201 and the created task.",
        "POST /api/tasks with Content-Type application/json and the literal body {}.",
        "POST /api/tasks without a body or Content-Type header (zero bytes).",
        "Compare both actual statuses and sanitized errors with 400 VALIDATION_ERROR and the known 500 INTERNAL_ERROR signature.",
        "Verify only the control task remains, check health, then close the temporary server.",
      ],
      analysis: {
        basis: "Source inspection, supported by the verified HTTP observations; no runtime stack trace was collected.",
        sourceLocations: [
          { file: "src/app.js", symbol: "createApp", relevance: "JSON parsing, isolated service and /api/tasks mount" },
          { file: "src/routes/tasks.routes.js", symbol: "createTasksRouter", relevance: "POST / dispatches to controller.create" },
          { file: "src/controllers/tasks.controller.js", symbol: "create", lines: [12, 16, 18], relevance: "Empty inputs throw a generic Error before validateTaskInput" },
          { file: "src/validation/tasks.validation.js", symbol: "validateTaskInput", relevance: "Undefined body and missing title already produce HttpError(400, VALIDATION_ERROR)" },
          { file: "src/middleware/error-handler.js", symbol: "errorHandler", lines: [27, 28, 31, 32], relevance: "Non-HttpError exceptions map to sanitized 500 INTERNAL_ERROR" },
          { file: "src/services/tasks.service.js", symbol: "createTasksService", relevance: "Private Map per application instance" },
          { file: "fixtures/bug-reports.json", symbol: "BUG-001", relevance: "Existing expected contract; fixture actual values were not used as HTTP evidence" },
          { file: "tests/regression/empty-body.test.js", symbol: "BUG-001 regression", relevance: "Asserts correct 400 behavior for both scenarios" },
        ],
        rootCause: "The create controller explicitly throws a generic Error for undefined bodies and empty objects before calling validateTaskInput. Express forwards this to errorHandler, which maps non-HttpError exceptions to HTTP 500 INTERNAL_ERROR. The existing validator would reject both inputs with HTTP 400 VALIDATION_ERROR.",
      },
      recommendations: {
        suggestedMinimalFix: "After human approval, remove the intentional empty-input throw branch in controller.create and let validateTaskInput handle both cases. Remove the unused isObject import if it is no longer referenced. Preserve generic-error sanitization in errorHandler.",
        verificationRequirements: [
          "Both empty input scenarios must return 400 VALIDATION_ERROR after an approved fix.",
          "The unchanged separate npm run test:bug regression must then pass.",
          "Valid creation must remain 201; rejected requests must not create tasks.",
          "Normal API, Switch bridge and smoke suites must pass.",
          "Update the investigation acceptance policy only in the approved fixing phase: it currently requires the preserved bug.",
        ],
        approval: "Investigation only. No automatic patching; any future edit requires explicit human approval.",
      },
      outcome: baselinePassed && storageUnchangedAfterInvalidRequests && healthyAfterErrors &&
        scenarios.every(scenario => scenario.classification === "KNOWN_BUG_REPRODUCED") ? "PASSED" : "FAILED",
    };
  }, { app });
  // withTemporaryApi resolves only after successful shutdown.
  report.verifiedObservations.temporaryServerClosed = true;
  return report;
}

export function renderMarkdown(report) {
  const observations = report.verifiedObservations;
  return `# ${report.incidentId}: ${report.title}

Status: **${report.status}**. Bug: ${report.bugId}. Reproduced at: ${report.reproducedAt}.
Outcome: **${report.outcome}** (success means the preserved bug was observed).

## Verified observations from real execution

- Method and route: ${observations.method} ${observations.route}
- Transport: ${observations.transport}
- Isolation: ${observations.storage}
- Valid baseline: expected ${observations.baseline.expected.status}; observed ${observations.baseline.observed.status}; passed: ${observations.baseline.passed}
- Invalid requests preserved the control task without inserting tasks: ${observations.storageUnchangedAfterInvalidRequests}
- Health after errors: ${observations.healthyAfterErrors}
- Temporary server closed: ${observations.temporaryServerClosed}

| Input | Expected HTTP/code | Actual HTTP/code | Actual sanitized message | Classification |
| --- | --- | --- | --- | --- |
${observations.scenarios.map(s => `| ${s.label} | ${s.expected.status} ${s.expected.errorCode} | ${s.observed.status} ${s.observed.error?.code ?? "(none)"} | ${s.observed.error?.message ?? "(none)"} | ${s.classification} |`).join("\n")}

### Sanitized requests and responses

Only allowlisted evidence fields are retained. Unknown error strings and task values are redacted. No arbitrary headers, response details, stack traces or process configuration are copied.

\`\`\`json
${JSON.stringify({ baseline: observations.baseline, scenarios: observations.scenarios }, null, 2)}
\`\`\`

### Reproduction steps

${report.reproductionSteps.map((step, i) => `${i + 1}. ${step}`).join("\n")}

## Analysis from source inspection

${report.analysis.basis}

${report.analysis.rootCause}

${report.analysis.sourceLocations.map(source => `- ${source.file}${source.lines ? ` (lines ${source.lines.join(", ")})` : ""}: ${source.symbol} — ${source.relevance}`).join("\n")}

## Recommendations requiring human approval

${report.recommendations.suggestedMinimalFix}

${report.recommendations.verificationRequirements.map(requirement => `- ${requirement}`).join("\n")}

${report.recommendations.approval}
`;
}

export async function writeEvidenceReports(report, directory = new URL("../reports/", import.meta.url)) {
  await mkdir(directory, { recursive: true });
  const jsonPath = typeof directory === "string" ? resolve(directory, "phase9-bug-evidence.json") : new URL("phase9-bug-evidence.json", directory);
  const markdownPath = typeof directory === "string" ? resolve(directory, "phase9-bug-evidence.md") : new URL("phase9-bug-evidence.md", directory);
  await writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  await writeFile(markdownPath, renderMarkdown(report), "utf8");
}

export async function runReproduction({ app, directory } = {}) {
  const report = await collectEvidence({ app });
  await writeEvidenceReports(report, directory);
  return { report, exitCode: report.outcome === "PASSED" ? 0 : 1 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { report, exitCode } = await runReproduction();
    console.log(`INC-001 reproduction: ${report.outcome}; baseline HTTP ${report.verifiedObservations.baseline.observed.status}.`);
    for (const scenario of report.verifiedObservations.scenarios) {
      console.log(`${scenario.label}: HTTP ${scenario.observed.status} ${scenario.observed.error?.code ?? "(no safe error code)"}; ${scenario.classification}.`);
    }
    console.log("Evidence: reports/phase9-bug-evidence.json and reports/phase9-bug-evidence.md; temporary server closed.");
    process.exitCode = exitCode;
  } catch {
    // Never print arbitrary exception messages, paths, response payloads or credentials.
    console.error("INC-001 reproduction failed: infrastructure, HTTP protocol, cleanup or report-writing failure. Existing reports may be stale; check their timestamps.");
    process.exitCode = 1;
  }
}
