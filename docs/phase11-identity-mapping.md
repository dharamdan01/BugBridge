# Phase 11A: trusted participant mapping investigation

Publication note (Phase 14): personal checkout paths were replaced with operator-supplied paths. Historical observations, counts and incident evidence are unchanged; older procedures are not current activation instructions.

Read-only investigation of the operator-provided local Switch source checkout. No production key, enrollment, credential, permission, database record, Docker configuration, application source or connection was changed. No WebSocket was opened. This document describes **source findings and an operator verification procedure**, not verified live identities.

## Confirmed local implementation

| Source under `core/switch_core` | Finding |
| --- | --- |
| `bridges/collaboration/mattermost/adapter.py:2754`, `_ws_handler` | Reads the server `posted` event's `post.user_id` (line 2779), not an ID in message text. Passes it as InboundMessage.sender_id (line 2877). Looks up the account through Mattermost. Bridge bots and the bridge admin/service account are skipped. |
| Same adapter, lines 2818–2842 | Recognizes webhooks/bots. Incoming webhooks receive a separate stand-in external identity; the apparent owning human is not treated as the webhook sender. `account_unlinkable_reason` rejects bot/webhook identities; `account_id_for_session` (3065) asks Mattermost whose existing session token it is. These functions were inspected, not invoked. |
| `bridges/collaboration/collaboration_core.py:1140` | `_ensure_human_in_room(external_user_id=msg.sender_id, ...)` resolves the person; names are labels. |
| Same core, `_create_human_actor` (2162), `_create_human_actor_locked` (2182), `_adopt_human_actor` (2269) | Resolves by bridge plus immutable external ID; persists ExternalUser.client_id and reuses that association. Candidate localparts involve names/collision handling, so **never construct an ID from a name**. The diagnostic never calls these mutating creation functions. |
| `db/models.py:2089`, ExternalUser | Table `external_users`: `bridge_id`, `external_user_id`, `client_id`, `tenant_id`; scoped to the specific bridge/tenant. |
| `db/models.py:773`, Client | Table `clients`. Python attribute `transport_user_id` maps to physical PostgreSQL column **`matrix_user_id`**. This stored value is the full wire sender ID required by BugBridge enrollment. |
| `bridges/agent/protocol/agent_core.py:630`, `_create_agent` | Creates a client of type agent and stores its ID in Agent.client_id. |
| `db/models.py:840`, Agent | Table `agents`: registration `id` → `client_id` → matching `clients.id`/tenant → `clients.matrix_user_id`. No API-key data is needed for this join. |
| `clients/actor.py:224`, `transport/postgres.py:1251`, `bridges/agent/protocol/message_events.py:41` | Actor posts through its bound transport; database sender_id comes from `self.user_id`, not the chat body. `message_event` copies `event.sender` to MessagePayload.sender. |
| `bridges/agent/protocol/types.py:219` | MessagePayload contains `sender`, `sender_name`, `sender_kind`. It does **not** define BugBridge's optional `sender_type` field. A transport-contract review is required before enabling metadata approval. |

Human lookup: authenticated Mattermost account ID → `external_users.external_user_id` within the room's actual Mattermost bridge/tenant → `external_users.client_id` → `clients.matrix_user_id`.

Agent lookup: exact existing `SWITCH_AGENT_ID` → `agents.client_id` → `clients.matrix_user_id`, with tenant consistency. Names and room membership are not authentication evidence.

## Important list_participants distinction

`bridges/agent/operations/definitions.py:758` defines `list_participants()` with **no parameters** and calls `require_connected_room()`. `operations/context.py` resolves that from the existing connection/session, while `api/operations.py:182` verifies any supplied connection belongs to the caller and is live. It does not require opening a replacement connection.

More importantly, `AgentCore.list_participants` (1534) returns `agent.id` for agents and `external_user.id` for people. These are **database entity IDs, not wire participant IDs**. Do not paste them into enrollment just because they appear in the participant list. `get_agent_detail` likewise returns registration metadata, not the required stored transport ID.

BugBridge `switch-client.mjs` keeps its randomly selected existing connection UUID in a private closure; it is not exposed in normal logs. `check-connection.mjs` would open a new socket, so **do not run it for this investigation**. Do not call connect_to_room, subscribe, placements, register or re-register. Opening a replacement WebSocket can take over the running connection/room.

## Runtime limitations of this investigation

- Source files are accessible. Git refused `rev-parse` because the repository belongs to another Windows user; no safe.directory or trust setting was changed. Run Git as its actual owner for build provenance.
- Docker engine access is denied in the agent context. No live database query or deployed-container source hash was executed here.
- Switch credentials are not loaded in this execution context; no credential file was opened to obtain them.
- The inspected checkout may differ from the running image. Source behavior alone does not prove the deployed Mattermost adapter, database rows, TLS configuration or actual human account binding.
- Human participant identity, agent participant identity and trusted sender authentication therefore remain **UNVERIFIED**. Existing signing-key verification is accepted as operator-reported status; the key was not read or regenerated.

## New operator-only read-only diagnostic

`scripts/inspect-switch-identities.mjs` uses **only existing authorized Docker/psql access**. It runs `scripts/switch-identity-mapping.sql` in `BEGIN TRANSACTION READ ONLY` and ends with ROLLBACK. It selects limited identity/connection/sender metadata, never configuration, key/token/password columns, usernames as authority, or message bodies. Four bounded SELECTs have 5-second statement/1-second lock timeouts. Inputs are psql quoted literal variables, not interpolated SQL; invocation has no shell, closes stdin, strips unrelated child environment secrets and suppresses raw database errors. psql `-X` ignores startup scripts and `-w` refuses password prompting. No role/RLS policy/tenant setting is changed. Output is still marked UNVERIFIED pending independent review.

The queries use source-verified tables: agents, clients, rooms, collaboration_bridges, external_users, agent_connections, agent_connection_rooms and agent_events. Empty/absent sections are a stop: missing mappings, access/RLS or schema differences must be investigated, not bypassed. An open connection row alone is not a liveness proof.

The existing `diagnose-approval-identities.mjs` now also emits a fixed `idWarning` explaining the entity-ID versus wire-sender distinction. No existing Switch client, authentication, approval configuration, room, connection or server source was modified.

### 1. Independently authenticate the human account

Simple Hinglish: apne **already signed-in Mattermost browser tab** mein account verify karein. Existing page ko reload/reconnect mat karein. DevTools console mein this read-only same-origin HTTP lookup run karein (or inspect the equivalent authenticated account response through your administrator):

```javascript
fetch('/api/v4/users/me', {credentials: 'same-origin', redirect: 'error'})
  .then(r => { if (!r.ok) throw new Error('SELF_LOOKUP_FAILED'); return r.json(); })
  .then(u => console.log({mattermost_user_id: u.id, is_bot: u.is_bot ?? null, delete_at: u.delete_at ?? null}))
  .catch(() => console.log('SELF_LOOKUP_FAILED'));
```

This issues one HTTP GET, does not extract cookies/tokens or open a WebSocket, and prints only the account ID/status fields. Use the intended human's own trusted session. A bot, inactive account, missing fields or identity uncertainty requires independent administrative review. Do not paste authentication headers/cookies into PowerShell or chat and do not disable browser security/paste protections. Keep the result local. An administrator must confirm the intended human owns that authenticated account; a typed ID alone is not proof. If this account is the bridge's service/admin account, the inspected adapter intentionally skips its posts; do not fabricate a human mapping to compensate.

### 2. Check source/build correspondence without reading configuration

In the normal Docker-authorized Windows PowerShell terminal:

```powershell
$bbSource = Read-Host 'Absolute path to the existing Switch source checkout'
git -C $bbSource rev-parse HEAD
docker ps --format '{{.Names}} {{.Image}}'
$bbCoreContainer = Read-Host 'Exact existing Switch core container name from your deployment'
docker inspect --format '{{.Image}}' $bbCoreContainer
```

These commands do not dump Docker environment/configuration or credentials. Compare the image ID/build provenance with the checkout. For direct critical-file corroboration, these two commands print only source hashes:

```powershell
$bbFiles = @(
    'bridges/collaboration/mattermost/adapter.py',
    'bridges/collaboration/collaboration_core.py',
    'bridges/agent/protocol/agent_core.py',
    'bridges/agent/protocol/message_events.py',
    'bridges/agent/protocol/types.py',
    'bridges/agent/operations/definitions.py',
    'bridges/agent/api/operations.py',
    'bridges/agent/auth.py',
    'transport/postgres.py',
    'db/models.py'
)
$bbFiles | ForEach-Object {
    [pscustomobject]@{
        file = $_
        sha256 = (Get-FileHash -LiteralPath (Join-Path (Join-Path $bbSource 'core\switch_core') $_) -Algorithm SHA256).Hash.ToLowerInvariant()
    }
} | Format-Table -AutoSize

@'
import hashlib, importlib.util, json
from pathlib import Path
root = Path(importlib.util.find_spec("switch_core").origin).parent
files = ["bridges/collaboration/mattermost/adapter.py", "bridges/collaboration/collaboration_core.py", "bridges/agent/protocol/agent_core.py", "bridges/agent/protocol/message_events.py", "bridges/agent/protocol/types.py", "bridges/agent/operations/definitions.py", "bridges/agent/api/operations.py", "bridges/agent/auth.py", "transport/postgres.py", "db/models.py"]
for name in files:
    print(json.dumps({"file": name, "sha256": hashlib.sha256((root / name).read_bytes()).hexdigest()}))
'@ | docker exec -i $bbCoreContainer python -
if ($LASTEXITCODE -ne 0) { throw 'STOP: deployed source comparison unavailable.' }
```

The Python lookup uses standard-library discovery, not application startup or database/configuration imports. Any missing interpreter/source, permission error or hash mismatch is a blocker, not permission to recreate/restart a container. Matching these files corroborates the critical path, not every runtime configuration/security property. Review the existing bridge endpoint/TLS and deployment provenance through the authorized operator process without dumping credential-bearing configuration.

### 3. Read actual stored IDs using an existing authorized database role

Confirm the correct existing PostgreSQL container/database/role from the operator's established deployment records. Do not read `.env`, inspect container Env, reset a password, create a role, disable RLS or grant permissions to force access. No container/service/database/role names are invented here:

```powershell
Set-Location -LiteralPath (Read-Host 'Absolute path to your BugBridge checkout')
if (-not $env:SWITCH_AGENT_ID -or -not $env:SWITCH_ROOM_ID) {
    throw 'STOP: use your existing configured terminal; do not change credentials.'
}
$bbPostgresContainer = Read-Host 'Exact existing PostgreSQL container name'
$bbDatabase = Read-Host 'Existing database name, from your authorized deployment records'
$bbDatabaseRole = Read-Host 'Existing authorized database role; do not create or grant a role'
$bbMattermostUserId = Read-Host 'Exact immutable ID from the independently authenticated human account lookup'
node scripts/inspect-switch-identities.mjs $bbPostgresContainer $bbDatabase $bbDatabaseRole $bbMattermostUserId
if ($LASTEXITCODE -ne 0) { throw 'STOP: authorized read-only database inspection unavailable.' }
```

The helper uses the Docker CLI's default context with an OS-only child environment; do not assume a different custom DOCKER_HOST/context environment was propagated. Confirm the context/container belongs to this local deployment. If existing authorized access cannot read these tenant-scoped records or psql is unavailable, stop for the database owner's read-only verification. Do not install a new service or weaken permissions.

Review the actual returned `agent_participant_id` and `human_participant_id`, tenant/bridge/channel association and any corroborating sender events. IDs must be copied in full from stored records, not formatted from names or UUIDs. The account result and deployed-source review must independently support the same bridge/account. A previously delivered sender event corroborates transport mapping but does not independently authenticate the person who supplied the external ID.

The connection section can supply a candidate **already-existing** connection UUID. Only after independently checking that it belongs to the same running agent/room may the existing HTTP diagnostic reuse it:

```powershell
$bbExistingConnection = Read-Host 'Existing database/admin-verified running connection UUID; never generate one'
node scripts/diagnose-approval-identities.mjs --connection-id $bbExistingConnection
```

Do not use the IDs returned by list_participants as wire IDs. The backend checks connection ownership/liveness; a refusal is a stop, not a reason to open/claim another connection.

## Enrollment and signed-local boundary

No enrollment occurs from any diagnostic. Keep `switchIdentity.enabled` false until actual deployed authentication/mapping is audited, including the sender_kind/sender_type contract difference. BugBridge's WeakMap transport binding proves that a sender string came through its existing client; it does not establish the human account association by itself.

After independently verified human/agent mappings, public-key binding review and explicit human enrollment, the unchanged signed-local prepare → reviewed intent → existing-key sign → submit alternative can work while metadata approval stays disabled. It cannot currently bypass ABSENT enrollment. Do not run it or sign an approval merely to collect identity evidence. The existing key was not accessed. Patch execution remains disabled and INC-001 source unchanged.

## Tests actually performed

- `node --test tests/approval-setup/identities.test.mjs tests/approval-setup/runtime-identities.test.mjs`: **27 passed, 0 failed, 0 skipped**; 11 new mocked process/response tests plus 16 existing HTTP-diagnostic tests.
- New tests verify fixed read-only SQL/metadata projection, scope binding/quoted inputs, no shell, EOF, time/output limits, absent scope refusal, secret environment stripping, malformed output and generic error handling. No live PostgreSQL query was executed; these tests are not live SQL-schema or authentication evidence.
- JavaScript syntax checks passed. No production enrollment or key test was run/generated in this task. No live integration success is claimed.
- Git ownership refusal and Docker pipe permission denial remain runtime-inspection blockers under this agent identity. No trust/ACL/credential setting was changed to work around them.
