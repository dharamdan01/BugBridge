# Phase 16A: GitHub and hackathon publication checklist

Project: BugBridge. Track: Best Business Workflow, WeMakeDevs Flip the Switch. Local demonstration only; deployment is not required. **Publication/push is not authorized by this preparation.**

## Phase 16A review status

- This phase corrects the seven files selected by the publication audit. It runs publication security tests only: **11 passed, 0 failed, 0 skipped**. It does not rerun the full API/bridge/native ACL verification or change host execution policy.
- Historical Phase 14 verification on 2026-11-06 at 07:47 UTC recorded **300 passed, 0 failed, 1 skipped**. The later [communication investigation](ping-communication-investigation.md#actual-local-verification) recorded **278 passed, 22 failed, 5 skipped** across its normal suites and was not a full PASS. Its native ACL checks were unavailable; a sampled enrollment failure confirmed PowerShell script restrictions. Keep the separate expected HTTP-400 regression failure outside normal-suite totals.
- At this review, the canonical proposal records `rootCause.analyst: CODEX_CLI`, AWAITING_APPROVAL, approvalRequired true and applied false. Older local-review artifacts record LOCAL_SOURCE_REVIEW. Artifact provenance is not independent proof of a fresh model invocation or Mattermost delivery.
- The operator previously observed real Mattermost PING, ASK/Codex and TRIAGE successes in earlier sessions. No fresh latest-session TRIAGE response was verified here, so current live acceptance remains PENDING. Human enrollment is incomplete, deployed sender authentication is unverified and automatic patch execution remains disabled.
- The project has no initialized Git repository. The refreshed exact manifest and hash-bound staging plan remain local-only under ignored `reports/private/publication-audit/`. They are not bundled public project features. No initialization, staging, commit, remote or publication is performed by this phase.

## Historical Phase 14 audit observations

- BugBridge working folder has no accessible `.git` metadata; Git status/top-level queries returned “not a git repository.” No production Git repository was initialized, staged or committed. There is no ownership-mismatch finding in this working folder; unavailable history/index cannot be claimed clean.
- Both dependency manifests/lockfiles remain intact; no dependency update or credential/configuration change was made. Registry advisory audits previously returned no metadata, so dependency advisory status remains UNVERIFIED until the operator checks it successfully.
- Four historical documents reviewed: `phase8-verification.md`, `phase11-verification.md`, `phase11-identity-mapping.md`, `phase11-final-security-audit.md`. Sixteen operator-specific checkout paths were replaced with prompts/generic source references. Historical counts, conclusions and measured reports were preserved, not rewritten or deleted. Notes distinguish publication edits from old activation procedures.
- Fourteen existing report JSON files were reviewed for checked identity-bearing sender/subject/room/agent/account fields: zero such string values, zero invalid JSON after review-only BOM normalization, one BOM-bearing historical file preserved byte-for-byte. No field values were printed. This bounded key review does not cover all possible renamed fields/private data. Canonical evidence/proposal hashes remain the integrity authority.
- `.gitignore` now also excludes DPAPI/PowerShell credential exports, local credential JSON, database files/exports and private report storage. A real Git ignore test uses only disposable metadata and synthetic paths; it does not initialize or stage this workspace. Ignore rules do not remove already tracked files or historical commits.
- Root API default remains 3000. Demo instructions consistently set 3100 after a real bind check, preserving Gateway configuration. Source standalone Compose has a Gateway default of 3000; actual deployed build/ports are not inferred from the checkout. This audit observed 3000 busy and 3100 available, then actually started the existing API entrypoint on 3100: health 200, valid create 201, both empty cases 500, child exited cleanly. [Port verification](../reports/phase14-port-check.json) records the actual checks; no other service was stopped. Availability must still be rechecked on each demo.
- Enrollment remains ABSENT, sender authentication UNVERIFIED and executor disabled. Existing approval safeguards are unchanged. An earlier live triage is operator-reported; fresh live rehearsal, screenshots and video remain PENDING.

## Five security gates

| Gate | Required publication review |
| --- | --- |
| Secret Leak Prevention | No `.env*`, tokens, credentials, DPAPI exports, private signing keys, approval config/ledgers or raw captures in the index/history. Run the location-only heuristic scan, then an approved redacting secret scanner/history review in the actual repository. Never print matches. |
| Personal Data Flow Audit | Sanitized docs/reports/captures only; no real human/agent participant IDs, database account records, private Mattermost content or personal file paths. Synthetic task UUIDs/timestamps and source-relative evidence remain useful. Model input may leave the computer through existing Codex; use synthetic data. |
| Pre-Submission Security Audit | Lockfiles, documented commands, working links, actual test artifact and truthful TODO assets; review every staged filename/content locally. Zero scanner matches is not clearance. Root LICENSE is not selected; owner decision remains pending. |
| Deep Authorization Audit | Keep metadata approval disabled; no identity inference from names/client_type/room membership. Verify no approval/executor/config activation changes in the staged diff. Enrollment/Phase 11B are outside this submission. |
| Attacker-Perspective Review | Retain traversal/link, no-shell, prompt-injection/schema, self/bot/unverified sender, room, expiry/replay/concurrency and disabled-execution regressions. ASK is a broader read-only surface; a clean demo workspace is required. |

## Exact operator Git procedure — no push

Run from the intended BugBridge checkout. These commands are for the human; none were executed against a production repository by the audit agent. For a brand-new repository, initialize only after confirming this is the intended project directory. Do not initialize inside an unrelated parent repository.

```powershell
if (-not (Test-Path -LiteralPath '.\package.json') -or -not (Test-Path -LiteralPath '.\switch-bridge')) {
    throw 'STOP: open the BugBridge project root.'
}
git rev-parse --show-toplevel
# If it reports NOT A REPOSITORY and this is intentionally a new repository:
# git init -b main
# Do not run init to resolve an ownership error or to replace an existing repo.

git status --short
if ($LASTEXITCODE -ne 0) { throw 'STOP: actual Git repository/owner review required.' }
git ls-files --cached
git rev-parse --is-shallow-repository
git rev-list --all --count
git log --all --format='%h %ad' --date=iso-strict
```

A shallow/unavailable history is not cleared. An empty new repository has no local history to inspect; it does not attest to earlier external copies. Use a maintained, owner-approved secret scanner with redacted output over the actual index/full history. No tool-specific flags are invented and no scanner is installed automatically. Findings require owner-led revocation/rotation and history remediation decisions; never rewrite history or rotate credentials automatically.

Check ignore rules on synthetic paths after manual initialization (no real keys/files are created). The focused test also checks these rules in disposable metadata without initializing this project:

```powershell
git check-ignore --no-index -- .env .env.local .bugbridge-private/approval-config.json keys/operator.p8 credential.dpapi credential.clixml nested/.codex/auth.toml nested/.aws/credentials nested/.ssh/id_ed25519 recording.mp4 recording.wav database.bak reports/raw-incident.json reports/private/publication-audit/inventory.json
```

After the owner manually initializes the intended new repository, review its index/history and use only the validated exact file plan. Do not stage directories or use force-add, a whole-folder add, or a whole-folder ZIP. Any file change invalidates its recorded hash; re-audit before staging.

```powershell
npm.cmd run security:submission
if ($LASTEXITCODE -ne 0) { throw 'STOP: submission scan needs review.' }
# Inspect this local-only generated script in a trusted editor first.
# It must contain only the audited file list, preflight checks and literal adds.
# Invoke it manually only after its hash/file-list validation and owner review:
# & .\reports\private\publication-audit\git-add-safe.ps1
# Do not bypass script-execution policy to run it. If blocked, use its exact
# reviewed file-level commands manually; never replace them with directory adds.
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'STOP: staged whitespace/conflict check failed.' }
git diff --cached --stat
git diff --cached --name-status
# Compare every indexed path with the exact audited manifest; reject extras.
# Ignore rules alone do not protect already tracked files or historical blobs.
# Review the staged CONTENT locally in a trusted editor; do not paste raw diffs.
# Rerun the approved redacting secret scanner on the final index/history.
# Only after independent review, optional LOCAL commit (does not publish):
# git commit -m "Prepare BugBridge local triage demo and submission documentation"
```

The path gate is a minimum, not an exhaustive credential detector. Database files, logs, screenshots, arbitrary renamed secrets and force-tracked ignored files need content review too. Keep legitimate sanitized historical/failed verification artifacts with explanatory status; do not delete them merely to make the history look successful. This preparation adds no remote and supplies no automatic push command.

### Ownership mismatch procedure, only if encountered

Stop Git operations. In the actual operator account, inspect the exact directory owner without changing trust:

```powershell
$bbRepo = (Get-Location).Path
(Get-Acl -LiteralPath $bbRepo).Owner
[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
```

Prefer running Git as the legitimate owner. If the operator has independently verified ownership, provenance and repository contents, a **single command** can use an exact-directory exception without persisting global settings:

```powershell
git -c "safe.directory=$bbRepo" -C $bbRepo status --short
```

Do not use wildcard trust, unsafe.directory settings, `git config --global`, recursive ACL changes or a new repository to bypass an ownership error. If legitimate ownership cannot be established, remain blocked.

## Final human acceptance

- [ ] Fresh normal tests, native ACL checks, syntax, smoke and real bug evidence pass; intentional 400 regression remains separately failing for observed 500.
- [ ] Existing live PING/ASK/TRIAGE rehearsed and same-room rendering observed; no fixture response presented as live.
- [ ] README claims match actual current report provenance/status and disabled fixing.
- [ ] Four historical documents and all staged reports/captures reviewed for personal information; no private originals staged.
- [ ] Actual index/full history and dependencies audited; any findings resolved by owner action.
- [ ] Reviewed screenshots/video link, repository license decision and required hackathon submission fields completed.
- [ ] Final staged diff reviewed; no credentials, approval activation, Switch/Docker changes or application fix.
- [ ] Human explicitly authorizes publication later. **No push/deployment is performed now.**

## Phase 14 verification results

Historical full run, 2026-11-06 at 07:47 UTC: **300 passed, 0 failed, 1 skipped, 0 cancelled**. API 46; investigation 15; bridge/triage/approval/local E2E 141; approval setup 64 plus one policy-host skip; enrollment fixtures 23; submission tests 11. The two new tests in that phase covered real Git exclusions and no-read DPAPI/database-export handling. This is not the latest broad verification; the later blocked results and Phase 16A security-only results are distinguished above. Repeated focused runs are not added to totals.

Historical [verification.json](../reports/local-demo/2026-11-06T07-47-08-335Z-1ffe466f-f929-430b-ac46-192acf28ba29/verification.json), [HTTP evidence JSON](../reports/local-demo/2026-11-06T07-47-08-335Z-1ffe466f-f929-430b-ac46-192acf28ba29/phase9-bug-evidence.json) and [Markdown](../reports/local-demo/2026-11-06T07-47-08-335Z-1ffe466f-f929-430b-ac46-192acf28ba29/phase9-bug-evidence.md) preserve that run. In that run five required native ACL records passed as VERIFIED_SYNTHETIC_FIXTURES; its one skip was the Restricted-host-only policy test. Its source/historical report hashes were unchanged; proposal integrity PASS, enrollment ABSENT, Switch identity UNVERIFIED, patch false and execution entry point refused. Its 400 regression was **one separate expected failure**, confirmed by both independently measured 500 cases, not a passing test.

In that historical run all JavaScript syntax and real entrypoint smoke passed. Five PowerShell scripts passed parser syntax checks. The API entrypoint additionally passed actual port-3100 health/valid-create/empty-request checks and exited cleanly. Documentation link validation passed. No live Switch/Mattermost/Codex call, enrollment, key generation or deployment was performed by that verification; fresh live checks remain PENDING.

The Phase 14 post-redaction scan recorded zero selected secret-pattern findings and zero personal-reference locations. This was not Git history/index/dependency advisory clearance or blanket publication approval. Phase 16A reruns the current scanner and exact-path validation separately. No `.git` metadata exists in this working folder. Actual index/history review after initialization, dependency advisory check, license decision and reviewed demonstration assets remain operator release checklist items.

Phase 14 created `docs/architecture.md`, `docs/demo-script.md`, this checklist, `tests/submission/git-exclusions.test.mjs`, `reports/phase14-port-check.json` and the verification/evidence trio linked above. Its modifications included README, `.gitignore`, scanner/tests, runbook, security/E2E review docs and the historical documents listed above. Phase 16A changes only the seven audited publication files, focused ignore-test coverage and ignored local audit artifacts. Dependencies, lockfiles, functional application/bridge code, approval behavior, Switch deployment and credentials are unchanged. No real signing key or private enrollment history was read, overwritten or deleted.
