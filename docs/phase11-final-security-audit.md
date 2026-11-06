# Phase 11A: final Switch sender-security audit

Publication note (Phase 14): personal checkout paths were replaced with operator-supplied paths. Historical observations, counts and incident evidence are unchanged; older procedures are not current activation instructions.

Audit date: 2026-11-06. **Enrollment and live Mattermost approval remain blocked.** No key was read/regenerated, no human was enrolled, no Switch socket was opened, and no deployment, database record, permission or application fix was changed.

## Evidence and limits

The operator reports all eight database mapping checks TRUE: ReadOnlyDiagnostic, AgentRegistrationMatches, AgentRoomMatches, MattermostAccountMatches, SameTenant, SameBridge, CorrectClientTypes, ParticipantIdsPresent. This establishes the reported stored mapping, not live sender authentication. The production key/ACL result is also operator-reported; this audit did not access the key.

Source at the operator-provided local Switch source checkout is readable. Its `core/pyproject.toml` declares 0.31.0. Docker configuration/engine access is denied under this agent account, so the running image ID, installed version, build commit, live payload and Mattermost account classification were **not verified**. No permission, Git trust or credential change was attempted. Matching a checkout version or selected source hashes alone would not prove the running process uses identical code.

### Inspected identity path

- `core/switch_core/bridges/collaboration/mattermost/adapter.py`, `_ws_handler` (2754 onward): takes `post.user_id` from the Mattermost server event; it does not parse an identity from chat. Bridge bot/admin identities are filtered. Account lookup, webhook and bot flags influence `sender_is_app`; webhooks use a separate stand-in identity. However, account lookup initializes `user_is_bot=False` and a failed lookup leaves that default. This is a source-level classification limitation, not evidence that any deployed account is human.
- `bridges/collaboration/collaboration_core.py`, `_ensure_human_in_room` / `_create_human_actor_locked`: bridge plus immutable external account ID resolves `ExternalUser.client_id`. `db/models.py` maps that Client to the stored wire ID via physical `clients.matrix_user_id`. The agent registration separately maps `agents.client_id` to its Client. Display names, room membership and `client_type=user` do not prove human control.
- `transport/postgres.py`: writes the sender from the bound transport identity. `bridges/agent/protocol/message_events.py:41` copies `event.sender` into the wire payload. `delivery/recipient.py` calls this builder and serializes the resulting event.
- `bridges/agent/protocol/types.py:219` documents optional `sender_kind` (`user`, `agent`, `platform`); it does not define `sender_type`. The inspected live-message builder initializes kind to None, and only sets it for platform events (lines 63–80). Thus ordinary messages from this source path do **not** establish a canonical human kind. History/telemetry classification elsewhere does not establish the live message contract.

**Contract compatibility: FAIL for live metadata approval until the actual deployment supplies independently validated human classification.** Client tests of a synthetic `sender_kind=user` payload prove client handling only. Do not enable metadata approval to accommodate a null/missing kind. Do not edit/redeploy Switch as part of this audit.

### Verified client defect and correction

Previously, BugBridge bound optional `sender_type` but ignored canonical `sender_kind`. New synthetic tests initially produced 10 failures out of 16, including an allowlisted ID carrying `sender_kind=agent` recording a decision. This was a reproducible client implementation defect, not a live production approval.

`switch-bridge/approval-protocol.mjs` now snapshots `sender_kind` at receipt in the private transport WeakMap, rejects post-receipt mutations, requires exactly `user`, and rejects conflicting legacy `sender_type`. Missing, agent, bot, platform and unknown kinds fail closed. The existing deployment-enable gate, transport provenance, exact room/agent, message binding, explicit allowlist and self-approval exclusions remain required. Canonical kind alone grants no authority. Signed-local Ed25519 verification is unchanged. A positive message-test fixture now supplies the canonical field; no assertions were removed.

### Why `is_bot UNKNOWN` is unresolved

The [upstream Mattermost User model](https://raw.githubusercontent.com/mattermost/mattermost/master/server/public/model/user.go) declares `is_bot` with `omitempty`. An omitted JSON field can therefore represent false in that model. This is a possible explanation, not proof of the deployed version, account type or account control. Never promote UNKNOWN to an authorized human.

New `scripts/audit-mattermost-account.mjs` discovers the actual visible Users table/column names in the existing Mattermost PostgreSQL database, then reads only `is_bot`, active status and account-ID-match booleans. Both transactions are READ ONLY and ROLLBACK. It requires a single unambiguous schema and account with actual boolean values; missing/ambiguous/unknown results fail closed. It uses existing access with `psql -X -w`, quoted psql values, bounded subprocess time/output, explicit stdin EOF, no shell and an OS-only child environment. It prints no account/participant IDs or raw database errors. No role, permission, session or record is created.

`NON_BOT_ACTIVE_ACCOUNT_RECORD` is account classification only. Independent authenticated account control, the eight mappings, correct tenant/bridge, webhook handling and deployed sender contract must still be verified. A nonbot account may be automated or compromised. No automatic authorization or configuration write occurs.

## Read-only operator commands — simple Hinglish

Apne normal configured PowerShell terminal mein chalayein. Existing agent terminal/socket ko running rehne dein. Koi token, private key, `.env`, full Docker inspect, raw logs ya authentication header share na karein. Signing key pehle se hai: provisioning dobara mat chalayein.

### 1. Existing container aur build identify karein

```powershell
Set-Location -LiteralPath (Read-Host 'Absolute path to your BugBridge checkout')
docker ps --format '{{.Names}} {{.Image}}'
if ($LASTEXITCODE -ne 0) { throw 'STOP: existing Docker access unavailable.' }
$bbCoreContainer = Read-Host 'Existing running Switch core container ka exact name'
docker inspect --format '{{.Image}} {{.State.StartedAt}}' $bbCoreContainer
if ($LASTEXITCODE -ne 0) { throw 'STOP: container metadata unavailable.' }
docker inspect --format '{{range .Mounts}}{{println .Type .Destination .RW}}{{end}}' $bbCoreContainer
if ($LASTEXITCODE -ne 0) { throw 'STOP: mount review unavailable.' }
$bbImageId = docker inspect --format '{{.Image}}' $bbCoreContainer
if ($LASTEXITCODE -ne 0) { throw 'STOP: immutable image ID unavailable.' }
docker image inspect --format '{{.Id}} {{json .RepoDigests}}' $bbImageId
if ($LASTEXITCODE -ne 0) { throw 'STOP: image provenance unavailable.' }

@'
import importlib.metadata, json, os, re
try:
    version = importlib.metadata.version('switch-core')
except importlib.metadata.PackageNotFoundError:
    version = None
candidate = os.environ.get('SWITCH_GIT_COMMIT', '').strip().lower()
commit = candidate if re.fullmatch(r'[0-9a-f]{7,40}', candidate) else None
print(json.dumps({'installed_version': version, 'build_commit': commit}))
'@ | docker exec -i $bbCoreContainer python -
if ($LASTEXITCODE -ne 0) { throw 'STOP: installed build metadata unavailable.' }
$bbSwitchSource = Read-Host 'Absolute path to the existing Switch source checkout'
git -C $bbSwitchSource rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'STOP: checkout owner/build provenance review required.' }
```

Yeh `docker exec` sirf standard-library Python chalata hai; Switch application import/start ya WebSocket create nahi karta. Missing interpreter/version/commit ko UNKNOWN rakhein. Full environment ya arbitrary image labels dump na karein. Git ownership refusal par safe.directory change na karein; actual repository owner se review karayein.

Critical source-file hash comparison ke exact commands [identity investigation](phase11-identity-mapping.md) mein hain. Build commit/image provenance, source correspondence, code-overriding mounts, running-process start/release records aur live event contract ko saath review karein. Hash equality alone live authentication attestation nahi hai. Existing agent session se pehle se available sanitized contract evidence review karein; is task ke liye reconnect, new subscription, raw logs dump ya replacement session mat banayein. Agar existing safe observation available nahi hai, runtime contract UNVERIFIED rahega.

### 2. Mattermost account ka real bot status check karein

Existing deployment records se **Mattermost database** ka container/database/authorized role lein; Switch database ko guess karke use na karein. Human account ID wahi ho jo independent authenticated account check aur verified mapping mein use hua tha; display name se ID mat banayein.

```powershell
Set-Location -LiteralPath (Read-Host 'Absolute path to your BugBridge checkout')
$bbMmPostgres = Read-Host 'Existing Mattermost PostgreSQL container ka exact name'
$bbMmDatabase = Read-Host 'Existing Mattermost database ka exact name'
$bbMmRole = Read-Host 'Existing authorized database role; naya role mat banayein'
$bbMmAccount = Read-Host 'Independently authenticated human ka exact immutable Mattermost account ID'
node scripts/audit-mattermost-account.mjs $bbMmPostgres $bbMmDatabase $bbMmRole $bbMmAccount
if ($LASTEXITCODE -ne 0) { throw 'STOP: account classification unverified; existing DB owner review required.' }
```

Expected safe output: READ_ONLY, accountFound/accountIdMatches true, isBot false, active true, modified false, enrollmentPerformed false. `BOT_ACCOUNT_REJECT`, `INACTIVE_ACCOUNT_REJECT`, missing schema/access or unknown classification par stop karein. Password prompt deliberately disabled hai. Access fail ho to permissions/RLS/auth change nahi karna; existing authorized database owner se read-only review karayein. Diagnostic default Docker context aur OS-only environment use karta hai; custom credential/context variables assume nahi karta.

### 3. Readiness dobara check karein — enrollment abhi nahi

```powershell
node scripts/check-approval-readiness.mjs
```

Actual current result: proposalIntegrity PASS; enrollmentConfiguration ABSENT; authorizedHumanIdentity PENDING; switchIdentity UNVERIFIED; patchExecutionEnabled false; executionEntryPointRefused true; liveApprovalTested false. Is command ka exit 0 live approval readiness nahi dikhata.

Jab tak deployment/contract aur authenticated account classification dono independently verified nahi hain, enrollment/metadata activation command mat chalayein. Future explicit operator-confirmed enrollment ke baad unchanged signed-local prepare → review → existing-key sign → submit alternative metadata activation ke bina available reh sakta hai. Is audit mein koi intent prepare/sign/submit nahi hua. Signed-local bhi missing enrollment ko bypass nahi karta.

## Verification results

Final counts and transient Windows test-environment failures are recorded in `phase11-verification.md`. New tests: 16 sender-auth regressions and 9 mocked account-diagnostic tests. They cover canonical human recognition with every existing gate, self/bot/unknown/missing-kind rejection, wrong room, conflicting kind/type, mutation, text spoofing, disabled deployment, unchanged pending state, read-only SQL, missing/ambiguous classifications, environment stripping and safe errors. They are not live Mattermost/database verification.

Read-only HTTP evidence collection returned baseline 201 and **500 for both empty requests** (expected 400), and closed its temporary server. Historical evidence/proposals were not rewritten. The intentional regression remains failing for that exact 500-versus-400 reason. Application controller SHA-256 remains `4CAFBF10E6CF55738C0687B3F2ED8D1F443EC7D039115D8AE6ABE2DA79FF3432`. Execution remains disabled.
