# Phase 10: AI bug triage and evidence-based fix proposal

Project: BugBridge. Hackathon: WeMakeDevs Flip the Switch. Track: Best Business Workflow.
Verification date: 2026-11-05. Node.js v24.20.0; npm 11.19.0.

Implementation and automated verification are complete. INC-001 remains unfixed. The proposal is **AWAITING_APPROVAL**, with `approvalRequired: true` and `proposedFix.applied: false`. Live Codex/Mattermost acceptance is **PENDING**. Do not start a fixing workflow until Phase 11 enforces separate human approval.

## Architecture and workflow

The existing runtime composes one message handler, one Codex runner and the existing authenticated Switch client. No new live connection, agent, room, plugin, service or server is added. The unchanged client still subscribes to its configured room over WebSocket and replies through `POST /agents/{agentId}/message` with that same `room_id`. Heartbeat, reconnect, backoff and cursor logic are unchanged.

```text
Mattermost human command
  -> existing Switch connection and message handler
  -> targeting / self-reply / duplicate / shared busy checks
  -> fixed INC-001 registry and evidence/source loader
  -> read-only Codex CLI, bounded JSON assessment
  -> schema and semantic validation
  -> recheck source/evidence hashes
  -> local JSON + Markdown reports
  -> concise approval-required reply through the same Switch client
```

`switch-bridge/incident-triage.mjs` loads the evidence and inspects source/test files. `incident-files.mjs` validates paths and size limits. `triage-contract.mjs` defines model assessment and proposal JSON Schemas, severity policy and human-review recommendations. `schema-validator.mjs` validates the checked-in schemas' supported keywords without an additional dependency. Unknown model/proposal properties are rejected.

The handler retains the existing PING and ASK commands. ASK and triage share a single busy guard; PING remains available while either runs. Triage uses the existing duplicate identity and in-flight cache across reconnects. Its reply prefix is included in self-reply filtering. Unsupported IDs receive a fixed rejection; incident/evidence/model/write failures receive a fixed `INC-001 | TRIAGE_FAILED` reply. A failed reply POST is never retried automatically because delivery may already have occurred.

## New Mattermost command

Send either of these in the existing configured Mattermost room:

```text
TRIAGE BUGBRIDGE INC-001
@bug-triager TRIAGE BUGBRIDGE INC-001
```

Case is ignored and surrounding whitespace is trimmed. As with existing commands, a direct BugBridge command explicitly targets this agent even if Switch's mention flag is false. Another agent's mention, embedded/quoted commands, bot/self messages and messages from other rooms are ignored. Missing IDs, extra arguments, path fragments and unsupported IDs cannot select files or reach Codex. The loader itself accepts only the exact canonical ID `INC-001`.

The success reply includes the incident ID, `AWAITING_APPROVAL`, derived severity, expected 400 versus measured 500, source-supported root cause, minimal proposed change, verification requirements and report paths. It explicitly states that human approval is required and no fix was applied. There is no approval, execute-fix or patch command in Phase 10.

## Evidence collection and analysis

The existing `npm run reproduce:bug` still creates an isolated temporary HTTP API on loopback, exercises a valid control and two empty POST variants, checks storage and health, closes its server and writes the Phase 9 evidence pair. This script was inspected and executed without modification. Fixture `actual` fields are never used as measured HTTP evidence.

The Phase 10 loader requires schema version 1, matching incident/bug IDs, the preserved-bug outcome, a complete successful 201 control, both expected 400 / observed 500 signatures, unchanged storage, healthy recovery and confirmed cleanup. It checks request metadata and the sanitized error signature. It requires the Markdown to match the JSON's existing Phase 9 renderer. Missing, malformed, oversized, contradictory or corrected-API evidence is rejected before Codex execution.

Only allowlisted scalar observations and exact verified source/test excerpts enter the Codex bundle. Phase 9 analysis/recommendation narratives, arbitrary HTTP fields, source comments, chat text and private task values are not forwarded. Required excerpts must be found in current files; controller throw/validation ordering is checked. Line numbers are calculated from those files and full-file SHA-256 hashes are recorded. No model-supplied paths or line numbers are accepted.

The inspected file allowlist is:

- `src/app.js`, `src/routes/tasks.routes.js`, `src/controllers/tasks.controller.js`
- `src/validation/tasks.validation.js`, `src/middleware/error-handler.js`, `src/services/tasks.service.js`
- `tests/tasks.test.js`, `tests/regression/empty-body.test.js`
- `tests/investigation/reproduce-bug.test.mjs`, `scripts/reproduce-bug.mjs`
- `reports/phase9-bug-evidence.json` and its matching Markdown

The source bundle supports a specific interpretation: the create controller throws a generic Error for undefined or empty-object input before calling `validateTaskInput`. The error middleware maps that error to 500 INTERNAL_ERROR. The existing validator contains the appropriate 400 VALIDATION_ERROR handling. No runtime stack trace was collected; this causal explanation is source-based AI analysis supported by measured HTTP, not a claim of runtime tracing.

Codex must return a constrained JSON assessment selecting that mechanism and the minimal change, citing all six evidence references and all five required verification categories. It may select `INSUFFICIENT_EVIDENCE`, which fails the run. Generic chat prose, malformed JSON, omitted/duplicate references, extra properties or claims about executed tests are rejected. Application-owned wording renders the accepted classifications into the report. This is deliberately an incident-specific workflow rather than open-ended model prose.

Severity is derived from impact: health, storage or valid-creation failures imply HIGH; server errors with successful control, healthy recovery and unchanged storage imply MODERATE; no server-error impact implies LOW. The current verified incident yields MODERATE. Tests exercise the other policy branches, although this incident's acceptance gate currently requires the known isolated failure with successful recovery. Production frequency, affected users and business loss are unknown.

## Proposal schema and reports

The exported `proposalSchema` in `switch-bridge/triage-contract.mjs` is the machine-readable JSON Schema. Runtime validation adds timestamp, unique-reference, scenario/body-size and severity-consistency checks. The writer re-loads evidence/source and compares hashes and excerpts before saving, rejecting changes during analysis.

| Field | Meaning / enforced value |
| --- | --- |
| incidentId | INC-001 |
| title | Empty task creation causes HTTP 500 |
| status | AWAITING_APPROVAL |
| severity | AI_ANALYSIS basis, derived level and impact rationale |
| problem | Empty creation misclassified as a server failure |
| expectedBehavior | API_CONTRACT: 400 VALIDATION_ERROR |
| observedBehavior | MEASURED_HTTP: 500 INTERNAL_ERROR; valid control 201 |
| reproductionEvidence | Measured scenarios, evidence timestamp/hash, storage/health/cleanup checks |
| rootCause | AI_ANALYSIS, explicit analyst provenance, explanation and validated assessment |
| supportingFiles | Approved file paths, full-file hashes and verified line/text excerpts |
| proposedFix | AI_ANALYSIS, controller path, minimal recommendation, applied false |
| riskAssessment | AI_ANALYSIS, change risks and limits of measured scope |
| verificationPlan | Future checks after approval; never claims they ran against a fix |
| approvalRequired | true |
| generatedAt | Actual ISO generation timestamp, at or after reproduction |

Generated local reports:

- `reports/incidents/INC-001-triage.json`
- `reports/incidents/INC-001-triage.md`

Current evidence timestamp: **2026-11-05T07:28:20.971Z**. Proposal timestamp: **2026-11-05T07:31:18.380Z**. Later successful runs replace those timestamps and reports.

The real CLI attempt in this execution shell failed before model execution: Codex could not resolve its home directory. A diagnostic adapter confirmed home-resolution failure without printing raw stderr or credentials. Switch environment credentials are also absent here. Neither credentials nor login/configuration were changed to bypass this limitation.

To deliver reviewable reports despite that environment limitation, the explicit local source-review command was executed successfully:

```powershell
npm run triage:incident -- --source-review
```

Its reports honestly identify `rootCause.analyst: LOCAL_SOURCE_REVIEW`. They use real verified HTTP evidence and locally inspected source. They do **not** claim a successful Codex CLI invocation. This mode is not exposed through Mattermost and is never an automatic fallback after Codex failure. A successful live triage will generate `CODEX_CLI` provenance instead.

## Codex execution and security boundaries

The existing asynchronous `execFile` runner is reused. It keeps `--ask-for-approval never`, `--sandbox read-only`, `shell: false`, explicit stdin EOF, a 120-second timeout and bounded subprocess buffers. Triage supplies its bounded prompt through stdin to avoid Windows argument-length limits. The runner uses SIGKILL on timeout/failure and kills/awaits the child if stdin setup fails before cleaning up. Tests include a real synthetic Node child that observes EOF, stalls, is terminated and leaves no temporary artifacts.

Triage runs in a temporary directory, ignores user config/rules, disables project instructions, uses ephemeral sessions and strict config checking, and disables command execution, image reads, apps, browser use, multi-agent tools, hooks, memories, goals, web search and default plugins. MCP server configuration is empty. It disables notification commands and telemetry exporters. The model receives the validated bundle rather than permission to traverse project files. These controls are invocation-local; existing authentication and user files are not edited. CLI login storage may still be used by the trusted CLI itself; this is not an OS jail for the CLI process.

The child environment is now an allowlist of operating-system/runtime and existing login-location variables. Switch credentials, registration tokens, API keys, cloud/database secrets and NODE_OPTIONS are excluded. ASK answers additionally redact known secret values and common token/email/local-path patterns. Triage accepts enum-based model output and application-owned explanations, so arbitrary model prose cannot enter its reports or replies. Evidence narratives and chat never become trusted instructions.

Incident paths are fixed in code; no incident ID is interpolated into a filename. Inputs are capped at 128 KiB. Symlinks/junctions and incorrect file types are rejected at every relative path component, including output paths. Recursive runner cleanup checks the final absolute temporary target stays immediately under the intended workspace root. The writer touches only the two fixed incident reports and unique temporary report files; it has no application-source write path.

The installed CLI reports version **0.166.0** and its local help confirms the invocation flags. Per-run feature/config behavior follows the [official OpenAI configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference); flags follow the [official CLI reference](https://learn.chatgpt.com/docs/developer-commands). Full authenticated execution with these overrides remains PENDING because of the home-resolution blocker. Unsupported versions/configuration must fail; do not remove the safeguards to make a run succeed.

## Executed verification

| Command/check | Exit | Observed result |
| --- | --- | --- |
| npm run test:phase10 | 0 | 44 new tests passed; 0 failed/skipped |
| npm test | 0 | 46 normal API tests passed |
| npm run test:investigation | 0 | 15 investigation tests passed |
| Original four Switch test files, explicit node --test invocation | 0 | All 44 original bridge tests passed unchanged |
| npm run test:phase7 | 0 | Expanded suite: 88 passed = 44 original + 44 Phase 10 |
| npm run smoke | 0 | Real server-entrypoint health, CRUD, preserved 500 and recovery passed |
| npm run reproduce:bug | 0 | Valid baseline 201; both empty variants 500 INTERNAL_ERROR; cleanup passed; Phase 9 evidence refreshed |
| npm run test:bug | 1, expected | Unchanged regression failed for actual 500 INTERNAL_ERROR versus required 400 VALIDATION_ERROR in both variants |
| node --check over all project JavaScript excluding dependencies | 0 | All 30 source/script/test files passed |
| npm --prefix switch-bridge run check | 0 | Configured bridge syntax checks passed |
| npm run triage:incident | 1 | Safe CLI failure; no accepted proposal; home resolution unavailable |
| npm run triage:incident -- --source-review | 0 | Both local reports generated with explicit LOCAL_SOURCE_REVIEW provenance |
| Generated-report inspection | 0 | Schema valid, Markdown matches JSON renderer, source/evidence hashes match current files, common private-information pattern scan clean |
| Before/after preservation hashes | 0 | All 22 protected original application/test/fixture/script/lockfile/transport files unchanged |
| Live Mattermost -> Switch -> Codex -> Mattermost triage | PENDING | Not performed in this shell; no new live Switch session opened |

The Phase 10 tests use mocked Codex where needed and synthetic local HTTP/WebSocket fixtures. Coverage includes valid triage/report persistence, invalid IDs/path traversal, missing/malformed/oversized/contradictory evidence, source drift, proposal schema and approval rejection, actual expected/observed HTTP statuses, derived severity, no source modification, duplicate protection, same-room delivery, safe failures, private-data exclusion, PING/ASK compatibility, malformed/self/other-target messages, junction rejection, stdin/timeout cleanup, and heartbeat/reconnect while triage is pending. These are not successful live integration tests.

No existing test assertion was weakened, inverted or skipped. The preserved bug's controller, validator, error handler, fixtures and regression are unchanged. No dependency or lockfile changed. This workspace has no Git metadata, so preservation used SHA-256 rather than a Git diff. Nothing was committed, pushed, deployed or configured in Docker. Environment/credential files were not opened or modified.

## Manual live verification — all rows PENDING

Use the existing credential-configured terminal, registered `bug-triager`, and existing Mattermost room. Stop its older bridge process before starting this version so there is only one live client. Do not create another agent, room, plugin or parallel runtime, and do not paste credentials into chat.

```powershell
npm run reproduce:bug
npm run triage:incident
npm --prefix switch-bridge start
```

First confirm that CLI triage can resolve its existing login/home in that terminal. If it fails, retain the failure and its safe category, keep the current proposal unapproved and investigate the environment without changing credentials or weakening the read-only settings. A successful CLI run should replace provenance with CODEX_CLI and maintain AWAITING_APPROVAL. Then exercise the existing runtime:

| Action | Required observation | Status |
| --- | --- | --- |
| Start updated bridge | socket_open; switch_connected with subscribed true | PENDING |
| Send PING BUGBRIDGE | One existing online reply in the same room | PENDING |
| Send ASK BUGBRIDGE: Explain the task API without changing files. | One relevant existing Codex reply in the same room | PENDING |
| Send TRIAGE BUGBRIDGE INC-001 | One concise INC-001 / AWAITING_APPROVAL reply; updated validated local JSON/Markdown with CODEX_CLI provenance; no application edits | PENDING |
| Inspect generated reports | Actual 500 vs expected 400, verified source references, minimal proposal, tests listed as future checks, approvalRequired true | PENDING |
| Send TRIAGE BUGBRIDGE and TRIAGE BUGBRIDGE INC-999 | Safe rejection; no Codex run, file selection or raw-input echo | PENDING |
| Send normal conversation, other-agent mention, or quoted command | No triage execution | PENDING |
| During slow triage send PING and another ASK/triage | PING replies, second analysis gets busy response, heartbeat pong logs continue | PENDING |
| Replay the same adapter message ID in a controlled fixture | One execution/reply; reconnect replay remains suppressed | PENDING |
| Check self replies and reconnect | No reply loop; bounded reconnect; new human post works after recovery | PENDING |
| Re-run npm run test:bug | Same expected 500-vs-400 failure; no unapproved fix | PENDING |

Record real timestamps, local request counters, sanitized outcomes and Mattermost reply counts. HTTP reply acceptance alone does not prove Mattermost rendered a reply. Identical text in a new human post is a new request, not duplicate delivery.

## Known limitations and Phase 11 prerequisites

- Only INC-001 and the currently preserved source shape are supported. This intentionally fails on source drift rather than interpreting a different incident. Local reports are evidence, not tamper-proof provenance; reviewed hashes must be bound into a future approval record. Exact anchors do not prove arbitrary surrounding code is unchanged since Phase 9, which did not record source hashes. Refresh HTTP evidence before review.
- Per-file report staging/rename prevents partial individual writes, but the two files are not a transactional pair across abrupt termination or a second rename failure. A failed run must not be treated as a fresh accepted proposal; check timestamps and JSON/Markdown consistency. The JSON is the authoritative proposal.
- Paths are checked before use, assuming a trusted local workspace without a hostile concurrent filesystem writer. No claim of race-proof filesystem isolation or a complete security audit of the installed CLI is made.
- Duplicate suppression is bounded, process-local and non-durable, as in Phase 7. A restart or cache expiry may allow replay. There is no automatic reply retry/outbox.
- The real Codex child could not start model analysis here. Effective authenticated tool/config behavior and live room delivery still need the manual acceptance above. The checked-in review report therefore explicitly uses LOCAL_SOURCE_REVIEW provenance.
- File/keychain-based existing Codex login is required for the hardened invocation. API-key secrets are not inherited. Custom user model/provider settings are excluded from triage to avoid inheriting tools or integrations; incompatible setups should fail for review, not silently downgrade security.
- The application bug remains present. No proposed post-fix checks have run against an applied fix. Phase 9, smoke and Phase 10 preserve-bug acceptance policies must be explicitly reviewed in the later fixing phase.

Before Phase 11 can apply any change, it must verify an authenticated authorized human, record explicit approval bound to an immutable proposal ID/digest plus source/evidence hashes, reject stale/tampered/expired/replayed approval, enforce an exact edit scope independently of AI/chat text, provide an audit trail and rollback strategy, and run the unchanged 400 regression after the approved edit. `approvalRequired: true` and AWAITING_APPROVAL are review state, not an implemented approval service. Phase 10 has no path that turns either field into permission to edit.

Readiness: implementation is available for Phase 11 approval-mechanism development. **Ready for operational Phase 11 fixing: NO**, pending authenticated CLI/live acceptance and the separate enforced human-approval mechanism. No fixing is authorized by this document.

## Files

Created: four bridge modules (`incident-triage.mjs`, `incident-files.mjs`, `triage-contract.mjs`, `schema-validator.mjs`), `scripts/triage-incident.mjs`, three `switch-bridge/test/phase10-*.test.mjs` files, both `reports/incidents/INC-001-triage` reports, and this document.

Modified: `switch-bridge/agent-runtime.mjs`, `switch-bridge/message-handler.mjs`, `switch-bridge/codex-runner.mjs`, root `package.json`, and `switch-bridge/package.json`. The existing Phase 9 JSON/Markdown reports were refreshed by the unchanged real HTTP reproduction command. All existing application behavior is preserved.
