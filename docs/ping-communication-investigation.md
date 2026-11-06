# Mattermost PING communication investigation

Status: **root cause UNVERIFIED; Phase B diagnostics prepared; functional fix and live verification PENDING.** No live agent connection was opened, stopped, replaced or restarted. No Docker, database, credentials, enrollment, permissions or execution policy were changed. No push or deployment occurred.

## Evidence and limits

The operator reports successful API health and an existing bridge logging `connecting`, `socket_open`, and `switch_connected` with `subscribed=true` after four existing containers restarted. A subsequent Mattermost PING had no visible reply. These observations establish API health and reported Switch subscription acceptance at that moment; they do not establish delivery of the PING to BugBridge or delivery of its reply to Mattermost.

Inspected `agent-runtime.mjs`, `message-handler.mjs`, `switch-client.mjs`, `codex-runner.mjs`, protocol/routing/reconnect/command/approval tests and existing configuration/runbooks. No Switch checkout is included in this workspace or identified by the operator yet. Historical source findings in `phase11-identity-mapping.md` describe the Mattermost adapter and collaboration routing, but are not a fresh source inspection or evidence of the deployed build. Docker engine and process metadata inspection returned access denied. No existing-runtime event trace around the failed PING was available to this investigation.

| Message stage | Inspected behavior / evidence | Current live conclusion |
| --- | --- | --- |
| Mattermost to Switch collaboration adapter | Historical source investigation describes `posted` handling, actor resolution and intentional bot/service-account exclusions. | PENDING current source/runtime evidence. Do not bypass account exclusions. |
| Collaboration routing to agent subscription | Client requests existing agent, `scope=single`, `filter=all`, configured room. Operator reports `subscribed=true`. | Subscription acknowledgement alone does not establish message delivery or correct external-channel mapping. |
| Agent frame to handler | Accepts JSON frames with `event=message`, dispatches `frame.data` and `frame.id`, rejects stale sockets and contains handler errors. | PENDING existing-runtime trace; incompatible event names/schema remain possible. |
| Command recognition | Exact same-room `PING BUGBRIDGE`, `ASK BUGBRIDGE: ...`, `TRIAGE BUGBRIDGE INC-001`; filtering and synchronous duplicate claims precede work. | Local tests pass; no proof that the failing post reached this stage. |
| Reply to Switch | Authenticated POST to existing agent `/message`, configured `room_id`, 15-second bound. Delivery failure does not retry. | PENDING live attempt/result. HTTP success is only Switch acceptance. |
| Switch to Mattermost | External collaboration bridge delivers the accepted response. | PENDING server trace and observed same-room rendering. |

Heartbeat, watchdog, reconnect backoff, stable in-process connection ID, observed cursor pongs, stale-frame guards and duplicate suppression pass local tests. The cursor starts at zero on process start, advances monotonically in-process, and is sent in application pongs; no resume query is added by this client. Without the actual server contract and failed-message trace, none of those facts justifies resetting a cursor or changing reconnection. Startup timing, room binding, missing acknowledgements, schema differences and adapter recovery have not been ruled out on the deployed system.

## Prepared diagnostics only

`switch-client.mjs` adds `inbound_received` when the current socket decodes a `message` event, before dispatch. `message-handler.mjs` adds `inbound_filtered` with existing fixed reason codes, `command_recognized` with a local request counter and command category, `reply_attempted`, and `reply_succeeded`. Existing `reply_failed` remains. Existing log events remain compatible with current tests and observers.

No message content, IDs, frame objects, credentials, headers, private paths or exception details are added to logs. `reply_succeeded` means the Switch HTTP request succeeded, **not Mattermost delivery**. There is no change to command matching, filters, identity verification, allowlists, registration, deduplication, cursor handling, heartbeat, retries or approval behavior. The running process has not loaded these changes.

Four new diagnostic tests cover active/stale frame visibility before dispatch, recognition/attempt/success order, filtering reasons and privacy, and failed-reply privacy without retries. These are diagnostic regression tests, **not a reproduction or repair of the unidentified live failure**.

## Actual local verification

Final normal-suite results, counting each test once (baseline and focused reruns are not added):

| Suite | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| API | 46 | 0 | 0 |
| Investigation | 15 | 0 | 0 |
| Bridge protocol/routing/reconnect/cursor, PING/ASK/TRIAGE, approval and local E2E | 145 | 0 | 0 |
| Approval setup / native ACL | 60 | 0 | 5 |
| Enrollment fixtures | 1 | 22 | 0 |
| Submission | 11 | 0 | 0 |
| **Total normal tests** | **278** | **22** | **5** |

The unchanged full verifier was run after the diagnostic edits and stopped at its required native ACL gate: 266 passed, 0 failed, 5 skipped. Its actual artifact is [verification.json](../reports/local-demo/2026-11-06T19-19-34-218Z-84d7ecdf-1c78-4814-b2f0-64ff104a0a5e/verification.json). Enrollment and submission were then run separately together: 34 tests, 12 passed, 22 failed, 0 skipped. Enrollment failures occur in PowerShell integration cases under this host's script restrictions; a focused repeat of the first failing case confirmed an `UnauthorizedAccess` policy-blocked script diagnostic. No execution policy was changed to force success. Native ACL skips and enrollment failures prevent a full verification PASS.

Separately, the intentional HTTP-400 regression ran: **0 passed, 1 failed, 0 skipped**, with both empty-input variants returning `500 INTERNAL_ERROR` instead of `400 VALIDATION_ERROR`. This is excluded from the normal-suite totals. API smoke passed (health, CRUD and recovery, preserved HTTP 500). All 61 JavaScript files passed syntax checks; bridge package syntax checks also passed. The submission scanner reported no selected secret-pattern findings or personal-reference locations; Git metadata/history is unavailable here.

All Switch peers and Codex calls in these tests are fixtures. No real Codex invocation or live Mattermost delivery is claimed. Approval implementation and execution gate are unchanged; approval-security tests pass, and patch execution remains disabled. Native production enrollment/ACL readiness was not established by this run.

## Operator: read-only next steps first

Run from the BugBridge root in the normal authorized terminal. These commands open no WebSocket and print no command lines, environment variables or credentials:

```powershell
docker inspect --format '{{.Name}} status={{.State.Status}} started={{.State.StartedAt}} restarts={{.RestartCount}}' switch-server-postgres-1 switch-server-switch-1 switch-server-mattermost-1 switch-server-gateway-1
if ($LASTEXITCODE -ne 0) { throw 'Existing Docker read access unavailable.' }

$bbBridgeProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $_.Name -eq 'node.exe' -and $_.CommandLine -match '(?:^|[\\/\s"])agent-runtime\.mjs(?:["\s]|$)'
})
$bbBridgeProcesses | Select-Object ProcessId, CreationDate
if ($bbBridgeProcesses.Count -ne 1) { throw 'Expected exactly one existing bridge; do not start another.' }
```

Provide the existing Switch checkout location and only the existing bridge's sanitized event names, reason codes, request counters and booleans around the previously failed PING. Inspect these in its original terminal; do not dump raw Docker logs, command lines or private messages. Preserve useful `heartbeat_pong`, subscription/reconnect and handler/reply events. Do not resend commands merely to collect repeated failures. Confirm locally that the originating account is the intended human, rather than the Mattermost bridge service/bot account; historical source findings say service/bot posts can be intentionally excluded. No permissions or identity checks should be altered.

## Operator: optional single restart to load diagnostics

Restart is required **only to load the prepared diagnostics**. This is not a verified repair. It was not performed by this investigation. First retain the existing sanitized trace. Wait for any ASK/TRIAGE to finish. In the original bridge terminal press **Ctrl+C once**, then wait for `shutdown_requested`, `connection_stopped`, and the shell prompt. Leave the REST API and Docker services running.

In that same, already configured terminal, from the BugBridge root:

```powershell
$bbRemainingBridges = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $_.Name -eq 'node.exe' -and $_.CommandLine -match '(?:^|[\\/\s"])agent-runtime\.mjs(?:["\s]|$)'
})
if ($bbRemainingBridges.Count -ne 0) { throw 'Existing bridge has not stopped; do not start a replacement.' }
if (-not $env:SWITCH_AGENT_ID -or -not $env:SWITCH_AGENT_KEY -or -not $env:SWITCH_ROOM_ID) {
    throw 'Use the existing configured terminal; do not print or replace credentials.'
}
npm.cmd --prefix switch-bridge start
```

Wait for one `switch_connected` with `subscribed=true`. A missing subscription, rejection or repeated reconnect is a reason to investigate, not start another process. Never run `check-connection.mjs` alongside the runtime.

## Single-connection live verification

1. In the existing `bugbridge-incidents` channel, send `PING BUGBRIDGE` once as the intended human. Observe exactly one same-room online reply and collect only the safe diagnostic events. If no reply, stop the sequence and use the table below.
2. Only after PING works, send `ASK BUGBRIDGE: Explain why an empty task creation returns HTTP 500 in this project.` once. Wait up to the configured 120-second Codex timeout plus reply delivery. Require `codex_started`, `codex_completed` and the actual same-room Codex answer; a fixture or fallback is not success. Do not invoke Codex separately.
3. After ASK completes, send `TRIAGE BUGBRIDGE INC-001` once. Require actual Codex completion, a fresh report timestamp/provenance, and same-room incident analysis showing observed 500, expected 400, human approval required and no fix applied. Review generated JSON/Markdown locally; do not publish private contents. Do not count a stale report as new analysis.
4. Do not send approval/signing/enrollment commands. Verify the execution constant remains false and review the unchanged approval security boundary. No automatic patch should occur, including after simulated approval. The intentional API bug must remain.

| Last observed safe event | Investigation boundary |
| --- | --- |
| Subscription/heartbeats, no `inbound_received` | No decoded `message` frame observed by this client; inspect upstream adapter/channel mapping/server routing/event schema through existing authorized read access. Socket liveness alone cannot select among them. |
| `inbound_received`, then `inbound_filtered` | Handler received the event; use the fixed reason to investigate room/schema/target/self filtering or stable-message deduplication. Never reset cursors or weaken identity checks to bypass it. |
| `inbound_received`, no handler decision | Check existing `message_handler_failed`, shutdown and reconnect events for dispatch cancellation or handler failure. |
| `command_recognized`, `reply_attempted`, `reply_failed` | Switch reply HTTP operation did not complete successfully. Review safe server-side operation status; a timeout may still have delivered, so do not retry automatically. |
| `reply_succeeded`, no visible reply | Switch accepted HTTP; inspect Switch outbound collaboration delivery and the existing Mattermost room view. This event does not prove rendering. |

Live Mattermost verification: **PENDING**. Functional root-cause repair remains pending the missing source/runtime evidence. No unsupported transport fix has been applied.
