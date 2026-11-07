# BugBridge: approximately three-minute demo

Track: **WeMakeDevs Flip the Switch — Best Business Workflow**. Show a real incident-to-review handoff in the existing local stack. No deployment, automatic fix or verified live approval is claimed.

## Before recording

Follow [the runbook](demo-workflow.md): dependencies installed, existing Docker services healthy, one existing bridge connected, authenticated Codex available, API explicitly on 127.0.0.1:3100 after a free-port check. Run full local verification, inspect its actual result and archive the current proposal pair using the runbook's fresh history folder. Keep credentials, real participant IDs, account details and raw admin screens outside the recording. No new key, enrollment, agent, room or live session is needed.

Open three views: the existing incident room, a terminal with safe HTTP commands, and the triage Markdown/result summary. Never substitute an old/mocked response for a fresh live result. If using a previous genuine recording, label its date and provenance.

| Time | Show and do | Suggested narration |
| --- | --- | --- |
| 0:00–0:20 | Architecture and INC-001 | “BugBridge keeps the request evidence, diagnosis and reviewable proposal in the team's Mattermost workflow. Switch connects that room to our existing Node agent.” |
| 0:20–0:40 | Real health and empty-request HTTP commands below | “These empty requests should return 400. Both actually return 500; the server remains healthy. We intentionally preserve this bug.” |
| 0:40–0:55 | Send PING, observe one same-room reply; then send TRIAGE | “This is the existing Switch-connected agent. TRIAGE reads verified evidence and inspected source excerpts.” |
| 0:55–1:55 | Wait for actual Codex. While waiting, show measured evidence and real test summary | “The model runs read-only; checked evidence is distinct from AI analysis. Automated tests use explicit Switch/Codex fixtures, and this room exchange is the live part.” |
| 1:55–2:25 | Observe the fresh same-room summary and open the new proposal | “The source-supported cause is a generic throw before validation. The smallest proposed change removes that branch and unused import. Nothing has been patched.” |
| 2:25–2:45 | Show AWAITING_APPROVAL, risks and future verification plan | “A human reviews the proposal, impact and tests before any execution. Enrollment and deployed sender authentication are incomplete.” |
| 2:45–3:00 | Show readiness/disabled executor; optionally demonstrate REQUEST denial | “Unauthorized execution is prevented. Even simulated approval cannot enable fixing in this version. This is a local investigation and review demo.” |

The existing Codex timeout is 120 seconds; three minutes is a presentation target, not a latency guarantee. If slow, extend honestly. If analysis or delivery fails, show the failure and do not claim live success. A screenshot of an old report is not a new model execution.

## Exact commands and messages

HTTP terminal, API already started on 3100:

```powershell
curl.exe -i http://127.0.0.1:3100/health
curl.exe -i -X POST http://127.0.0.1:3100/api/tasks -H 'Content-Type: application/json' --data '{}'
curl.exe -i -X POST http://127.0.0.1:3100/api/tasks
```

Send separately in the existing configured `bugbridge-incidents` room; wait for replies:

```text
PING BUGBRIDGE
TRIAGE BUGBRIDGE INC-001
```

Optional ASK rehearsal before the recording, preserving the supported command without adding a long model wait to the three-minute script:

```text
ASK BUGBRIDGE: What is the expected status for an empty task creation request?
```

Optional protected-denial demonstration:

```text
REQUEST FIX BUGBRIDGE INC-001
```

Absent enrollment must produce APPROVAL_DENIED. Valid configuration with disabled/unverified identity must produce IDENTITY_UNAVAILABLE. Neither is a successful approval. Do not enter APPROVE/REJECT with fabricated challenges, enroll, sign intents or activate metadata approval for this recording.

```powershell
node scripts/check-approval-readiness.mjs
```

Inspect the actual readiness result rather than assuming proposal PASS or enrollment ABSENT. Failed or unavailable checks remain blocked. Human enrollment is incomplete and deployed sender authentication remains unverified; confirm patchExecutionEnabled false and executionEntryPointRefused true. Associate any new live claim with the observed same-room reply and matching proposal timestamp/provenance. TRIAGE consumes stored evidence, so inspect its evidence timestamp separately.

## Submission assets to add manually

- Sanitized screenshot of the real room command and corresponding reply.
- Evidence comparison (expected 400, actual 500), unapplied proposal, architecture and actual verification summary.
- Reviewed genuine video link in README; leave TODO until the asset exists.

Keep raw captures ignored/outside Git. Obtain consent and remove personal IDs/names/avatars, local profile paths, other conversations and credentials before publishing a derivative. No screenshots/video were fabricated or generated by this preparation.
