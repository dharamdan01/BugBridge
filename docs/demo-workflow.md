# Phase 13: reproducible local demo

BugBridge — WeMakeDevs Flip the Switch, Best Business Workflow. Deployment is not required. Show the business handoff from incident evidence to a structured, reviewable proposal and a protected execution boundary. Do not present automatic fixing or enrolled live approval as implemented demo behavior.

Phase 16A status: historical Phase 14 verification recorded 300 passed, 0 failed, 1 skipped; the later communication investigation recorded 278 passed, 22 failed, 5 skipped and was blocked by unavailable native checks and script-restricted enrollment cases. This publication phase ran only security tests: 11 passed, 0 failed, 0 skipped. See the [dated results](submission-checklist.md#phase-14-verification-results). The operator previously observed real Mattermost PING, ASK/Codex and TRIAGE successes in earlier sessions. A fresh latest-session TRIAGE response was not verified here; current live acceptance remains PENDING. Human enrollment remains incomplete and automatic patch execution remains disabled.

## Prerequisites and startup

Use Windows 11, normal Windows PowerShell, the existing local Docker/Mattermost/Switch deployment, Node.js (verified on v24.20.0, package requires >=22), npm and the already-authenticated Codex CLI. Open the BugBridge project root in the terminal. Existing key remains outside Git; it is not needed for triage and must not be opened, regenerated or displayed.

```powershell
node --version
npm.cmd --version
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'API dependency install failed.' }
npm.cmd --prefix switch-bridge ci
if ($LASTEXITCODE -ne 0) { throw 'Bridge dependency install failed.' }
docker ps --format '{{.Names}} {{.Status}} {{.Image}}'
if ($LASTEXITCODE -ne 0) { throw 'Use existing authorized Docker access; do not change permissions.' }
```

Run installs before the rehearsal, not while the bridge is serving a live request. Do not stop/recreate Docker, run Docker Compose up/down, register agents/rooms, use check-connection.mjs or open a second Switch session. Open Mattermost at its existing configured browser bookmark; no URL is guessed. The API demo uses **3100**, leaving the existing Gateway on its own port. A Phase 14 bind check found 3000 occupied and 3100 available; this is a point-in-time result, not a reservation.

## Existing Docker services

The inspected Switch source defines `postgres`, `mattermost`, `switch` and `gateway` in the standalone Compose variant. Its Gateway default is 3000 and core default is 8000. A different local Compose variant contains PostgreSQL/Mattermost but does not define the same complete stack. These source facts do not prove which variant/image is deployed. No Docker configuration, environment file, container or service was changed in this audit.

Keep healthy services running. If an existing long-running service is stopped, the operator can use the following exact commands from their authorized Docker terminal. Names come from actual container metadata, never guessed Compose filenames/project names. This starts only an existing stopped container; it does not create/recreate services, run init-db/setup or open a BugBridge WebSocket. Run in dependency order and confirm service health before moving to the next. If labels/access are unavailable, stop for the deployment owner; do not substitute a fresh Compose installation.

```powershell
docker ps -a --format '{{.Names}} | {{.Status}} | {{.Label "com.docker.compose.service"}}'
if ($LASTEXITCODE -ne 0) { throw 'STOP: existing authorized Docker access unavailable.' }
foreach ($bbService in @('postgres','mattermost','switch','gateway')) {
    $bbName = Read-Host ('Exact EXISTING container for ' + $bbService + '; blank to leave unchanged')
    if ([string]::IsNullOrWhiteSpace($bbName)) { continue }
    if ($bbName -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$') { throw 'Invalid container name.' }
    $bbActualService = docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' $bbName
    if ($LASTEXITCODE -ne 0 -or $bbActualService -ne $bbService) { throw 'STOP: service mapping not verified.' }
    $bbState = docker inspect --format '{{.State.Status}}' $bbName
    if ($LASTEXITCODE -ne 0) { throw 'STOP: state unavailable.' }
    if ($bbState -eq 'running') { continue }
    if ($bbState -ne 'exited') { throw 'STOP: unexpected state; deployment owner review required.' }
    docker start $bbName
    if ($LASTEXITCODE -ne 0) { throw 'STOP: existing service did not start.' }
    docker ps --filter ('name=^/' + $bbName + '$') --format '{{.Names}} {{.Status}}'
    if ((Read-Host 'After independently confirming this service is healthy, type CONTINUE') -cne 'CONTINUE') {
        throw 'STOP: dependency health not confirmed.'
    }
}
```

Docker access was unavailable under the audit agent account. These are operator instructions, not claimed executed startup/live results. Do not read `.env`, inspect container Env or print configuration/authentication headers for diagnosis. A new machine needs the owner's version-specific Switch bootstrap/registration procedure; BugBridge does not supply a second deployment.

**API terminal** (skip start if the API is already healthy on the expected loopback port):

```powershell
node --input-type=module -e "import { createServer } from 'node:net'; const s=createServer(); s.once('error',()=>{console.error('Port 3100 unavailable; stop and review.');process.exitCode=1;}); s.listen({host:'127.0.0.1',port:3100,exclusive:true},()=>s.close(()=>console.log('Port 3100 bind check passed and released.')));"
if ($LASTEXITCODE -ne 0) { throw 'STOP: port unavailable; do not stop the Gateway.' }
$env:HOST = '127.0.0.1'
$env:PORT = '3100'
npm.cmd start
```

The probe releases the port; a race can still occur before API startup. A failed actual bind is a stop, not permission to kill the other service. The application's unchanged default remains 3000, so always set PORT=3100 for this demo. Automated smoke/reproduction use ephemeral ports and do not conflict with either service.

**Bridge terminal:** if the existing agent is running, leave it running. Only when the operator has confirmed no bridge instance exists, use its normal previously configured terminal:

```powershell
if (-not $env:SWITCH_AGENT_ID -or -not $env:SWITCH_AGENT_KEY -or -not $env:SWITCH_ROOM_ID) {
    throw 'STOP: use the existing configured terminal; never print or replace credentials.'
}
# START ONLY IF NO EXISTING BRIDGE IS RUNNING.
npm.cmd --prefix switch-bridge start
```

The bridge currently uses its existing local Switch endpoint. Do not alter source/credentials to adapt this runbook. No environment file is required for the REST API. Codex login must already work; do not record login/authentication screens or print credential values. Safe bridge counters such as switch_connected/codex_started/codex_completed/reply_sent corroborate activity without showing raw frames, IDs or headers.

## Preflight tests — before recording

Only the previously authorized temporary Process RemoteSigned setting is used below. Defined MachinePolicy/UserPolicy is a stop for review; this does not override Group Policy or change registry/permanent policy. Run this in a separate verification terminal, not the agent's running terminal:

```powershell
Get-ExecutionPolicy -List
$bbPolicy = @(Get-ExecutionPolicy -List | Where-Object {
    $_.Scope -in @('MachinePolicy','UserPolicy') -and $_.ExecutionPolicy -ne 'Undefined'
})
if ($bbPolicy.Count -gt 0) { throw 'STOP: policy owner review required; native checks BLOCKED.' }
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force -ErrorAction Stop
if ((Get-ExecutionPolicy) -ne 'RemoteSigned') { throw 'STOP: temporary policy not effective.' }
npm.cmd run verify:local
if ($LASTEXITCODE -ne 0) { throw 'STOP: local verification failed or was blocked. Run the reported suite directly.' }
node scripts/check-approval-readiness.mjs
```

Closing this verification terminal ends that Process policy. Never use Bypass/Unrestricted or Unblock-File indiscriminately. `verify:local` saves new evidence separately and keeps the canonical reviewed reports unchanged. Normal tests must pass; the existing Restricted-host-only test can skip under RemoteSigned and is disclosed. The verifier separately requires five actual native ACL success records (owner-only creation/verification, secure parent, inherited ACL rejection, unauthorized parent rejection and non-owner access rejection); skipped/missing native cases produce FAILED_OR_BLOCKED, not completion. Do not sum repeated focused test runs into the total.

## Five-minute presentation

For the submission recording, use the tighter [approximately three-minute script](demo-script.md). The detailed rehearsal steps below remain useful for preparation.

1. **Problem/business handoff (30 s):** show INC-001, expected 400 versus measured 500 and the cost of an ambiguous incident handoff. No measured business loss/frequency is claimed.
2. **Real HTTP evidence (45 s):** in a separate API terminal, run:

   ```powershell
   curl.exe -i http://127.0.0.1:3100/health
   curl.exe -i -X POST http://127.0.0.1:3100/api/tasks -H 'Content-Type: application/json' --data '{}'
   curl.exe -i -X POST http://127.0.0.1:3100/api/tasks
   ```

   Expected observations: health 200; both empty requests 500 INTERNAL_ERROR. Automated evidence additionally proves valid 201, unchanged storage and healthy recovery. Do not say the bug is fixed.
3. **Preserve the current proposal before live TRIAGE (15 s):** run from project root. This copies only the two public proposal reports into a fresh history folder; no deletion, private enrollment copy or evidence refresh occurs:

   ```powershell
   $bbArchiveName = 'demo-before-triage-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N')
   $bbArchive = Join-Path (Join-Path (Get-Location).Path 'reports\history') $bbArchiveName
   New-Item -ItemType Directory -Path $bbArchive -ErrorAction Stop | Out-Null
   Copy-Item -LiteralPath '.\reports\incidents\INC-001-triage.json' -Destination $bbArchive -ErrorAction Stop
   Copy-Item -LiteralPath '.\reports\incidents\INC-001-triage.md' -Destination $bbArchive -ErrorAction Stop
   ```

4. **Live Mattermost investigation (90 s):** use the existing configured `bugbridge-incidents` room. Send each separately, waiting for completion:

   ```text
   PING BUGBRIDGE
   ASK BUGBRIDGE: What is the expected status for an empty task creation request?
   TRIAGE BUGBRIDGE INC-001
   ```

   TRIAGE invokes actual Codex on the verified evidence/excerpts. It does not execute new HTTP tests or an open-ended autonomous repair. Wait for the fresh same-room summary; allow the existing 120-second Codex timeout. If busy, wait; do not spam retries. If it fails, show the failure honestly and use the local test/evidence explanation; never paste a synthetic response as live output. `--source-review` is an explicitly local-review mode, not an AI fallback for this presentation.
5. **Human review (45 s):** show the fresh `reports/incidents/INC-001-triage.json`/`.md`: evidence timestamp and hash, observed/expected status, generic error before validation, minimal proposed removal, risk and regression plan. Check generatedAt and rootCause.analyst; actual live AI output should be CODEX_CLI. At the Phase 16A review the on-disk report records CODEX_CLI, while older local-review reports record LOCAL_SOURCE_REVIEW. An existing provenance field alone does not establish a fresh model invocation or same-room delivery; associate any new live claim with the newly observed reply and matching report.
6. **Protected handoff (30 s):** explain current AWAITING_APPROVAL, incomplete human enrollment, unverified deployed sender metadata and disabled executor. Optional live denial message:

   ```text
   REQUEST FIX BUGBRIDGE INC-001
   ```

   Expect APPROVAL_DENIED without enrollment, or IDENTITY_UNAVAILABLE if a valid configuration exists but transport authentication is disabled. Do not send APPROVE/REJECT with invented challenges, sign an intent, enroll or activate approval for this demo. In tests, even a valid synthetic APPROVED record cannot patch code.
7. **Close with evidence (30 s):** show the real verification summary, then:

   ```powershell
   node scripts/check-approval-readiness.mjs
   npm.cmd run test:bug
   # The last command intentionally exits 1: both requests still return 500.
   ```

   Inspect the actual safe readiness fields rather than assuming current enrollment or ACL status. The intended boundary is human PENDING, Switch identity unverified/disabled, patchExecutionEnabled false and executionEntryPointRefused true; unavailable integrity/native checks remain blocked. Earlier readiness recorded enrollment ABSENT, while this review treats human enrollment as incomplete. Deployment and automatic fixing are not required or claimed.

## Recording and submission checklist

- Record a fresh continuous local rehearsal: real room command → safe activity counters → same-room result → corresponding timestamped reports. Manual checklist in `end-to-end-verification.md` remains pending until observed.
- Capture: architecture diagram, real HTTP comparison, fresh triage response, unapplied proposal and actual test summary. No screenshots/recording were created automatically in this task. Do not represent test fixtures or old screenshots as fresh live evidence.
- Use an operator-reviewed capture crop; hide avatars, account/participant IDs, profile paths, other rooms, private task data, environment settings and authentication screens. Raw captures/HAR/logs remain outside Git or in ignored `demo-captures/`; publish only a reviewed sanitized derivative with consent.
- README now provides architecture, scope, local setup, reproducibility, commands, safety boundaries and known limitations. Add the reviewed actual demo recording/screenshots and required hackathon submission links/fields before publication. Do not invent URLs, deadlines, prizes or evaluation claims.
- Deployment is not a blocker. Git history/index verification, privacy review and fresh live rehearsal/recording remain publication prerequisites. Deployed identity verification/enrollment are blockers for live approval/Phase 11B, not for the triage/review-only demo.
