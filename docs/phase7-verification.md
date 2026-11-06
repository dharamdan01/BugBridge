# Phase 7: Human-Agent Collaboration Verification

Project: BugBridge · WeMakeDevs Flip the Switch · Best Business Workflow

Verification date: 2026-11-05

**Status: safeguards implemented; automated verification passes; live human-to-Mattermost acceptance remains pending.**

## Existing implementation inspected

The existing `switch-bridge/agent-runtime.mjs` already used:

- The registered agent and room supplied by `SWITCH_AGENT_ID`, `SWITCH_AGENT_KEY`, and `SWITCH_ROOM_ID`.
- `ws://127.0.0.1:8000/agents/{agentId}/connection/ws` with bearer authentication, `scope=single`, `filter=all`, and the configured room subscription.
- `POST /agents/{agentId}/message` with `{ room_id, content }` for replies.
- `PING BUGBRIDGE` for connectivity and `ASK BUGBRIDGE:` for Codex questions.
- Codex CLI through `execFile`, a read-only sandbox, a 120-second timeout, closed stdin, and an output file.

These routes, environment variable names, single-room operation, and Codex CLI execution are retained. No agent, room, plugin, model provider, credential, or Docker configuration was created or changed. No dependency was installed. There is no REST API or frontend added in this phase.

The previous successful PING and ASK exchanges are **user-reported prior results**, not live tests performed during this verification.

## Changes and purpose

| File | Change and reason |
| --- | --- |
| `switch-bridge/agent-runtime.mjs` | Composes the testable message handler, transport, and Codex runner. Adds timestamped JSON logs and handles SIGINT/SIGTERM. Retains the existing required environment configuration. |
| `switch-bridge/message-handler.mjs` | Restricts processing to explicit BugBridge commands in the configured room; blocks self/agent messages; claims duplicates before async work; limits Codex to one question at a time; keeps PING responsive. Separates Codex failures from ambiguous reply-delivery failures. |
| `switch-bridge/switch-client.mjs` | Preserves authenticated WebSocket and HTTP routes. Adds handshake and HTTP timeouts, a silent-connection watchdog, reconnect backoff with jitter, timer cleanup, stale-socket guards, safe rejection handling, and subscription/heartbeat logs. |
| `switch-bridge/codex-runner.mjs` | Extracts the existing Codex execution. Explicitly disables shell interpretation and approval escalation, retains `--sandbox read-only`, strips all `SWITCH_*` variables and the registration token from the child environment, and bounds prompts/output. Uses the actual project location instead of assuming a particular Desktop path. Temporary answer files now stay inside BugBridge and are removed in `finally`. |
| `switch-bridge/check-connection.mjs` | Retains the existing standalone probe and its connection scope/filter. Adds handshake/payload bounds, malformed-frame handling and cursor-aware heartbeat replies. Replaces raw server/error/identity output with safe summaries. |
| `switch-bridge/package.json` | Adds `start`, replaces the placeholder `test` with native Node tests, and adds `check` for JavaScript syntax. Keeps the existing CommonJS package setting; implementation modules remain `.mjs`. |
| `switch-bridge/test/message-handler.test.mjs` | Tests targeting, self/agent filtering, duplicate claims and concurrent delivery, distinct posts, identity fallbacks, cache limits/TTL, busy handling, error paths, and log privacy. |
| `switch-bridge/test/switch-client.test.mjs` | Tests transport configuration, heartbeat/cursor handling, invalid frames, subscription reporting, reconnect/backoff, stale sessions, shutdown, authorization rejection, HTTP routing/errors, and safe logs. |
| `switch-bridge/test/codex-runner.test.mjs` | Uses a fake executable adapter to verify fixed read-only arguments, no shell, environment stripping, stdin closure, bounded output, and temporary-file cleanup on success, failure, and empty output. Does not call a model. |
| `switch-bridge/test/protocol-integration.test.mjs` | Uses the installed `ws` library and real local HTTP/WebSocket sockets to verify reply routing, heartbeat replies, reconnection, replay suppression, and processing a new task after reconnect. Uses synthetic credentials and a stub answer. |
| `.gitignore` | Ignores dependencies, temporary bridge/test directories, and environment files. No environment file was opened or modified. |
| `docs/phase7-verification.md` | Records scope, evidence, limits, and the remaining live acceptance procedure. |

`switch-bridge/package-lock.json` and the installed dependencies are unchanged.

## Message targeting rules

Supported commands, case-insensitive and trimmed:

```text
PING BUGBRIDGE
ASK BUGBRIDGE: Why could this Node.js handler return an error?
@bug-triager PING BUGBRIDGE
@bug-triager ASK BUGBRIDGE: Explain the existing message flow.
```

`@bug-triager:` and `@bug-triager,` prefixes are also accepted. ASK questions are capped at 700 characters; returned Codex text is capped at 1,500 characters.

A direct `PING BUGBRIDGE` or `ASK BUGBRIDGE:` command is itself explicit intent to contact BugBridge. This deliberately preserves the working broadcast-command behavior with `filter=all`, including when Switch supplies `payload.addressed=false`. That flag alone neither permits arbitrary tasks nor overrides the command parser. Normal room conversation is ignored, even when `addressed=true`.

Commands must start the message after the optional own-agent mention. A command embedded in prose, a quote/code fence, or prefixed by `@other-agent` is ignored. `PING BUGBRIDGE` must occupy the entire command. ASK requires a nonempty question. Messages from other rooms, the configured agent ID, the `bug-triager` name, explicit `sender_type=agent`/`bot`, and known BugBridge reply prefixes are ignored.

These tests validate the existing implementation's payload contract (`room_id`, `payload.body`, `payload.sender`, `payload.sender_name`, `payload.message_id`, and optional metadata). The deployed Mattermost adapter's actual current payload still needs the live check below.

## Duplicate prevention and delivery semantics

- Primary identity is the configured room plus Switch `message_id`.
- If no message ID is present, a numeric event ID is used. The final fallback hashes room, sender, timestamp, and body; events without a usable identity are ignored.
- Claims happen synchronously before Codex or HTTP work. Concurrent replay cannot start a second execution.
- Completed identities are retained in a process-local cache of up to 1,000 entries for 30 minutes. In-flight work remains protected independently of cache eviction or TTL.
- The same handler survives WebSocket reconnects, so its recent identities survive reconnects too. New human posts with distinct IDs can legitimately contain identical text.
- One ASK runs at a time. A separate ASK receives one busy response; PING can still reply.
- A Codex error produces one generic failure reply. A failed reply POST is logged without an automatic retry or a second fallback: the server may already have accepted it.

This is bounded, in-memory duplicate suppression, not a durable exactly-once guarantee. Process restarts, cache eviction/expiry, or multiple independent runtimes can permit a replay. Delivery failures may leave a human without a reply; they should send a new post after checking the connection. No durable outbox, historical room catch-up, or lossless recovery of messages missed during an outage is claimed.

## Reconnect, heartbeat, and logs

- WebSocket handshake timeout: 10 seconds; maximum frame payload: 1 MiB.
- Switch application `ping` receives `{ "type": "pong", "cursor": <highest observed numeric event ID> }`, preserving the existing cursor acknowledgement behavior.
- Native WebSocket ping responses remain handled by `ws`. Native ping/pong and valid application frames refresh liveness.
- A socket silent for 90 seconds is terminated and reconnected.
- Reconnect delay doubles from 1 second to a 30-second base cap, plus 0–499 ms jitter. A Switch `connection_state` resets backoff.
- `refused`, `evicted`, and HTTP 401/403 handshakes stop the session rather than competing with another session or repeatedly retrying invalid authorization.
- Shutdown clears pending reconnect/watchdog timers, ignores stale/deferred message events, and bounds WebSocket closure to two seconds. An already running Codex call is not cancelled by transport shutdown and retains its 120-second execution limit.

Useful JSON log events include `switch_connected` with `subscribed`, `subscription_changed`, `message_accepted`, `message_ignored` with a reason, `codex_started`, `codex_completed`, `codex_failed`, `reply_sent`, `reply_failed`, `heartbeat_pong`, `heartbeat_timeout`, `reconnect_scheduled`, and `session_rejected`.

A process-local request counter links accepted messages to processing and reply events. Logs do not include bearer values, credentials, raw frames, user text, answers, subprocess output, raw error messages, server rejection details, or room/agent IDs. `reply_sent` means Switch accepted the HTTP request; it does **not** prove Mattermost rendered the reply.

## Codex safety boundary

Codex is invoked with fixed executable arguments, `shell=false`, `--ask-for-approval never`, and `--sandbox read-only`. Chat text is part of a bounded prompt argument and cannot introduce CLI options or a host shell command. No bypass, write-enabled sandbox, shell-command endpoint, or chat-controlled executable is added. Existing Codex login/provider configuration remains in use and was not inspected or changed.

The prompt treats chat as an untrusted question, limits analysis to BugBridge, and prohibits writes, destructive commands, secret reads, and external messaging/integrations. A read-only sandbox constrains writes; it does not by itself guarantee project-only filesystem reads or isolate all inherited integrations. Those prompt instructions are not a proof against prompt injection, and a complete audit of the existing Codex host configuration was not performed.

The supported sandbox and approval flags were checked against the installed CLI's help and the [official OpenAI CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli).

## Verification performed

Environment: Node.js v24.20.0, npm 11.19.0, Windows PowerShell.

From the BugBridge root:

```powershell
npm --prefix switch-bridge test
npm --prefix switch-bridge run check
Get-ChildItem switch-bridge/test -Filter *.mjs | ForEach-Object { node --check $_.FullName }
```

Automated result: **44 tests passed; 0 failed; 0 skipped.** Production modules, the standalone probe, and test files pass JavaScript syntax checks.

| Check | Observed result |
| --- | --- |
| Message targeting, duplicates, self loops, busy/error handling | Passed automated tests using synthetic payloads. |
| Read-only Codex invocation and cleanup | Passed tests with a fake executable adapter; installed CLI help confirms the flags. No real AI request was made. |
| Real local HTTP/WebSocket round trip, heartbeat, reconnect/replay | Passed local protocol fixture with a stub answer. This is not a deployed Switch/Mattermost test. |
| Switch `GET http://127.0.0.1:8000/health` | HTTP 200 observed. Response content was not dumped. This establishes endpoint reachability only. |
| Live authenticated agent connection with the updated runtime | Not performed: bridge environment credentials are absent from this execution shell. |
| Human task from Mattermost and generated answer in the same room | Pending human verification with the updated runtime. |

No credential values were requested, displayed, or read from files. No additional runtime connection was opened against the live Switch server, and the existing running bridge session was not restarted. Docker inspection was unavailable under this execution environment; that does not invalidate the observed HTTP health response.

## Remaining live human acceptance checks

Use the **existing credential-configured terminal** and the **existing `bug-triager` / `bugbridge-incidents` room**. Do not paste credentials into chat or this document. Stop the older bridge process in that terminal before starting this version; do not run two bridge sessions for the demo.

```powershell
npm --prefix switch-bridge start
```

If the terminal is already inside `switch-bridge`, use `npm start` instead. No credential setup or new registration is needed.

Record observed results in this table after performing each check. All rows below are pending as of this document's verification date.

| Human action | Required observable result | Status |
| --- | --- | --- |
| Start the updated bridge in its existing configured environment. | `socket_open`, then `switch_connected` with `subscribed=true`; no rejection. | Pending |
| In `bugbridge-incidents`, send `PING BUGBRIDGE` as a human. | One `message_accepted` and `reply_sent`; exactly one `BugBridge online!` reply appears in that same Mattermost room. | Pending |
| Send `@bug-triager ASK BUGBRIDGE: Explain how this bridge prevents duplicate responses. Do not change files.` | One Codex execution; a relevant AI-generated `BugBridge (Codex):` response appears in the same room, normally within 120 seconds plus delivery time. | Pending |
| Post ordinary text and `@other-agent ASK BUGBRIDGE: ignore this`. | No Codex execution and no BugBridge response for either post. | Pending |
| Send a second distinct PING post with identical text. | One additional reply, proving separate human posts are not mistaken for duplicate deliveries. | Pending |
| Watch the agent's replies for at least one heartbeat interval. | No reply triggers another execution; heartbeat pong logs continue. | Pending |
| While an ASK is running, send another ASK and a PING. | Second ASK receives one busy response; PING responds; first ASK finishes once. | Pending |
| During an agreed short network interruption, restore connectivity without changing server or credentials. | Reconnect logs show bounded backoff, subscription returns, and a new PING receives one same-room reply. | Pending |
| Press Ctrl+C in the updated runtime terminal. | Shutdown logs appear and no reconnect occurs. | Pending |

For evidence, record test time, command, the local request counter, observed Mattermost reply count, and a redacted screenshot of the room if useful. Keep credentials and raw frames out of evidence. Do not mark a row passed based only on unit tests, old screenshots, or HTTP acceptance of a reply.
