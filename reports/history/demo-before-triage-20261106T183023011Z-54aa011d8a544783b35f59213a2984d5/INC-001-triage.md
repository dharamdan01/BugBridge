# INC-001: Empty task creation causes HTTP 500

Current status: **AWAITING_APPROVAL**. Human approval required: **true**. Fix applied: **false**.
Generated: 2026-11-06T08:05:23.096Z. Analysis origin: CODEX_CLI.

## Bug summary

Empty task creation is misclassified as a server failure. Expected: 400 VALIDATION_ERROR (API contract). Observed: 500 INTERNAL_ERROR (measured HTTP).

## Reproduction evidence — measured observations

Source: reports/phase9-bug-evidence.json. Reproduced: 2026-11-05T08:37:21.111Z.
Evidence SHA-256: d59a2148dd6075e0aeee7696488a87078d16fb27e839463c6576c0b5ef029ee7.
Real loopback HTTP in a fresh in-memory app; valid creation returned 201.

| Request | Bytes | Expected HTTP/code | Observed HTTP/code |
| --- | --- | --- | --- |
| POST /api/tasks: empty-json | 2 | 400 VALIDATION_ERROR | 500 INTERNAL_ERROR |
| POST /api/tasks: empty-body | 0 | 400 VALIDATION_ERROR | 500 INTERNAL_ERROR |

Both responses contained the sanitized message `Internal server error.`. Storage unchanged: true. Healthy after errors: true. Temporary server closed: true.

## Root cause — AI analysis from inspected source

The create controller throws a generic Error for undefined bodies and empty objects before validateTaskInput. Express forwards it to errorHandler, which maps non-HttpError exceptions to 500 INTERNAL_ERROR. The existing validator would reject both inputs with 400 VALIDATION_ERROR.

No runtime stack trace was collected. The analysis is distinct from the measured HTTP observations.

## Relevant source and test files — verified excerpts

### src/app.js

SHA-256: 760540c467b8f7eed43a489d6bf9d23fde040ddecc93d03a8cd60e7a30649794

- Line 17: `app.use(express.json({ limit: "16kb", strict: false }));`
- Line 20: `app.use("/api/tasks", createTasksRouter(createTasksService()));`

### src/routes/tasks.routes.js

SHA-256: 0971361116e90bcff6674ca0b1c1c5b7f8234c85f544bf66c1d360f7cdff7aad

- Line 9: `router.route("/").get(controller.list).post(controller.create);`

### src/controllers/tasks.controller.js

SHA-256: 4cafbf10e6cf55738c0687b3f2ed8d1f443ec7d039115d8ae6abe2da79ff3432

- Line 1: `import { isObject, validateTaskInput } from "../validation/tasks.validation.js";`
- Line 12: `if (req.body === undefined || (isObject(req.body) && Object.keys(req.body).length === 0)) {`
- Line 16: `throw new Error("BUG-001: empty task body bypasses validation");`
- Line 18: `const task = service.create(validateTaskInput(req.body));`

### src/validation/tasks.validation.js

SHA-256: 175ba0c9ce4506aec979a4fc998ae4657f9ad079bb199485136b93eb6cb31bdd

- Line 9: `if (!isObject(body)) {`
- Line 10: `throw new HttpError(400, "VALIDATION_ERROR", "Invalid task input.", [`
- Line 22: `(typeof body.title !== "string" || body.title.trim().length === 0 || body.title.trim().length > 200)) {`
- Line 31: `if (details.length) throw new HttpError(400, "VALIDATION_ERROR", "Invalid task input.", details);`

### src/middleware/error-handler.js

SHA-256: 9c11519be5d3f841efdc91b40a2d06412f501f890765ddf564356ba91b96fea8

- Line 27: `const known = failure instanceof HttpError;`
- Line 28: `res.status(known ? failure.status : 500).json({`
- Line 31: `code: known ? failure.code : "INTERNAL_ERROR",`
- Line 32: `message: known ? failure.message : "Internal server error.",`

### src/services/tasks.service.js

SHA-256: 2490414b1e4eca70d1a2e166b57864329fa4843d7c16a976bb85d315012e960d

- Line 5: `const tasks = new Map();`
- Line 21: `tasks.set(task.id, task);`

### tests/regression/empty-body.test.js

SHA-256: 01c20aeeec26a5110f9dda095640f2902f8496e2e6186973ef5175c75bcd4f88

- Line 10: `test("BUG-001: empty task creation should return 400 VALIDATION_ERROR, not 500", async t => {`
- Line 21: `assert.deepEqual(actual, bug.requests.map(variant => ({ variant: variant.label, ...bug.expected })));`

### tests/tasks.test.js

SHA-256: 7652cd14ad164a8d63fc713cdcecc410e35d289e85a3956e3f66f15d74fc2dbc

- Line 37: `test("create sets defaults, UUID, timestamps and Location header", async t => {`
- Line 40: `assert.equal(result.status, 201);`

### tests/investigation/reproduce-bug.test.mjs

SHA-256: c75f9d2c1f4ae812ce8d5896fa11b3d75c59d06e0b4f5509da3f8620dff9bda1

- Line 34: `test(`${id} preserves and reproduces the known HTTP 500 bug`, () => {`
- Line 37: `assert.equal(scenario.observed.status, 500);`

### scripts/reproduce-bug.mjs

SHA-256: 71ec7fcd81f0beee97cc5dcf09fa2b16690bfb701a1883bfcd74107e96095c7e

- Line 93: `export async function collectEvidence({ app } = {}) {`
- Line 114: `const expected = { status: 400, errorCode: "VALIDATION_ERROR" };`

## Proposed minimal fix — unapplied AI proposal

After separate human approval, remove the intentional empty-input throw branch from create and remove its unused isObject import. Keep validateTaskInput and generic-error sanitization unchanged.

## Impact, severity and risk assessment — AI analysis

Severity: **MODERATE**. Both invalid requests returned server errors, but valid creation succeeded, health recovered and storage was unchanged. Broader production impact is unknown.

- Small change to the create validation path; regression risk includes accidentally changing valid creation or generic-error sanitization.
- Measured scope is two synthetic requests in a fresh in-memory instance. Production frequency, users affected, retry traffic and business loss were not measured.
- No runtime stack trace was collected. Root cause is source-supported analysis, not a measured stack trace. Proposed behavior has not been applied or tested.

## Regression testing plan — future checks, not executed results

- After approval: npm run test:bug must pass unchanged; both empty JSON and absent bodies must return 400 VALIDATION_ERROR with no inserted task.
- After approval: npm test must pass; valid creation must remain 201 with defaults and Location; other validation and error sanitization must remain intact.
- After approval: npm run smoke must pass after its preserved-500 expectation is explicitly reviewed and updated for the approved fixed state.
- After approval: review and update the preserved-bug acceptance policy in npm run reproduce:bug, npm run test:investigation and Phase 10 incident acceptance tests; record new real HTTP evidence.
- After approval: npm run test:phase7, npm run test:phase10 and JavaScript syntax checks must pass; manually verify existing PING, ASK and triage in the same Mattermost room.

## Human approval boundary

Status remains AWAITING_APPROVAL. This proposal grants no editing authority. Phase 10 has no approval command, patch executor or automatic fixing path. Phase 11 must enforce authenticated human approval bound to an immutable proposal and source/evidence hashes before any edit. Neither chat text nor an AI response can approve a fix.
