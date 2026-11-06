# INC-001: Empty task creation causes HTTP 500

Status: **OPEN / UNFIXED**. Bug: BUG-001. Reproduced at: 2026-11-05T08:16:16.430Z.
Outcome: **PASSED** (success means the preserved bug was observed).

## Verified observations from real execution

- Method and route: POST /api/tasks
- Transport: Real HTTP via built-in Node.js fetch; 127.0.0.1 on an ephemeral port
- Isolation: Fresh createApp() instance with private in-memory task storage
- Valid baseline: expected 201; observed 201; passed: true
- Invalid requests preserved the control task without inserting tasks: true
- Health after errors: true
- Temporary server closed: true

| Input | Expected HTTP/code | Actual HTTP/code | Actual sanitized message | Classification |
| --- | --- | --- | --- | --- |
| Empty JSON object | 400 VALIDATION_ERROR | 500 INTERNAL_ERROR | Internal server error. | KNOWN_BUG_REPRODUCED |
| Absent request body (zero bytes) | 400 VALIDATION_ERROR | 500 INTERNAL_ERROR | Internal server error. | KNOWN_BUG_REPRODUCED |

### Sanitized requests and responses

Only allowlisted evidence fields are retained. Unknown error strings and task values are redacted. No arbitrary headers, response details, stack traces or process configuration are copied.

```json
{
  "baseline": {
    "request": {
      "method": "POST",
      "headers": {
        "Content-Type": "application/json"
      },
      "body": {
        "title": "Phase 9 isolated reproduction baseline"
      },
      "route": "/api/tasks"
    },
    "expected": {
      "status": 201
    },
    "observed": {
      "status": 201,
      "jsonContentType": true,
      "success": true,
      "task": {
        "id": "3f3ce3d7-42d8-4624-b882-ce0e720c7371",
        "title": "Phase 9 isolated reproduction baseline",
        "description": "",
        "status": "todo",
        "createdAt": "2026-11-05T08:16:16.474Z",
        "updatedAt": "2026-11-05T08:16:16.474Z"
      },
      "locationMatchesTask": true
    },
    "passed": true
  },
  "scenarios": [
    {
      "id": "empty-json",
      "label": "Empty JSON object",
      "request": {
        "method": "POST",
        "route": "/api/tasks",
        "headers": {
          "Content-Type": "application/json"
        },
        "body": {},
        "bodyBytes": 2
      },
      "expected": {
        "status": 400,
        "errorCode": "VALIDATION_ERROR"
      },
      "observed": {
        "status": 500,
        "jsonContentType": true,
        "success": false,
        "error": {
          "code": "INTERNAL_ERROR",
          "message": "Internal server error.",
          "detailsCount": 0
        }
      },
      "matchesExpected": false,
      "classification": "KNOWN_BUG_REPRODUCED"
    },
    {
      "id": "empty-body",
      "label": "Absent request body (zero bytes)",
      "request": {
        "method": "POST",
        "route": "/api/tasks",
        "headers": {},
        "body": null,
        "bodyBytes": 0
      },
      "expected": {
        "status": 400,
        "errorCode": "VALIDATION_ERROR"
      },
      "observed": {
        "status": 500,
        "jsonContentType": true,
        "success": false,
        "error": {
          "code": "INTERNAL_ERROR",
          "message": "Internal server error.",
          "detailsCount": 0
        }
      },
      "matchesExpected": false,
      "classification": "KNOWN_BUG_REPRODUCED"
    }
  ]
}
```

### Reproduction steps

1. Run npm run reproduce:bug from the project root.
2. Start a fresh createApp() on 127.0.0.1 port 0; the OS assigns a free port.
3. POST /api/tasks with the fixed valid title; verify 201 and the created task.
4. POST /api/tasks with Content-Type application/json and the literal body {}.
5. POST /api/tasks without a body or Content-Type header (zero bytes).
6. Compare both actual statuses and sanitized errors with 400 VALIDATION_ERROR and the known 500 INTERNAL_ERROR signature.
7. Verify only the control task remains, check health, then close the temporary server.

## Analysis from source inspection

Source inspection, supported by the verified HTTP observations; no runtime stack trace was collected.

The create controller explicitly throws a generic Error for undefined bodies and empty objects before calling validateTaskInput. Express forwards this to errorHandler, which maps non-HttpError exceptions to HTTP 500 INTERNAL_ERROR. The existing validator would reject both inputs with HTTP 400 VALIDATION_ERROR.

- src/app.js: createApp — JSON parsing, isolated service and /api/tasks mount
- src/routes/tasks.routes.js: createTasksRouter — POST / dispatches to controller.create
- src/controllers/tasks.controller.js (lines 12, 16, 18): create — Empty inputs throw a generic Error before validateTaskInput
- src/validation/tasks.validation.js: validateTaskInput — Undefined body and missing title already produce HttpError(400, VALIDATION_ERROR)
- src/middleware/error-handler.js (lines 27, 28, 31, 32): errorHandler — Non-HttpError exceptions map to sanitized 500 INTERNAL_ERROR
- src/services/tasks.service.js: createTasksService — Private Map per application instance
- fixtures/bug-reports.json: BUG-001 — Existing expected contract; fixture actual values were not used as HTTP evidence
- tests/regression/empty-body.test.js: BUG-001 regression — Asserts correct 400 behavior for both scenarios

## Recommendations requiring human approval

After human approval, remove the intentional empty-input throw branch in controller.create and let validateTaskInput handle both cases. Remove the unused isObject import if it is no longer referenced. Preserve generic-error sanitization in errorHandler.

- Both empty input scenarios must return 400 VALIDATION_ERROR after an approved fix.
- The unchanged separate npm run test:bug regression must then pass.
- Valid creation must remain 201; rejected requests must not create tasks.
- Normal API, Switch bridge and smoke suites must pass.
- Update the investigation acceptance policy only in the approved fixing phase: it currently requires the preserved bug.

Investigation only. No automatic patching; any future edit requires explicit human approval.
