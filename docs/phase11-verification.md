# Phase 11A: enforced human approval

Publication note (Phase 14): personal checkout paths were replaced with operator-supplied paths. Historical observations, counts and incident evidence are unchanged; older procedures are not current activation instructions.

Project: BugBridge. WeMakeDevs Flip the Switch. Best Business Workflow.

## Final sender-security audit — 2026-11-06

Latest findings and exact read-only PowerShell commands: [final security audit](phase11-final-security-audit.md). Later operator reports establish the eight database mappings and existing key/ACL verification; older sections below are historical. This agent could not access the live Docker engine, so deployed build correspondence, live sender authentication and bot classification remain UNVERIFIED. Enrollment remains ABSENT; metadata approval must stay disabled.

A verified BugBridge defect ignored canonical `sender_kind`. The client now binds it at receipt, requires exactly `user`, and rejects conflicts/mutations while preserving all other authorization gates and signed-local verification. Inspected Switch source leaves ordinary live-message kind unset: live contract compatibility therefore remains FAIL pending actual deployment review. No Switch source/configuration, production enrollment, credentials, signing key or application bug was changed.

New tests: 16 sender-auth regressions plus 9 read-only account-diagnostic tests. The account diagnostic discovers the existing Mattermost account schema and returns only explicit bot/active/match booleans; omitted `is_bot` is never assumed false. Operator-confirmed enrollment/activation is not performed by diagnostics.

### Final audit regression results

| Check | Actual final result |
| --- | --- |
| Switch bridge, including new sender tests | 140 passed, 0 failed, 0 skipped |
| Approval setup, including new account diagnostic and native ACL checks | 64 passed, 0 failed, 1 skipped |
| Enrollment, temporary fixtures only | 23 passed, 0 failed, 0 skipped |
| Normal API | 46 passed, 0 failed, 0 skipped |
| Investigation | 15 passed, 0 failed, 0 skipped |
| Total distinct normal automated cases | **288 passed, 0 failed, 1 skipped** |
| New cases / existing cases | **25 new passed; 263 existing passed, 1 existing skipped** |
| Bridge syntax command and changed/new JavaScript syntax | PASS |
| HTTP evidence collection without report writes | Baseline 201, both empty variants 500, temporary server closed |
| Intentional HTTP-400 regression | 1 expected failure: both variants actually return 500 INTERNAL_ERROR |
| Readiness | Proposal PASS; enrollment ABSENT; human PENDING; Switch UNVERIFIED; patch false; execution entry point refused |
| Live build / account / Mattermost approval | NOT VERIFIED; no live success claimed |

Commands used Node's `--test --test-concurrency=1 --test-reporter=tap` with each existing suite's unchanged file pattern. Bridge syntax used `npm.cmd --prefix switch-bridge run check`. New JavaScript modules/tests also passed `node --check`. Native setup/enrollment tests used only the previously authorized temporary Process RemoteSigned after rejecting defined Group Policy; a fresh process still reports all policy scopes Undefined (effective Restricted). The one existing skip is the Restricted-host-only policy test; native ACL tests executed successfully.

Initial default-concurrency bridge attempt produced 138 passed, 1 failed and 1 cancelled due CLI child/test timeouts. An intermediate serial attempt produced 139 passed and 1 failed in fixture teardown (`EBUSY` directory removal). After other native suites finished, the complete serial bridge rerun passed 140/140 in 9.1 seconds, without changing test timeouts, removing assertions or modifying fixture cleanup. These environmental failures are disclosed; they were not counted as successful runs. No claim of live integration follows from local synthetic protocol fixtures. Historical evidence/proposal files and production storage were not rewritten.

## Stage 3 signing-key provisioning preparation — 2026-11-06

**Utilities and synthetic verification are ready; a real production path is NOT yet approved under the human operator account. No production directory/key was created and no real enrollment was performed.** The proposed persistent layout is `$env:USERPROFILE\BugBridge-Signing\operator-ed25519`, conditional on the exact checks below. Neither USERPROFILE nor LOCALAPPDATA is assumed safe because of its name. Do not generate a key until the operator's parent preflight succeeds. Earlier sections below describe historical runs.

### Storage contract and observed parent checks

The helper requires a local fixed NTFS volume; an absolute path outside BugBridge, its ancestors and every detected Git repository; and no symlink/junction/reparse-point path components. A new directory's immediate parent must already exist, be owned by the current Windows SID and grant no effective write/delete/change-permission/take-ownership access to principals other than that owner, SYSTEM or Administrators. Inherit-only permissions do not grant access to the parent; new key storage always receives a protected owner-only DACL. The store and both key files must belong to the current operator, grant only owner access, and preserve required owner FullControl/inheritance. An existing key directory is never reused by provisioning. No helper repairs an existing insecure parent.

Read-only checks in **this agent execution context** returned:

| Candidate | Actual preflight result | Meaning |
| --- | --- | --- |
| USERPROFILE as parent of a proposed BugBridge-Signing folder | REFUSED at PARENT_ACL_READ / NATIVE_OPERATION_FAILED | Agent could not inspect that profile ACL; this does not establish the human owner's result |
| LOCALAPPDATA as parent of a proposed BugBridge-Signing folder | REFUSED at PARENT_OWNER_CHECK / PARENT_OWNER_MISMATCH | Parent did not belong to the current execution SID; do not use it blindly |

No ACL was changed in response. The operator must run preflight from their own normal account. A missing/unreadable/mismatched parent is a real prerequisite, not permission to bypass checks. If profile preflight fails, select an existing operator-owned, nonsynced local NTFS parent outside all Git repositories and rerun the same checks. If none is available, obtain a reviewed private location from its Windows owner/administrator; do not grant broad access or reset existing directories recursively.

### Implementation changes

- `scripts/approval-key-storage.ps1`: added **InspectParent**, a read-only operation using the exact path/NTFS/owner/write checks used by Prepare. Success is `{status: VERIFIED, parentApproved: true, modified: false}`. It creates no directory, reads no key bytes and changes no ACL. Prepare/Verify security gates are preserved.
- `scripts/approval-key-provisioning.mjs`: supports that parent check, shares path validation for new/existing key operations, and adds read-only `verifyApprovalKey`. It requires parent plus storage ACL acceptance, bounded regular non-link files, an unencrypted Ed25519 PKCS8 private PEM and an Ed25519 SPKI public PEM. It compares the public key derived from the private key, calculates the same SHA-256 SPKI-DER fingerprint as enrollment/signer, and signs/verifies a fixed self-test message outside the approval-intent domain. No approval signature is returned or submitted. Private bytes and native errors are not logged; the private input buffer is cleared afterwards, without claiming guaranteed OpenSSL/JS heap erasure.
- New `scripts/verify-approval-key.mjs <absolute-existing-key-directory-outside-BugBridge>`: prints only format/algorithm/self-test status and the public fingerprint. It never creates/repairs keys, enrolls identities or changes approval state.
- `tests/approval-setup/keys.test.mjs`: tests read-only parent inspection, real native verification and CLI use, matching fingerprint/file preservation, malformed/oversized/wrong-algorithm/private-as-public/mismatched/incomplete pairs, safe output, and a generated synthetic pair with the **unchanged actual signing utility**.
- Updated this document. The existing interactive provisioning/enrollment/signing commands and their confirmation boundaries remain unchanged. No Switch/app/credential/Docker configuration changed.

### Actual verification results

All native tests ran under the previously authorized temporary **Process RemoteSigned** setting after checking Group Policy was undefined. No permanent policy or Bypass/Unrestricted change was made. Fresh processes still report Restricted with all scopes Undefined.

| Command/check | Actual result |
| --- | --- |
| `npm.cmd run test:approval-setup` | **44 passed, 0 failed, 1 skipped**, 45 cases; includes 28 passing key/ACL cases and 16 passing identity-diagnostic cases |
| Native secure parent inspection | PASS without creating a target or changing fixture contents |
| Native generation + parent/storage verification + verifier CLI | PASS in secured temporary fixtures; PKCS8/SPKI/fingerprint/self-test all matched |
| Native unsafe parent/inherited storage/non-owner access rejection | PASS; original security failures remain enforced |
| Existing-directory/exclusive-write/Git/junction/partial-failure protection | PASS |
| Invalid/mismatched/incomplete key-pair rejection | PASS, no repair or secret output |
| Generated synthetic key with actual unchanged signer | PASS; its synthetic REQUEST envelope was verified but not submitted |
| `npm.cmd run test:enrollment` | **23 passed, 0 failed, 0 skipped**, including invalid public keys and confirmation/atomic-write checks |
| `node --test switch-bridge/test/phase11-cli.test.mjs` | **3 passed, 0 failed, 0 skipped**; existing signed-local security regressions, synthetic state only |
| Total relevant cases | **70 passed, 0 failed, 1 skipped**; skip is the unchanged Restricted-host-only policy test, not native ACL verification |
| Changed/new JavaScript and PowerShell syntax | PASS |
| Real production key/enrollment/live approval | NOT PERFORMED |
| INC-001 controller and execution boundary | Controller SHA-256 unchanged (`4CAFBF10E6CF55738C0687B3F2ED8D1F443EC7D039115D8AE6ABE2DA79FF3432`); FIX_EXECUTION_ENABLED remains false |

The compatible private PEM is **unencrypted PKCS8**, protected by Windows DACL/account/disk controls. Processes under the same Windows SID can read it; an administrator can take ownership. This filesystem workflow does not isolate an agent running as the same Windows account. Keep the private key outside Git, BugBridge, `.bugbridge-private`, synced folders, chats and reports. No upload/backup/export was performed by these utilities.

### Exact operator commands — simple Hinglish

Run from a normal PowerShell terminal under the intended **human key-owner account**. The key tools do not require Switch credentials. Existing agent terminal/connection ko running rehne dein. `.ps1` scripts PowerShell se chalayein, Node se nahi.

**1. Policy inspect karein.** Only the already-authorized temporary Process RemoteSigned setting is used below. Defined Group Policy is an owner-review stop; no permanent setting is changed.

```powershell
Set-Location -LiteralPath (Read-Host 'Absolute path to your BugBridge checkout')
Get-ExecutionPolicy -List
Get-ExecutionPolicy
$bbPolicies = @(Get-ExecutionPolicy -List | Where-Object {
    $_.Scope -in @('MachinePolicy','UserPolicy') -and $_.ExecutionPolicy -ne 'Undefined'
})
if ($bbPolicies.Count -gt 0) { throw 'STOP: Group Policy owner review required.' }
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force -ErrorAction Stop
if ((Get-ExecutionPolicy) -ne 'RemoteSigned') { throw 'STOP: process policy not effective.' }
```

This setting lasts only for this terminal/children. Do not change CurrentUser, LocalMachine, Group Policy, registry or file zone markings. Use a separate operator terminal rather than closing a running agent terminal later.

**2. Nayi safe signing-parent directory prepare karein — no keys yet.** The first InspectParent validates the existing profile parent; it is not a claim that USERPROFILE is already approved. Existing folders are refused; never delete them to force a rerun.

```powershell
$bbSigningParent = Join-Path $env:USERPROFILE 'BugBridge-Signing'
$bbKeyDirectory = Join-Path $bbSigningParent 'operator-ed25519'
if (Test-Path -LiteralPath $bbSigningParent) {
    throw 'STOP: signing parent already exists. Review it; do not overwrite/reset it.'
}
.\scripts\approval-key-storage.ps1 -Operation InspectParent -Directory $bbSigningParent
if ($LASTEXITCODE -ne 0) { throw 'STOP: existing parent is not approved. Do not generate keys.' }
.\scripts\approval-key-storage.ps1 -Operation Prepare -Directory $bbSigningParent
if ($LASTEXITCODE -ne 0) { throw 'STOP: new signing parent could not be secured.' }
.\scripts\approval-key-storage.ps1 -Operation Verify -Directory $bbSigningParent
if ($LASTEXITCODE -ne 0) { throw 'STOP: signing-parent ACL verification failed.' }
.\scripts\approval-key-storage.ps1 -Operation InspectParent -Directory $bbKeyDirectory
if ($LASTEXITCODE -ne 0) { throw 'STOP: key-directory parent is not approved.' }
```

Prepare creates only the new empty owner-only folder after the existing parent passes; it never weakens that parent's ACL. Expected inspection result: VERIFIED / parentApproved true / modified false. Expected empty-parent verification: VERIFIED / ownerOnly true. If any check refuses, stop and use its safe reason; no alternate path is silently chosen.

**3. Sirf ab, apni explicit manual action se production pair create karein.** This command was **not run for production by the agent**:

```powershell
node scripts/provision-approval-key.mjs $bbKeyDirectory
if ($LASTEXITCODE -ne 0) { throw 'STOP: provisioning failed. Review partial storage; do not retry or overwrite.' }
```

At its interactive prompt type exactly `CREATE APPROVAL SIGNING KEY` only if you want this real pair. It creates `approval-private.pem` and `approval-public.pem` inside the approved new key directory and displays the public fingerprint. Declining/headless input does not authorize creation. Save the **public fingerprint** for trusted comparison; do not print or copy the private PEM. Do not call Prepare on the key directory first; provisioning creates it and refuses an existing directory.

**4. Created files aur fingerprint verify karein — private contents display nahi hongi:**

```powershell
.\scripts\approval-key-storage.ps1 -Operation InspectParent -Directory $bbKeyDirectory
if ($LASTEXITCODE -ne 0) { throw 'STOP: parent check failed.' }
.\scripts\approval-key-storage.ps1 -Operation Verify -Directory $bbKeyDirectory
if ($LASTEXITCODE -ne 0) { throw 'STOP: key storage ACL check failed.' }
node scripts/verify-approval-key.mjs $bbKeyDirectory
if ($LASTEXITCODE -ne 0) { throw 'STOP: key pair or fingerprint verification failed.' }
Get-ChildItem -LiteralPath $bbKeyDirectory -File | Select-Object Name, Length
$bbPublicKeyPath = Join-Path $bbKeyDirectory 'approval-public.pem'
Write-Output $bbPublicKeyPath
```

Expected verifier fields: status VERIFIED, algorithm Ed25519, privateFormat PKCS8, publicFormat SPKI, signatureSelfTest PASS, enrollmentPublicKeyCompatible true, approvalPerformed false, modified false. Its `publicKeySpkiSha256` must match the provisioning output and later enrollment's fingerprint. This is SHA-256 over **SPKI DER**, not the PEM file hash. A mismatch is a stop, not permission to replace a key.

Verify the signing-parent folder while it is empty, before key creation. Afterwards verify the **child key directory** as above; Verify deliberately rejects unrelated subdirectories/files rather than treating arbitrary folder trees as key storage.

**5. Enrollment abhi mat karein.** Later enrollment accepts only `$bbPublicKeyPath`; it never needs the private path. Before that, independently verify the actual human participant ID and the existing bug-triager participant ID through authenticated administration and review the human/public-key fingerprint binding. The compatibility flag certifies the public format/key pair, not a human identity. Mattermost metadata approval stays disabled until its deployed sender mapping is audited. This Stage 3 task stops before real key generation or enrollment.

## Stage 2 native ACL failure resolved — 2026-11-06

**Latest targeted result: Stage 2 READY. Approval setup: 33 passed, 0 failed, 1 skipped. Enrollment: 23 passed, 0 failed, 0 skipped.** The original positive native Windows ACL test executed and passed. This is a targeted fixture/diagnostics correction, not authorization to create production keys, enroll a human, enable metadata approval or proceed to Phase 11B. Work stopped after Stage 2. All results in older sections below are historical.

### Exact root cause

The fixture was wrong for the production helper's contract. `fixture()` in `tests/approval-setup/keys.test.mjs` allocated a parent through `mkdtemp` under the project workspace, with inherited permissions. That parent granted effective write rights to a principal outside the permitted current-owner/SYSTEM/Administrators set. The helper correctly refused it at `scripts/approval-key-storage.ps1:45`, in PARENT_WRITE_CHECK. This was **not** an execution-policy refusal, NTFS creation bug, key algorithm failure or Node shell invocation bug.

Safe native diagnostics reproduced the isolated failure as:

```text
KEY_STORAGE_NOT_VERIFIED
safeReason: PARENT_UNAUTHORIZED_WRITE
safeStage: PARENT_WRITE_CHECK
helperLine: 45
```

Directory creation had not been reached. Path/project/Git/reparse validation and the parent-owner check had already passed. The blanket error previously concealed which check refused the directory. No SID, DACL body, credential, private key or raw native exception was printed by the production diagnostic.

Moving allocation to OS temp alone reproduced the **same** refusal: this host's inherited temp ACL was also unsuitable. The successful correction was to secure **only the fresh empty test parent** outside Git before using it. Production ACL requirements were not relaxed.

### Files and exact changes

- `tests/approval-setup/keys.test.mjs:34`: allocation now uses OS `tmpdir()` at line 38. Native cases explicitly request `secureParent: true`; initial hardening happens before any fixture file/repository copy. The original positive test at line 95 remains a native test, not a mock or replacement skip. Existing negative cases assert precise refusal codes.
- New `tests/approval-setup/secure-key-fixture.ps1`: test-only setup accepts the exact nonce-directory pattern directly under OS temp. Initial setup requires a fresh empty directory, matching owner, no Git ancestry and no reparse ancestors. It applies protected owner-only inheritable access and reads back the descriptor. The DACL-only update at line 66 preserves the already verified owner; it does not reset ownership/group/audit data. Negative-test modes can modify only this disposable fixture and empty test storage.
- `scripts/approval-key-storage.ps1`: adds fixed refusal/stage enums and a numeric helper line to the existing fail-closed response. Parent access rules, owner checks, NTFS/path/Git/reparse restrictions, protected inheritance, secure directory creation and existing-directory refusal are unchanged.
- `scripts/approval-key-provisioning.mjs`: copies only allowlisted diagnostic enums and a bounded numeric line from native refusal JSON. Native stdout/action text and arbitrary exceptions are not forwarded. Shell-free arguments, stdin EOF, timeout and OS-only child environment are unchanged.
- `scripts/provision-approval-key.mjs`: displays the validated refusal reason/stage after a failure; it never repairs permissions or displays native exceptions, SIDs or keys.
- This document records actual results and limitations. No application, Switch, enrollment, signing, credential or Docker source/configuration was changed.

During construction of the added negative fixtures, an unnecessary ownership-bearing descriptor update hit PrivilegeNotHeldException under this restricted token. The final test helper checks the existing owner and writes only the DACL through the .NET Framework directory ACL API. It does not request ownership/audit privileges or elevate. Native read-back and both negative cases then passed.

### Actual test results

The isolated original test was reproduced failing before correction and passed after secure fixture setup. Both requested complete suites then ran sequentially under the already-authorized **Process-scope RemoteSigned** setting. Both Group Policy scopes were Undefined. No permanent policy, registry, Group Policy, Bypass/Unrestricted flag or production ACL change was used. A fresh process afterwards reports Restricted with all five policy scopes Undefined.

| Check | Final actual result |
| --- | --- |
| `npm.cmd run test:approval-setup` | **33 passed, 0 failed, 1 skipped**, 34 cases |
| Original positive native ACL provisioning test | **PASS**, real Windows helper calls before/after synthetic key creation |
| New unauthorized parent-write native case | **PASS**: PARENT_UNAUTHORIZED_WRITE / PARENT_WRITE_CHECK; no key directory created |
| New non-owner read native case | **PASS**: NON_OWNER_ACL_RULE on otherwise protected empty test storage |
| Existing inherited-ACL and existing-directory case | **PASS**: ROOT_INHERITANCE_ENABLED and DIRECTORY_ALREADY_EXISTS |
| Key overwrite, Git/path, junction, partial-failure, Ed25519/fingerprint checks | **PASS** in the full setup suite |
| Restricted-host-only policy case | **SKIPPED**, unchanged condition: this run was RemoteSigned; no native ACL case was skipped |
| `npm.cmd run test:enrollment` | **23 passed, 0 failed, 0 skipped**, unchanged assertions including invalid/private/non-Ed25519 keys, confirmation/input/ACL gates and atomic concurrent writes |
| Requested suite total | **56 passed, 0 failed, 1 skipped**, 57 cases |
| Changed JS syntax | **PASS**, three changed modules/tests |
| Changed/new PowerShell syntax | **PASS**, production ACL helper and test fixture helper |
| Controller SHA-256 before/after | Unchanged: `4CAFBF10E6CF55738C0687B3F2ED8D1F443EC7D039115D8AE6ABE2DA79FF3432` |
| Fix execution boundary | Unchanged `FIX_EXECUTION_ENABLED = false`; executor still throws PHASE_11A_EXECUTION_DISABLED |
| Production key generation / real enrollment / live approval | **NOT PERFORMED** |

Only temporary synthetic Ed25519 keys were generated by tests. No security assertion or failing native case was removed. Deliberately broad ACLs in the new negative cases affect only isolated disposable fixtures, never a production/key directory.

### Production storage and remaining scope

A read-only attempt to snapshot the production storage ACL/content was denied under this agent identity. Its incomplete digest is not valid comparison evidence and is not reported as verification. Production permissions were **not reset or changed**, and no production enrollment/history/key write was attempted. The earlier operator-reported production ACL VERIFIED result is not re-certified here; the actual owner retains control of later production checks.

No native execution blocker remains for these suites under the authorized process policy. Fresh terminals still default to Restricted and require the same explicit temporary authorization for reruns. Human/agent identity mapping, real key custody and explicit enrollment remain later prerequisites. No new Switch session was opened. No live identity/approval verification or additional HTTP/full-regression run is claimed in this scoped Stage 2 task.

Operator commands to reproduce **only Stage 2 tests**:

```powershell
Set-Location -LiteralPath (Read-Host 'Absolute path to your BugBridge checkout')
Get-ExecutionPolicy -List
$bbOriginalProcessPolicy = Get-ExecutionPolicy -Scope Process
$bbPolicyChanged = $false
try {
    $bbGroupPolicies = @(Get-ExecutionPolicy -List | Where-Object {
        $_.Scope -in @('MachinePolicy', 'UserPolicy') -and $_.ExecutionPolicy -ne 'Undefined'
    })
    if ($bbGroupPolicies.Count -gt 0) { throw 'Stop: ask the Group Policy owner to review policy.' }
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force -ErrorAction Stop
    $bbPolicyChanged = $true
    if ((Get-ExecutionPolicy) -ne 'RemoteSigned') { throw 'Stop: process policy is not effective.' }
    npm.cmd run test:approval-setup
    if ($LASTEXITCODE -ne 0) { throw 'Stop: approval setup tests failed.' }
    npm.cmd run test:enrollment
    if ($LASTEXITCODE -ne 0) { throw 'Stop: enrollment tests failed.' }
} finally {
    if ($bbPolicyChanged) {
        Set-ExecutionPolicy -Scope Process -ExecutionPolicy $bbOriginalProcessPolicy -Force -ErrorAction Stop
    }
}
```

Simple Hinglish: Stage 2 ke tests ready hain. Yeh commands sirf synthetic tests chalati hain. Is task mein real key provisioning, enrollment aur Phase 11B automatically continue nahi karna hai.

## Stage-gated diagnostic: stopped at Stage 2 — 2026-11-06

This is the latest verification run. The operator explicitly required stopping if either Stage 2 suite failed. The temporary execution-policy issue was resolved for the authorized test process, but a separate native key-storage failure was exposed. **Stage 2 is not complete. Stages 3–6 were not advanced or re-run.** This entry records the stop; it does not claim full verification, production key provisioning, enrollment, live sender authentication or live approval.

### Stage 1 root-cause classification

| Symptom/category | Classification and evidence |
| --- | --- |
| Temporary `run-test.ps1` fails with “running scripts is disabled” | Environment policy. Initial effective Windows PowerShell policy was Restricted; MachinePolicy, UserPolicy, Process, CurrentUser and LocalMachine were all Undefined. Windows client defaults therefore prohibited local unsigned script files, including test wrappers. |
| Direct Node-helper tests return ACL_FAILED instead of a later file-publication error | Earlier dependency gate, not evidence that file-error expectations should be weakened. `writeConfirmed` runs its native ACL checker before checking/publishing the destination. A blocked checker masks the later path case. Under the authorized temporary policy, the original file-publication assertion and concurrent-write assertions passed unchanged. |
| Key provisioning returns POWERSHELL_SCRIPT_POLICY_BLOCKED | The production wrapper correctly refuses a blocked native ACL subprocess; this is not proof of bad NTFS permissions or an Ed25519 failure. |
| `node <file.ps1>` produces ERR_UNKNOWN_FILE_EXTENSION | Interpreter misuse. Node executes `.mjs`/`.js`; PowerShell executes `.ps1`. No Node loader or security exception is needed. Use `.\scripts\enroll-approval-human.ps1` in PowerShell. |
| Original approval-setup result 30 passed, 2 skipped | Two native ACL cases had not executed under Restricted policy. Mocked key-generation/signature tests were not evidence of native Windows ACL acceptance. |
| `list_participants` reports EXISTING_CONNECTION_CONTEXT_REQUIRED | Separate Switch context prerequisite. The diagnostic intentionally refuses a context-dependent call without an independently known existing connection UUID; it must not create/claim/evict a session. Stage 5 live investigation remains pending. |
| enrollmentConfiguration ABSENT / identities PENDING or UNVERIFIED | Correct unenrolled state, not configuration that should be fabricated. No operator-confirmed production configuration or verified participant/public-key binding exists. |

The inspection covered the project/source/test inventory, both package manifests and test commands, enrollment/config writer, signing/local-approval tools, ACL helpers, key provisioning, participant diagnostic, existing Switch transport and approval identity boundaries, and verification documentation. No project files were edited before this inspection and the Stage 2 test attempt.

### Stage 2 policy diagnosis and executed commands

Policy precedence is MachinePolicy → UserPolicy → Process → CurrentUser → LocalMachine. Group Policy takes precedence over a process setting. Microsoft documents the Windows-client Restricted default when all scopes are Undefined, and that Process scope is temporary and inherited by child processes, without a registry change: [about Execution Policies](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1).

The user explicitly authorized trying temporary Process-scope RemoteSigned when permitted. A fresh tool PowerShell process checked that neither Group Policy scope was configured, set **only Process** to RemoteSigned, verified the effective value, then ran the suites sequentially. No Bypass/Unrestricted flag, registry update, Group Policy update, blanket Unblock-File or alternate execution of blocked script contents was used. Existing production/test subprocess environment allowlists already preserve PSExecutionPolicyPreference, so no source or harness change was necessary to propagate this authorized process policy.

```powershell
$bbGroupPolicies = @(Get-ExecutionPolicy -List | Where-Object {
    $_.Scope -in @('MachinePolicy', 'UserPolicy') -and
    $_.ExecutionPolicy -ne 'Undefined'
})
if ($bbGroupPolicies.Count -gt 0) {
    throw 'BLOCKED: Group Policy is configured; ask its owner to review it.'
}
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force -ErrorAction Stop
if ((Get-ExecutionPolicy) -ne 'RemoteSigned') {
    throw 'BLOCKED: effective policy is not RemoteSigned.'
}
npm.cmd run test:enrollment
if ($LASTEXITCODE -ne 0) { throw 'Stop: enrollment suite failed.' }
npm.cmd run test:approval-setup
if ($LASTEXITCODE -ne 0) { throw 'Stop: approval setup suite failed; do not provision/enroll.' }
```

This process exited after the tests. Its temporary setting does not alter another existing terminal or any permanent scope. No test assertion was removed or relaxed.

| Stage 2 command | Actual current run |
| --- | --- |
| `npm.cmd run test:enrollment` | **23 passed, 0 failed, 0 skipped** under authorized Process RemoteSigned. This includes missing inputs/keys, wrong algorithm, confirmation refusal, headless input, wrong directory, ACL refusal, existing configuration, concurrent publication, staged ACL failure, UTF-8 IDs and successful synthetic enrollment/readiness. |
| `npm.cmd run test:approval-setup` | **30 passed, 1 failed, 1 skipped**. Both previously skipped native ACL cases ran. The negative existing-directory/inherited-ACL case passed. The positive provisioning case failed; the restricted-host-only negative policy test was skipped because this test process was RemoteSigned. |
| Current Stage 2 totals | **53 passed, 1 failed, 1 skipped** across 55 tests. Skipped is not passed. |

### Exact remaining Stage 2 blocker

Test `native Windows owner-only ACL verified before and after synthetic key provisioning`, at `tests/approval-setup/keys.test.mjs`, failed with **KEY_STORAGE_NOT_VERIFIED** from the native storage **Prepare** call in `provisionApprovalKey`. Unlike the previous policy error, the test now reaches the native helper. Its safe wrapper does not reveal which internal storage guard or filesystem operation failed. The exact underlying ACL/path/fixture cause has **not** been established in this stopped run; it must not be guessed, relabeled a policy failure, or hidden by a new skip. No native key-storage success is claimed.

Per the stage gate, no Stage 3 key-storage diagnosis or implementation change was attempted after this failure. Stage 4 additional enrollment failure-path work, Stage 5 deployed mapping investigation and Stage 6 full regression/smoke/HTTP reproduction remain not run in this continuation. Previous sections contain historical results, not newly executed checks. The intentional application bug and execution-disable boundary were not edited. No credentials, Docker settings, application source, real keys or production enrollment configuration were changed.

### Exact next operator action — simple Hinglish

Pehle Stage 2 ka remaining native failure resolve karna hai. Abhi real signing key provisioning ya enrollment mat chalayein. Normal PowerShell mein policies inspect karein; `.ps1` ko `node` se mat chalayein:

```powershell
Set-Location -LiteralPath (Read-Host 'Absolute path to your BugBridge checkout')
Get-ExecutionPolicy -List
Get-ExecutionPolicy
```

Agar Group Policy undefined hai, upar documented **temporary Process RemoteSigned** block se selected suites reproduce kar sakte hain. Yeh permission sirf current terminal aur uske children tak rahegi; terminal close karne par khatam hogi. Existing process preference ko restore karna ho to uski pehle wali Process value record karke use `Set-ExecutionPolicy -Scope Process` se restore karein. Permanent scopes change na karein.

Do not continue until the positive native ACL test succeeds with the security guards intact. The next engineering task is narrowly to diagnose that test's actual native Prepare refusal in its controlled temporary fixture. Human/agent identity mapping, real key custody, explicit enrollment and audited live sender authentication remain independent later blockers. Live Mattermost metadata approval and Phase 11B patch execution must remain disabled.

## Secure enrollment prerequisites utilities — 2026-11-06

This section supersedes the earlier statement that no project key-provisioning utility exists. No production key pair, participant enrollment, approval decision, Switch connection, credential change or application fix was made while implementing these utilities. `approval-config.json` remains ABSENT. Proposal integrity is PASS and patch execution remains unconditionally disabled.

### Files and boundaries

Created `scripts/diagnose-approval-identities.mjs`, `scripts/provision-approval-key.mjs`, `scripts/approval-key-provisioning.mjs`, `scripts/approval-key-storage.ps1`, and two test files under `tests/approval-setup/`. Updated this document and added `test:approval-setup` to `package.json`. Existing Switch client/runtime, approval/enrollment/signing modules, application source, credentials and Docker configuration were not changed. No Git repository metadata is present in this workspace; no commit/push operation was performed.

### Read-only participant diagnostic

The official [operation contract](https://docs.switchagents.ai/switch-rooms/internals/agent-protocol) documents authenticated `GET /agents/{agent_id}/ops`, the discovered `input_schema`, and unwrapped arguments to `POST /agents/{agent_id}/ops/{operation}`. It lists `list_participants`, `get_agent_detail` and `read_context`. The diagnostic discovers the deployed schemas instead of assuming every release has the same signature. The official [event contract](https://docs.switchagents.ai/switch-rooms/internals/agent-events) documents `payload.sender` as a full opaque participant ID and `sender_name` separately. An ID must not be constructed from a username or parsed to infer human/agent authority.

The diagnostic uses the same fixed local server as the current client (`http://127.0.0.1:8000`) and the existing `SWITCH_AGENT_ID`, `SWITCH_AGENT_KEY`, `SWITCH_ROOM_ID` environment. It never loads or edits `.env`. It permits only the three fixed HTTP read operations above; it cannot register, create/connect/subscribe to a room, post, update, open WebSocket/SSE, generate a connection ID, or evict an existing connection. HTTP redirects are refused, requests have a 10-second timeout, JSON responses are bounded to 256 KiB, and remote error bodies are omitted.

`list_participants` is called with `room_id` only when its deployed schema exposes that field. A context-only operation is not called without an explicitly supplied already-running connection UUID. `get_agent_detail` uses the existing registered agent ID only when `agent_id` is supported. Optional history lookup is limited to ten records only if the schema supports `limit`; message bodies never enter diagnostic output. Unknown schemas/required arguments are reported, not guessed. No alternate endpoint/session is attempted automatically.

Output retains only recognized opaque ID fields and explicit type enums, with structural source paths. Names, free-text bodies, auth assertions, arbitrary fields and credentials are omitted; the known agent secret is redacted even if echoed in an ID field. All returned fields remain **unverified candidates**. A generic `id`, `agent_id` or `user_id` is not automatically promoted to a participant ID. `humanParticipantIdentity`, `agentParticipantIdentity` and `switchSenderAuthentication` always remain UNVERIFIED in this diagnostic. It does not enroll anyone or change readiness.

The human operator must independently verify the deployed server/adapter mapping from their actual authenticated Mattermost account to its complete Switch participant ID, and separately map the registered existing `SWITCH_AGENT_ID` to its agent participant ID. Authenticated read access proves where the response came from; room membership/display names do not prove those bindings or grant approval authority. Review the deployed build and adapter code/admin records as well as authenticated account ownership. If this mapping is unavailable, do not enroll a guessed identity. Keep metadata approval disabled and report the missing mapping as a blocker.

Run in the existing configured normal PowerShell terminal:

```powershell
Set-Location -LiteralPath (Read-Host 'Absolute path to your BugBridge checkout')
node scripts/diagnose-approval-identities.mjs
```

If it reports EXISTING_CONNECTION_CONTEXT_REQUIRED, use authenticated server administration to obtain the mappings. Only if the actual running connection UUID is already independently known may it be reused for HTTP reads:

```powershell
$approvalExistingConnection = Read-Host 'Actual already-running connection UUID; do not generate or guess one'
node scripts/diagnose-approval-identities.mjs --connection-id $approvalExistingConnection
```

This flag does not open a connection and must never be populated using `New-Guid`. A 403/409 or unknown schema remains a blocker; the diagnostic does not try to repair permissions or take over the running connection. Keep diagnostic identity output local.

### Operator-invoked Ed25519 provisioning

`provision-approval-key.mjs` accepts exactly one absolute **new directory** outside BugBridge and any detected Git repository, or `--help`. It requires interactive stdin/stdout and the exact confirmation `CREATE APPROVAL SIGNING KEY`; piped/headless creation is refused. It never invokes enrollment or reads Switch credentials. Node built-in `generateKeyPairSync('ed25519')` creates a PKCS8 private PEM and SPKI public PEM compatible with the unchanged enrollment/signing tools.

Before generating any key material, the native Windows PowerShell helper creates a directory with a protected **owner-only** DACL using the .NET Framework directory-creation ACL overload, then verifies it again. This is stricter than approval-ledger storage (which also permits SYSTEM/Administrators ACEs). The parent must already exist, belong to the current operator and not grant ordinary other principals effective write/delete/ACL-control rights. Only local fixed NTFS storage is accepted. Project/ancestor paths, Git ancestry, UNC paths, alternate streams, junctions/reparse-point ancestors and existing directories are refused. The utility never repairs or broadens an existing ACL.

Both files use exclusive `wx` creation, are synced, and have inherited owner-only ACLs verified after each write. Existing keys cannot be overwritten. A partial write failure is a fixed safe error; secure partial material is preserved for explicit operator review, never deleted or retried automatically. The public key is read back and its SHA-256 SPKI-DER fingerprint checked. Output contains paths and the public fingerprint, never private bytes or arbitrary exceptions. The private export buffer is cleared afterwards; Node/OpenSSL heap copies cannot be guaranteed erased.

PowerShell subprocesses receive only an OS-environment allowlist, use argument arrays with no shell, close stdin, have a 15-second timeout and hidden windows, and do not override execution policy. A policy rejection reports POWERSHELL_SCRIPT_POLICY_BLOCKED. Use an already-approved operator terminal or consult the policy owner; do not bypass or weaken script policy to run these utilities.

Simple Hinglish operator sequence:

1. Pehle diagnostic se IDs ke candidate fields dekhein. Authenticated server/account mapping se dono full participant IDs independently verify karein. Naam dekhkar ID select mat karein.
2. Existing legitimate signing pair ho to use replace na karein. Nayi pair chahiye tabhi neeche provisioning run karein. Directory already exist kare to utility refuse karegi; use delete/overwrite na karein.
3. Private key outside BugBridge rahegi. Same Windows SID ke processes ise read kar sakte hain; owner-only ACL agent aur human ko isolate nahi karti agar dono same account par hain. Windows administrators can take ownership. No claim of same-account or administrator isolation is made. The compatible PKCS8 PEM is unencrypted; secure disk/account/key custody remains an operator responsibility.

```powershell
Set-Location -LiteralPath (Read-Host 'Absolute path to your BugBridge checkout')
$approvalKeyDirectory = Join-Path $env:LOCALAPPDATA 'BugBridge-Approval-Keys'
node scripts/provision-approval-key.mjs $approvalKeyDirectory
```

At the prompt type exactly `CREATE APPROVAL SIGNING KEY` only if you want this new pair. It creates:

- `$approvalKeyDirectory\approval-private.pem` — private; do not print, upload, commit, put in `.bugbridge-private`, or provide to Codex/the agent.
- `$approvalKeyDirectory\approval-public.pem` — existing SPKI public PEM path for enrollment.

The operator can recheck storage without reading private key material:

```powershell
.\scripts\approval-key-storage.ps1 -Operation Verify -Directory $approvalKeyDirectory
```

If LOCALAPPDATA's ownership/ACL, filesystem or path fails validation, stop for owner review; no fallback weakens these requirements. No production key was created during automated testing. Native positive ACL tests use only isolated synthetic repositories/storage and are pending in the current restricted host.

### Explicit enrollment after independent review

From the same existing Switch-configured normal PowerShell terminal:

```powershell
Set-Location -LiteralPath (Read-Host 'Absolute path to your BugBridge checkout')
.\scripts\check-approval-acl.ps1
# Proceed only after VERIFIED. Storage already exists; do not prepare/reset it.
.\scripts\enroll-approval-human.ps1
```

The enrollment script accepts no parameters. At its prompts:

| Prompt | Simple Hinglish instruction |
| --- | --- |
| Verified full HUMAN participant ID | Actual human account se independently mapped poora Switch participant ID paste karein; display name/Mattermost username nahi. |
| Verified existing AGENT participant ID | Existing bug-triager ka verified poora participant ID paste karein; registered SWITCH_AGENT_ID directly nahi. |
| Absolute path to existing Ed25519 PUBLIC-key PEM | Successful provisioning ke `publicKeyPath` ki exact value paste karein, without surrounding quotes. Private path kabhi nahi. |
| ENROLL AUTHORIZED HUMAN | Enrollment ka public SPKI SHA-256 fingerprint provisioning/operator fingerprint se trusted review ke baad match karein; tabhi exact confirmation type karein. Otherwise cancel. |

For the provided provisioning location, obtain the public path locally without printing key contents:

```powershell
Join-Path $approvalKeyDirectory 'approval-public.pem'
```

Only the operator's explicit confirmed enrollment creates `.bugbridge-private/approval-config.json`. Then:

```powershell
Test-Path -LiteralPath '.bugbridge-private\approval-config.json' -PathType Leaf
node scripts/check-approval-readiness.mjs
.\scripts\check-approval-acl.ps1
```

Expected **after successful operator enrollment**, not the current result: Test-Path True, enrollmentConfiguration VALID, proposalIntegrity PASS (if evidence/source remain coherent), authorizedHumanIdentity PENDING, switchIdentity DISABLED, patchExecutionEnabled false, executionEntryPointRefused true. The readiness checker deliberately does not certify independent identity review. Leave `switchIdentity.enabled` false until the actual deployed sender authentication/mapping is audited. The unchanged signed-local `approval-local.mjs prepare` → human `sign-approval.mjs <absolute-outside-project-private-path>` → `approval-local.mjs submit` path remains available after verified enrollment; these steps are not automatically run by either utility. No Phase 11A approval can execute a patch.

### Actual verification for these utilities

| Check | Actual result |
| --- | --- |
| New `npm.cmd run test:approval-setup` | 30 passed, 0 failed; 2 native ACL integration cases skipped because current Windows PowerShell effective script policy is Restricted |
| Existing Switch bridge suite | 124 passed on sequential rerun, including PING/ASK/TRIAGE/approval/signed-local coverage |
| Existing API suite | 46 passed |
| Existing investigation suite | 15 passed on sequential rerun |
| Existing enrollment suite, unmodified | 1 passed, 22 failed at script-policy/ACL-execution gates; these are blocked, not successful enrollment tests |
| JavaScript syntax | All 50 current source/script/test files passed |
| PowerShell syntax | All 4 scripts parsed; parsing is not a successful native ACL run |
| Actual HTTP `collectEvidence()` | Baseline 201; empty JSON and absent body both 500 INTERNAL_ERROR vs expected 400; temporary server closed; no historical evidence overwritten |
| Intentional `npm.cmd run test:bug` | Expected failure: one regression assertion comparing both 500 results against 400 |
| Production readiness | Proposal PASS; enrollment ABSENT; human PENDING; Switch identity UNVERIFIED; patch false and execution entry point refuses |
| Live participant diagnostic | Safely refused SWITCH_CONFIGURATION_REQUIRED; this execution host has no loaded Switch credentials; no live IDs claimed |
| Production key generation / enrollment / live approval | Not performed |

The initial concurrent verification also hit an existing Windows EBUSY test-cleanup failure in the bridge suite and an investigation HTTP timeout; sequential full reruns passed without test/code changes. Initial native key provisioning test could not run its helper under current script policy. New tests now explicitly report that native capability as skipped and separately verify actionable policy refusal; no policy override was introduced. Existing enrollment tests were left unchanged and their failures are reported above. The previous 208-test result belongs to the earlier approved operator host and is not claimed for this restricted run.

The first failed bridge cleanup left `.bugbridge-test-eibyH1` in the workspace. A subsequent guarded cleanup request was rejected by automatic tool approval review because sandbox approval requests are disabled. The fixture was left in place; no alternate deletion mechanism or production-history cleanup was attempted.

New tests cover fixed read-only operation routing, absent/unsupported schema and scope, existing-connection reuse, no generated session, missing credentials, malformed IDs, no username/body authority, redaction, bounded/error/redirect responses, key confirmation, outside-project/Git paths, key overwrite refusal, junctions, ACL gates before key generation, Ed25519 sign/verify plus unchanged enrollment fingerprint compatibility, exclusive writes, safe partial failures, help/headless safety and native script-policy refusal. Mock ACL tests establish Node behavior only; they are not evidence that real Windows DACL enforcement ran.

Before relying on provisioning, run `npm.cmd run test:approval-setup` and `npm.cmd run test:enrollment` in the operator's already-approved normal terminal and review native results. Remaining blockers: independent human/agent participant mapping, operator-run native ACL acceptance, actual key provisioning/custody, explicit enrollment and live sender audit/acceptance. Do not enable metadata approval or Phase 11B patch execution based on candidate IDs or mocked tests.

## Human enrollment workflow correction — 2026-11-05

**The interactive enrollment flow is now exercised by 23 Windows PowerShell 5.1 regression tests. All 185 previous normal tests still pass: 208 normal tests total. No production human was enrolled, no production configuration was created, no ACL was changed and no application fix was applied.**

### Diagnosis and exact scope of the finding

`ACL VERIFIED` establishes only the storage gate. The original `enroll-approval-human.ps1` then required the Switch environment IDs, three interactive values, successful Ed25519/config validation, exact human confirmation and a successful file write. Its blanket catch discarded the actual failure and printed the same generic message for all those cases. A missing/unavailable `Read-Host` response, missing ID/key or file-write failure therefore left configuration ABSENT without identifying the failed step. There was also no transactional publication: the original direct CreateNew/write could expose a partial configuration if interrupted.

A native Windows PowerShell **5.1.26100.9711** probe verified that a nested checker ending in `exit 0` returns to its caller and reaches `Read-Host`. It did **not** terminate the parent script in that test. We therefore do not attribute the reported operator run to a proven `exit 0` bug. The unavailable-input symptom was reproduced in a noninteractive host; the old generic catch concealed its cause. The exact failure in a past operator run cannot be reconstructed from that generic output alone. The corrected script now reports the concrete failing stage and a safe action on the next attempt.

### Implementation changes

- Modified `scripts/enroll-approval-human.ps1`: visible progress after ACL success; required-input checks; safe error codes and actions; distinct registered-agent versus participant-ID guidance; explicit fingerprint/confirmation; isolated native ACL execution via the Node helper; captured process exit codes; UTF-8 stdin with the previous PowerShell encoding restored; and file plus readiness verification before printing SAVED.
- Added `scripts/enrollment-config.mjs`: existing schema and Ed25519 public-key validation; strict existing ACL checker invocation; fixed config path; exact confirmation and Switch-scope binding; atomic no-overwrite publication; read-back validation; bounded stdin/subprocesses; fixed safe diagnostics. It is an internal operator helper, not a chat command or approval/fix executor.
- Modified `scripts/check-approval-readiness.mjs`: permissions/IO failures now report UNREADABLE and exit nonzero rather than incorrectly implying ABSENT. A genuinely missing file still reports ABSENT.
- Added `tests/enrollment/enroll-human.test.mjs` and root `npm run test:enrollment`.
- Updated this document. `check-approval-acl.ps1`, `prepare-approval-storage.ps1`, the approval/signature modules, signing tools, Switch client/runtime and application source were not changed.

The writer creates and syncs a unique temporary file inside the already protected directory, checks that staged file's inherited ACL, then publishes the complete file through a same-directory hard link. Publication fails if the final name already exists; it does not overwrite or fall back to an in-place copy. The final file shares the verified file ACL, is read back and validated, and the temporary name is removed. Local filesystem hard-link support is required; a failure stops for owner review. This follows the [Node filesystem API](https://nodejs.org/api/fs.html#fspromiseslinkexistingpath-newpath). It does not make power-loss durability or hostile-administrator guarantees beyond the existing filesystem trust boundary.

Native ACL subprocesses have no shell, closed stdin, a timeout and an OS-only environment allowlist. They preserve an existing process execution-policy setting rather than silently dropping it, and never set/override execution policy or pass a bypass flag. Dropping that setting during the first test attempt caused native script loading to be refused; it was corrected by preserving the already approved parent setting. No system policy was changed.

### Corrected operator procedure — existing storage

Use the existing normal interactive Windows PowerShell terminal under the same owner/runtime account. Do not pass `-NonInteractive` to enrollment, pipe answers into it, double-click it into a disappearing host, rerun storage preparation on the existing directory, or change security policy to force a run. The ACL-only child process is noninteractive because it never asks for human input; the enrollment parent remains interactive. [Read-Host reads the host's stdin](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/read-host?view=powershell-5.1).

```powershell
Set-Location -LiteralPath (Read-Host 'Absolute path to your BugBridge checkout')
.\scripts\check-approval-acl.ps1
if ($LASTEXITCODE -ne 0) { throw 'Stop: ACL owner review is required.' }
if (-not $env:SWITCH_AGENT_ID -or -not $env:SWITCH_ROOM_ID) {
    throw 'Use the existing Switch-configured terminal; do not alter credentials.'
}
.\scripts\enroll-approval-human.ps1
if ($LASTEXITCODE -ne 0) { throw 'Stop: follow the printed enrollment error code; do not overwrite or retry automatically.' }
node scripts/check-approval-readiness.mjs
.\scripts\check-approval-acl.ps1
```

Supply these operator-verified inputs:

1. The exact full opaque **human participant ID** obtained through authenticated Switch administration and independently confirmed as that human. A display name, username mention or room membership is insufficient.
2. The exact full participant ID used by the existing **bug-triager agent**. This is separate from the registered agent identifier already supplied as `SWITCH_AGENT_ID`.
3. The absolute path to the human's **existing Ed25519 PUBLIC-key SPKI PEM**, starting with `-----BEGIN PUBLIC KEY-----`. Obtain it from the human or trusted key custodian. OpenSSH `ssh-ed25519` text, a private-key PEM, malformed/non-Ed25519 keys, missing files and reparse-point files are not accepted. Enrollment never generates a substitute key or fake ID.
4. Compare the displayed **public SPKI SHA-256 fingerprint** through a separate trusted channel. Only then type exactly `ENROLL AUTHORIZED HUMAN`. Any other or empty response refuses enrollment.

If identity/key material is unavailable, stop and obtain it through the trusted administrator/operator process. There is no safe command that can invent those values. Once supplied, rerun the same interactive command; manual JSON editing is not required. No private signing key is needed or displayed during enrollment.

Expected successful result:

```text
SAVED: .bugbridge-private/approval-config.json; enrollmentConfiguration: VALID.
```

The script verifies both the saved file and `check-approval-readiness.mjs` before that message. Readiness should then show enrollmentConfiguration VALID, switchIdentity DISABLED and patchExecutionEnabled false. authorizedHumanIdentity deliberately remains PENDING because config validation is not independent proof of a live sender mapping. Human verification/approval must continue through the existing signed-local alternative until that mapping is audited. No approval decision is recorded by enrollment.

Examples of actionable failures now emitted include ACL_FAILED, SWITCH_IDS_MISSING, INPUT_UNAVAILABLE, HUMAN_ID_REQUIRED, AGENT_PARTICIPANT_REQUIRED, PUBLIC_KEY_REQUIRED, PUBLIC_KEY_NOT_FOUND, PUBLIC_KEY_INVALID, CONFIG_INVALID, CONFIRMATION_DECLINED, CONFIG_EXISTS and SAVED_CONFIG_REVIEW_REQUIRED. Unexpected exceptions report a fixed stage/action without dumping IDs, key contents, credentials or raw exception text. An error after publication can leave a complete config requiring review; it is never silently overwritten or automatically retried.

### Enrollment-fix verification

| Command/check | Observed result |
| --- | --- |
| npm run test:enrollment | **23 passed**, 0 failed/skipped; actual Windows PowerShell 5.1 processes, controlled Read-Host and ACL fixtures |
| npm run test:phase7 | **124 passed**, including all original bridge/approval/Phase 10 tests |
| npm test | **46 passed** |
| npm run test:investigation | **15 passed** |
| Total normal tests | **208 passed = 185 existing + 23 enrollment** |
| npm run test:bug | Expected failure: both empty inputs still return 500 INTERNAL_ERROR versus asserted 400 VALIDATION_ERROR |
| JavaScript syntax | All **45** current source/script/test JavaScript files passed |
| PowerShell syntax | All **3** setup/check/enrollment scripts parsed successfully |
| Production readiness | Proposal PASS; enrollment ABSENT; identity PENDING; switchIdentity UNVERIFIED; patch execution false |

Tests cover all requested boundaries: ACL failure and unverified zero-exit output, missing Switch IDs, missing human/agent IDs, missing key path/file, malformed/private/non-Ed25519 keys, headless Read-Host, declined/empty confirmation, valid enrollment in existing temporary storage, saved-config/readiness verification, stale native exit codes, exact opaque Unicode identity preservation, history/config preservation, atomic concurrent publication, staged ACL failure without a partial final file, safe file errors, unauthorized agent enrollment, and secret exclusion. Production ACL checks are mocked only by replacing the checker in temporary copies; real storage permissions and the production checker are untouched. Test identities and keys are explicitly synthetic, never production enrollment.

The initial test run was unsuccessful because the isolated subprocess environment dropped the existing PowerShell execution-policy setting; it is not counted as a pass. The completed final enrollment run passed all 23 cases after preserving the parent setting. Temporary Windows cleanup retries are limited to test-directory lock errors, not enrollment publication or approval operations.

Remaining blockers: the real operator must still provide independently verified participant IDs and the actual public key, confirm enrollment interactively and record its readiness result. Real live metadata authorization and Mattermost approval remain unverified here. The production configuration was absent before and after these changes; the real enrollment script was never invoked by the agent. Existing signed approval verification and the unconditional Phase 11A execution-disable boundary remain enforced. INC-001 remains unfixed.

The Phase 11A.2 section below is historical setup context. Its earlier claim that mutating helpers were syntax-only describes that earlier phase; the enrollment correction above is now verified in temporary controlled tests.

## Phase 11A.2 current verification — 2026-11-05

**Fresh evidence PASS. Proposal integrity PASS. All 185 existing normal tests passed. Human identity, Windows approval ACL and live Mattermost approval remain PENDING. Patch execution remains disabled.** This section supersedes the historical Phase 11A evidence-mismatch and setup observations below.

### Current evidence and proposal

Before refreshing anything, six original reports were copied byte-for-byte to `reports/history/phase11a2-20261105T083707459Z-before-refresh/`. Its `manifest.json` records every original path and SHA-256; all copied hashes were checked. This preserves the previous Phase 9 evidence, previous incident proposal and previous Phase 11 evidence. No approval ledger was removed, reset or overwritten; `.bugbridge-private` did not exist.

Executed the existing `npm run reproduce:bug`: fresh isolated real HTTP returned 201 for valid creation and **500 INTERNAL_ERROR for both empty JSON and absent bodies**, against expected 400 VALIDATION_ERROR. Storage/health/cleanup checks passed. Current canonical evidence is `reports/phase9-bug-evidence.json` and `.md`, reproduced **2026-11-05T08:37:21.111Z**.

Executed the existing `npm run triage:incident`; it exited 1 safely in this shell. No successful Codex/model run is claimed. Then explicitly executed the already supported `npm run triage:incident -- --source-review`, generating a coherent current proposal at **2026-11-05T08:37:46.936Z** with honest `LOCAL_SOURCE_REVIEW` provenance. It remains AWAITING_APPROVAL with approvalRequired true and proposedFix.applied false. The source-review option is an existing local implementation mode, not a live Mattermost result or an automatic runtime fallback.

The existing `loadApprovalProposal()` now accepts the current pair and verifies its source/evidence binding, exact excerpts, hashes, Markdown and deterministic plan. Digests:

```text
Proposal SHA-256: d76139dcefee19a1c08d7525c1861c0b3469064df07504570f765f9f33d78284
Evidence SHA-256: d59a2148dd6075e0aeee7696488a87078d16fb27e839463c6576c0b5ef029ee7
```

Review the current report, not an archived copy, before requesting a challenge. Later regeneration changes the proposal digest and invalidates outstanding approval bindings. If CODEX_CLI provenance is desired, run the existing `npm run triage:incident` in its already working normal terminal **before** requesting approval, preserve the superseded proposal, and review the newly generated digest. Do not weaken CLI safeguards to make it run.

### What is and is not verified about identity

No real human was enrolled and no private signing key was read. This shell lacks Switch credentials. A read-only probe again observed Switch `/health` HTTP 200 and `/openapi.json` HTTP 401. No additional Switch session was opened. Transport metadata is bound by the existing client, but the deployed adapter's server-authenticated human-to-participant mapping has not been independently inspected here. Public documentation, opaque-ID syntax, display names, mentions and room membership cannot substitute for that verification.

Therefore the exact existing configuration remains fail-closed: absent configuration denies approval; `switchIdentity.enabled` must remain false until an operator verifies the deployed build, sender mapping, exact human participant identity and agent participant exclusions. The signed local alternative remains the supported authenticated path while transport identity is insufficient. A local operator must independently verify the enrolled human/public-key binding; neither the helper nor the agent invents that binding.

### Exact operator commands: storage and explicit enrollment

The following three PowerShell helpers are **new preparation tools added in Phase 11A.2**, with no arguments or configuration-format changes. They do not replace or add flags to the existing Node approval CLI. The two mutating helpers were syntax-checked, reviewed and left for the operator; they were **not executed** here.

Run from **normal Windows PowerShell under the same Windows account that runs the existing bridge**, in its existing configured terminal. No credentials need to be copied or changed:

```powershell
Set-Location -LiteralPath (Read-Host 'Absolute path to your BugBridge checkout')
node scripts/check-approval-readiness.mjs
.\scripts\prepare-approval-storage.ps1
if ($LASTEXITCODE -ne 0) { throw 'Storage preparation refused or incomplete; inspect before continuing.' }
.\scripts\check-approval-acl.ps1
if ($LASTEXITCODE -ne 0) { throw 'Approval ACL is not verified.' }
.\scripts\enroll-approval-human.ps1
if ($LASTEXITCODE -ne 0) { throw 'Enrollment was cancelled or needs local review.' }
.\scripts\check-approval-acl.ps1
if ($LASTEXITCODE -ne 0) { throw 'Approval ACL is not verified.' }
node scripts/check-approval-readiness.mjs
```

`prepare-approval-storage.ps1` only creates a **new empty** `.bugbridge-private` directory. It disables inherited ACLs and grants inheritable FullControl only to the current operator SID, SYSTEM and local Administrators. It does not enroll anyone. It refuses an existing directory instead of changing its permissions or contents. If the directory already exists, omit the prepare command, run the checker and have its owner review any failed check; do not remove it, overwrite history, grant broad access or reset ACLs recursively as a shortcut. Setup failure may leave an empty directory; it is not automatically deleted.

The policy uses [Set-Acl](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-acl?view=powershell-5.1) and [protected ACL inheritance](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.objectsecurity.setaccessruleprotection). Existing permissions are never broadened by this helper because it refuses existing storage. If local PowerShell policy prevents script execution, have the operator review the scripts and use their approved local execution procedure; do not add an execution-policy bypass.

`check-approval-acl.ps1` is read-only. It checks root inheritance protection, owner and access-rule SIDs, required operator access, and every existing descendant without following junctions/reparse points. It emits only a fixed status/reason and count, never identities, configuration contents or key material. It is deliberately conservative about unreviewed/deny ACEs. An absent directory returns PENDING; inaccessible, unexpected or unsafe ACLs also remain PENDING. These observations do not establish key-file ACLs or account separation on another machine/account. The Windows runtime's numeric 0600/0700 mode requests alone are not an ACL audit.

`enroll-approval-human.ps1` first requires a passing ACL check and the existing `SWITCH_ROOM_ID`/`SWITCH_AGENT_ID` environment values; it never reads the agent key. It prompts for:

1. The full opaque human participant ID obtained through authenticated Switch administration, independently confirmed as the intended human — never a Mattermost username or ID supplied in chat.
2. The independently verified full participant ID used by the existing bug-triager agent.
3. An absolute path to the intended human's existing **Ed25519 PUBLIC-key PEM**. It refuses a private-key header, directory, oversized file or reparse-point file. No new signing key is generated.

It validates the exact existing config schema and displays only the public SPKI SHA-256 fingerprint. The operator must compare that fingerprint through a trusted separate channel and explicitly type `ENROLL AUTHORIZED HUMAN`. Only then does it create `.bugbridge-private/approval-config.json` with exclusive CreateNew semantics. It refuses an existing config, never alters approval history, and retains `switchIdentity: { enabled: false, verifiedDeployment: "" }`. It does not record an approval or invoke the signer. If any final verification fails, inspect any newly created config locally; no silent repair or overwrite occurs.

The existing allowlist format is unchanged and is documented below. Public-key enrollment is a local administrator action; its existence does not itself authenticate live metadata. To enable Mattermost decisions later, the human administrator must independently audit the deployed mapping, record its build/review in `switchIdentity.verifiedDeployment`, and only then explicitly set `enabled` true. Do not flip that flag based on this document or a successful synthetic test.

`node scripts/check-approval-readiness.mjs` is a new read-only checker of the existing loader and execution-disable boundary. Exit 0 means the evidence/proposal and disabled-execution checks pass, **not** that human identity, ACLs or live acceptance are verified. It reports identity as PENDING, marks any enabled mapping as operator-attested rather than independently verified, and prints no allowlist values. Invalid existing enrollment configuration causes a nonzero exit. No source, enrollment, intent, signature, approval state or connection is created by this checker.

### Exact operator commands: signed local alternative

After explicit enrollment, keep metadata approval disabled if the deployment identity mapping is insufficient. These commands already existed and accept exactly these argument forms:

```powershell
$approvalHumanId = Read-Host 'The exact enrolled human participant ID'
$approvalPrivateKeyPath = Read-Host 'Absolute path to your operator-protected Ed25519 PRIVATE key outside BugBridge; never paste its contents'
node scripts/approval-local.mjs prepare REQUEST INC-001 $approvalHumanId
if ($LASTEXITCODE -ne 0) { throw 'Request preparation failed.' }
# Inspect the unsigned intent LOCALLY: action, room, incident, identity and proposal digest.
Get-Content -LiteralPath .bugbridge-private/unsigned-intent.json
node scripts/sign-approval.mjs $approvalPrivateKeyPath
if ($LASTEXITCODE -ne 0) { throw 'Signing failed.' }
node scripts/approval-local.mjs submit
if ($LASTEXITCODE -ne 0) { throw 'Submission was not accepted; inspect status, do not automatically retry.' }
```

Only the human runs the signing command. Its existing key must remain outside BugBridge and inaccessible to the agent where practical; do not place it in `.bugbridge-private` or disclose it to Codex. Local intent inspection may show a one-time challenge; do not paste private intent/config files into chat or reports. No private signing key is displayed by these commands.

For a pending request, choose **one** decision, review its new unsigned intent, and explicitly sign/submit:

```powershell
$approvalChallenge = Read-Host 'The current challenge returned for this request'
$approvalDecision = Read-Host 'Type APPROVE or REJECT for this request'
if ($approvalDecision -cnotin @('APPROVE','REJECT')) { throw 'No supported decision selected.' }
node scripts/approval-local.mjs prepare $approvalDecision INC-001 $approvalHumanId $approvalChallenge
if ($LASTEXITCODE -ne 0) { throw 'Decision preparation failed.' }
Get-Content -LiteralPath .bugbridge-private/unsigned-intent.json
node scripts/sign-approval.mjs $approvalPrivateKeyPath
if ($LASTEXITCODE -ne 0) { throw 'Signing failed.' }
node scripts/approval-local.mjs submit
```

Both the intent and pending challenge must still be within their validity periods. Another human, another room/digest, a reused signature/challenge or missing signature is rejected. A signed-local success verifies only that path, never live Mattermost. APPROVED still stops without applying code.

### Exact Mattermost commands and acceptance order — all live rows PENDING

Only after verified live metadata setup, use the existing room/client. Do not launch a second bridge session. If restarting is needed, stop the old process in its configured terminal before `npm --prefix switch-bridge start`.

```text
PING BUGBRIDGE
ASK BUGBRIDGE: Explain the approval boundary without changing files.
TRIAGE BUGBRIDGE INC-001
REQUEST FIX BUGBRIDGE INC-001
REJECT BUGBRIDGE INC-001 <challenge>
APPROVE BUGBRIDGE INC-001 <challenge>
```

`<challenge>` means the exact returned 43-character value; it is not a literal argument. Do not approve and reject the same challenge expecting both to succeed. TRIAGE should precede every request whose proposal needs regeneration; review its new digest first. Run the rejection and expiry cases **before** the final successful approval:

| Case | Required live observation | Status |
| --- | --- | --- |
| Missing/disabled trusted identity | REQUEST/APPROVE cannot change state; no fabricated sender or challenge | PENDING |
| Unauthorized human | Approval denied, even if they know the challenge or are in the room | PENDING |
| Wrong room | Message ignored/no state transition; no cross-room response expected | PENDING |
| First valid REQUEST | One same-room AWAITING_APPROVAL reply with summary, digest, expiry and challenge | PENDING |
| Expiry | After more than ten minutes, send APPROVE as a **new human post** with that challenge; expect FAILED/CHALLENGE_EXPIRED | PENDING |
| Rejection | New REQUEST after expiry, then REJECT its new challenge; expect REJECTED | PENDING |
| Reuse after rejection | New APPROVE post using rejected challenge; expect REPLAY_REJECTED, no state change | PENDING |
| Final approval | New REQUEST, then APPROVE its new challenge within ten minutes as the bound human; expect APPROVED and execution disabled | PENDING |
| Reuse after approval | New decision post with consumed challenge; expect replay rejection | PENDING |
| Post-approval REQUEST | DECISION_ALREADY_FINAL; do not erase history to reset the demo | PENDING |
| No patch and responsive bridge | PING/heartbeats continue; source hash unchanged; npm run test:bug still fails for 500 versus 400 | PENDING |

No event/room/sender was impersonated here, no live challenge was requested or consumed, and no successful live test is claimed. Existing automated protocol fixtures remain labeled synthetic.

### Phase 11A.2 executed checks and remaining prerequisites

| Executed check | Result |
| --- | --- |
| npm run reproduce:bug | PASS; valid 201, both empty variants measured 500, current evidence refreshed |
| npm run triage:incident | Exit 1 safely; no Codex success claimed |
| npm run triage:incident -- --source-review | PASS; current matched proposal, explicit LOCAL_SOURCE_REVIEW |
| Existing approval loader and exact digest checks | PASS; all ten source/test references and current evidence match |
| npm run test:phase7 | 124 passed, including all Phase 10 and Phase 11 tests |
| npm test | 46 passed |
| npm run test:investigation | 15 passed |
| Normal tests total | **185 passed**, zero failed/skipped; no existing test changed |
| npm run test:bug | Expected exit 1 for actual 500 INTERNAL_ERROR versus required 400 VALIDATION_ERROR in both variants |
| npm run smoke | PASS; real API entrypoint health/CRUD/bug/recovery |
| ACL read-only check | PENDING, STORAGE_NOT_CREATED; no ACL changed |
| Three new PowerShell helpers | Parse/syntax PASS; mutating setup/enrollment not executed, no real enrollment claimed |
| Execution boundary | FIX_EXECUTION_ENABLED false; executeApprovedFix explicitly refused |
| JavaScript / bridge syntax | All 43 JavaScript files and the configured bridge syntax checks passed |
| Preservation | All 49 protected existing implementation/test/package files unchanged; six historical report copies hash-verified |

The read-only result is saved in `reports/phase11a2-readiness.json`. It records current digests, local-review provenance, normal test counts, archive verification, identity/ACL pending status and the absence of any agent enrollment/live approval. Added preparation files are `scripts/check-approval-readiness.mjs`, `scripts/check-approval-acl.ps1`, `scripts/prepare-approval-storage.ps1`, and `scripts/enroll-approval-human.ps1`. Existing approval/bridge/application code and credentials were not changed.

Human identity remains PENDING, enrollment procedure is READY for explicit operator action, Windows approval ACL remains PENDING, and live Mattermost approval remains NO/PENDING. Existing Switch integration is preserved and its tests pass; the previously reported live integration was not re-tested with credentials here.

Phase 11B is **not ready for live fixing** until operator enrollment/key custody, ACL verification, independent deployed identity verification (or explicitly reviewed signed-local authorization), and real acceptance are recorded. Current local source-review provenance also needs human review; it is not a claim of a fresh Codex CLI run. The separate Phase 11B executor still requires explicit authorization and independent enforcement. Do not enable patch execution as part of setup.

The remainder of this document records the original Phase 11A architecture and verification. Historical timestamps/results below remain historical; the refreshed evidence and current pending statuses above take precedence.

Implementation and verification date: 2026-11-05. Node.js v24.20.0; npm 11.19.0.

**Approval mechanism implemented; patch execution disabled.** The intentional INC-001 bug remains present. All existing 149 normal tests and 36 new approval tests passed. No real human was enrolled, no real approval was recorded, and no live Mattermost approval verification was performed in this environment.

## Architecture

The existing runtime, authenticated Switch client, registered agent, room, Codex runner and reconnect/heartbeat behavior remain in use. The message handler adds three commands, shares its existing duplicate/self-reply protections and routes responses through the same client's configured room. Approval operations do not invoke Codex, a shell, a patch tool, or an integration. They use asynchronous filesystem operations and do not occupy the ASK/TRIAGE execution slot.

```text
Existing Switch socket -> transport-only message provenance
  -> exact command parser -> private explicit human allowlist
  -> trusted sender check OR authenticated signed local submission
  -> proposal/source/evidence verification -> exclusive filesystem lock
  -> single atomic approval ledger + historical snapshots
  -> same-room status response / local operator response

APPROVED -> STOP: Phase 11A execution is unconditionally disabled
```

Modules:

- `approval-protocol.mjs`: strict grammar, private-config validation, opaque identity matching, transport provenance, domain-separated Ed25519 verification, canonical signing representation and digests.
- `approval-service.mjs`: request/approve/reject policies; proposal/source/evidence revalidation; random challenges; binding, expiry and replay checks; safe responses; local intent preparation.
- `approval-store.mjs`: one persistent ledger, exclusive cross-process lock, validated snapshots, file sync, atomic rename, bounded storage and fail-closed crash/corruption handling.
- `approval-files.mjs`: fixed private paths, path/junction checks, restricted creation modes and private intent-file writes.
- `fix-plan.mjs`: a pure deterministic plan for one reviewed controller change, fixed future regression commands, transition design and an execution entry point that always throws `PHASE_11A_EXECUTION_DISABLED`.

## Human identity verification: what is established

The existing wire consumer receives `{room_id, payload}`. It uses `payload.body`, `sender`, `sender_name`, `message_id` and optional `sender_type`. The official [Switch event contract](https://docs.switchagents.ai/switch-rooms/internals/agent-events) documents `payload.sender` as an opaque participant identifier; it must be compared in full. Username mentions, display names and an ID-like string inside a message do not authenticate a human. No identity type is inferred by parsing an ID's text.

The local `GET http://127.0.0.1:8000/health` returned HTTP 200. The schema probe `GET /openapi.json` returned HTTP 401. This shell has no Switch agent credentials, and no new live session was opened. Public protocol documentation and synthetic fixtures do not prove that the deployed Mattermost adapter's actual mapping is authenticated. The user's previously verified live Phase 10 result is preserved as user-reported context; it is not relabeled as a live approval test.

Therefore **live sender authorization defaults closed**. The private configuration must explicitly enable its verified deployment mapping before chat approval can work. There is no automatic enrollment or trust based on room membership.

The existing client attaches provenance in a module-private WeakMap only when it receives a message on its socket. The resolver checks this provenance, exact room and agent, unchanged body/sender/message ID, a nonempty stable message ID, the explicit allowlist and the configured self/agent sender exclusions. JSON fields named `trusted`, `authenticated` or `authenticated_sender` do not create provenance. A deserialized copy of a marked message does not inherit it. The service also verifies that the parsed command matches the provenance-bound body.

`sender_name` is used only for the existing loop filters. It never grants approval authority. Missing metadata, other rooms, disabled/unverified mappings, unknown humans, explicit agent/bot messages, the agent's registered ID and its configured participant IDs cannot authorize decisions.

## Private human enrollment

The only real configuration location is:

```text
.bugbridge-private/approval-config.json
```

The entire directory is ignored by `.gitignore`. No working allowlist, real identity, signing key or credential was generated during implementation. The following is an **incomplete template**, not an enabled configuration:

```json
{
  "version": 1,
  "roomId": "<exact existing Switch room ID>",
  "agentId": "<existing registered agent ID>",
  "agentSenderIds": ["<exact participant ID used by this agent>"],
  "switchIdentity": {
    "enabled": false,
    "verifiedDeployment": ""
  },
  "authorizedHumans": [
    {
      "senderId": "<verified full opaque human participant ID>",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n<operator Ed25519 public key>\n-----END PUBLIC KEY-----\n"
    }
  ]
}
```

An administrator must obtain the existing human participant ID and the agent's own participant ID from an authenticated Switch administrative source, independently verify that the enrolled participant is the intended human, and verify that human's Ed25519 public-key fingerprint through a trusted separate channel. Enroll the public key only. Do not copy an ID from chat text or assume that a Matrix-shaped name proves a human. Duplicate identities/keys and enrollment of the configured agent IDs are rejected. No wildcard or room-wide authorization exists.

Keep private signing keys outside BugBridge, outside the bridge's readable account/environment where practical, and out of Codex prompts. The runtime does not need or load a private signing key. The signing utility accepts only an operator-supplied absolute key path outside this project and checks the key matches the enrolled human's public key. It does not generate keys or change existing credentials. An independently secured signer may instead produce the same canonical Ed25519 envelope.

Protect `.bugbridge-private` before adding the allowlist. On POSIX systems, use owner-only directory/file access (0700/0600); runtime checks reject broad group/world permissions. On Windows, numeric Node mode bits do not enforce ACL privacy. Use the directory's Security settings to disable inherited access and grant only the operator/runtime account plus the required SYSTEM/Administrators access. Inspect the resulting ACL before placing configuration or signing material there. Do not grant other users write access to either the allowlist or the ledger. Windows ACL isolation remains an operator prerequisite; the code does not claim to have audited or modified the current user's ACLs.

For live metadata authorization, verify the deployed Switch build/adapter against its authenticated sender mapping, confirm the human-to-participant binding and own-agent exclusions in the existing room, and record that reviewed deployment/build in `switchIdentity.verifiedDeployment`. Only then set `enabled` true. This is a local administrator trust decision, not something an agent can infer from a chat message. Keep it false until that verification is complete. The [Switch identity documentation](https://docs.switchagents.ai/switch-rooms/internals/identity-and-access) describes the server authorization model; approval allowlisting remains an additional BugBridge restriction.

No `.env`, Switch token, existing credential, Docker file or authentication configuration was changed.

## Commands and responses

After private enrollment and verified live metadata configuration, send these exact uppercase commands with single spaces:

```text
REQUEST FIX BUGBRIDGE INC-001
APPROVE BUGBRIDGE INC-001 <challenge>
REJECT BUGBRIDGE INC-001 <challenge>
```

Surrounding whitespace and the existing optional own-agent mention may be removed by the handler; the command itself is strict. Challenge text is case-sensitive, canonical base64url for 32 random bytes (43 characters). Extra arguments, arbitrary paths, embedded prose, other-agent mentions, lowercase approval verbs, multiple commands and malformed challenges are ignored. Unsupported incident IDs are safely rejected without becoming file paths.

A successful REQUEST validates the matching JSON/Markdown proposal and current source/evidence, describes the minimal change, expected 400 versus valid 201 behavior and post-fix testing plan, and returns a new challenge plus a 10-minute expiry. It binds the pending record to INC-001, the exact proposal-byte SHA-256, exact room, authorized human and public-key fingerprint. The raw challenge is returned as approval instructions; the ledger stores its hash only. No application file is modified.

A successful APPROVE records APPROVED; REJECT records REJECTED. Neither executes a patch in Phase 11A. Responses include the incident, persisted status when available, decision outcome and the execution-disabled boundary. Authentication/storage failures use `STATUS_UNAVAILABLE` rather than fabricating the current persisted status. Private configuration, keys, human IDs and raw exceptions are excluded from replies/logs. Challenges necessarily appear in the challenge instructions; they are not log fields and alone confer no authorization.

## Authenticated out-of-band alternative

This path works with `switchIdentity.enabled: false`. It verifies possession of the enrolled human's Ed25519 private key, binds the signed action to the same incident, room, proposal digest, nonce and validity period, and does not depend on a guessed sender field. It has no network listener and does not open a Switch connection.

After private enrollment and a fresh coherent triage proposal, the human operator runs from BugBridge:

```powershell
node scripts/approval-local.mjs prepare REQUEST INC-001 '<verified-human-participant-id>'
```

Read `.bugbridge-private/unsigned-intent.json` locally and review the action, identity, exact room, incident and proposal digest. Then explicitly sign and submit it:

```powershell
$bbSigningKeyPath = Read-Host 'Path to the existing external signing key; keep the location private'
node scripts/sign-approval.mjs $bbSigningKeyPath
node scripts/approval-local.mjs submit
```

The local response prints the pending challenge. To approve it, explicitly prepare a new intent, inspect it, sign and submit it:

```powershell
node scripts/approval-local.mjs prepare APPROVE INC-001 '<same-verified-human-participant-id>' '<challenge>'
$bbSigningKeyPath = Read-Host 'Path to the existing external signing key; keep the location private'
node scripts/sign-approval.mjs $bbSigningKeyPath
node scripts/approval-local.mjs submit
```

Use REJECT instead of APPROVE to reject. Signing is an explicit operator action; do not automate it on behalf of the human or give the signing key to the agent. The provided helper expects an operator-protected Ed25519 PEM; it has no passphrase collection or key provisioning flow. Use an independently secured signer if that is incompatible with your key custody requirements.

The signed representation recursively sorts object keys (`canonical()`); array ordering is retained. Its domain is `BUGBRIDGE_APPROVAL_V1`. The service rejects unknown envelope fields, invalid signatures, wrong room/identity/proposal, future or expired intents, unsupported actions and spent nonces. A valid signature from another allowlisted human still cannot consume somebody else's challenge. Signed local decisions and chat decisions share the same ledger, so neither can replay the other's spent challenge.

Unsigned/signed intent files are private and may temporarily contain the challenge. Successful submission removes both intent files; pending/consumed ledger records retain only challenge/message hashes. Failed submission leaves the private files for operator review and does not retry automatically. Local submission does not send a Mattermost message or claim live Mattermost verification.

## Persistent state and transitions

State is stored only at `.bugbridge-private/approvals/INC-001.json`. Every request records the reviewed proposal bytes and Markdown, historical sanitized HTTP JSON/Markdown, the exact controller snapshot, digests and a fixed execution plan. Historical public reports are never rewritten by an approval command. A later triage/evidence/source change invalidates the old challenge; formatting-only changes to proposal JSON also change its exact-byte approval digest.

| Status | Meaning and permitted next step |
| --- | --- |
| AWAITING_APPROVAL | Pending human decision; may become APPROVED, REJECTED or FAILED |
| APPROVED | Decision recorded; Phase 11A stops here. APPLYING is reserved for a separately implemented Phase 11B executor |
| REJECTED | This challenge is permanently spent; a distinct authorized REQUEST may create a new record |
| APPLYING | Reserved execution status; never entered by Phase 11A |
| VERIFIED | Reserved successful verification status; never entered by Phase 11A |
| FAILED | Expired/clock-changed or integrity-invalidated challenge; future execution failure status is reserved for Phase 11B |

No chat or API accepts a caller-selected status. One pending request exists at a time. A new REQUEST cannot rotate an unexpired challenge or replace an APPROVED/APPLYING/VERIFIED decision. Expired challenges are consumed as FAILED when an authorized operation encounters them. Wrong humans cannot expire or otherwise consume another person's challenge. A new request after rejection/expiry retains the spent records instead of deleting replay protection.

The exclusive `INC-001.lock` is created with `wx`; concurrent processes cannot enter the transition together. The complete ledger and snapshots are serialized to a unique file, synced, closed and atomically renamed to the fixed state path. POSIX additionally syncs the directory. Windows power-loss durability remains dependent on filesystem/OS guarantees. State is capped at 16 MiB/256 records, and exhaustion fails closed without pruning replay history. Ordinary restart reloads state; consumed challenges and request/decision identities remain rejected.

On corrupt/unreadable state or a crash-left lock, the service refuses changes rather than resetting state. To recover, an operator must first stop all processes that can use this ledger, verify that no approval operation is active, preserve the state/lock for investigation, and inspect the last committed ledger. Only after that may the operator remove the stale lock and restart the existing runtime. Never restore an old pending ledger as a shortcut: backup rollback can reintroduce spent challenges. Do not remove a live lock based on a timeout or PID alone. No automatic destructive recovery or operation retry is implemented.

## Controlled fix design — execution disabled

The sole source target is `src/controllers/tasks.controller.js`. The planner requires the exact existing import and intentional empty-input guard, computes the proposed hash after removing that guard and the unused `isObject` import in memory, and leaves the source file untouched. Codex text and chat cannot specify patch contents, files or shell commands. The private request snapshot is a rollback point and binds the controller's pre-change hash.

The fixed future verification plan includes the unchanged real `tests/regression/empty-body.test.js`, normal API tests and controller syntax. The plan explicitly calls out separate review of the investigation/smoke/Phase 10 preserved-500 policies, which must not be confused with weakening the 400 regression. No Switch credential, Docker or unrelated project path is part of the patch allowlist.

`executeApprovedFix()` always throws, regardless of a supplied approval object or environment variables. There is no enabling environment flag, automatic APPROVED callback, patch writer, shell executor or retry path. The service never calls this function. Tests approve synthetic requests, attempt the disabled entry point and compare all source/evidence bytes before/after. No actual patch is applied even in the tests.

## Historical evidence mismatch found during Phase 11A

At the original Phase 11A verification, the checked-in triage proposal referenced reproduction **2026-11-05T07:28:20.971Z**, while Phase 9 evidence recorded **2026-11-05T07:50:19.268Z** and a different SHA-256. The proposal's source references and JSON/Markdown pair matched, but its evidence binding was stale. The approval loader correctly rejected it. Phase 11A.2 archived both historical sets and replaced the current evidence/proposal with the coherent pair described at the top of this document.

The Phase 11A.2 proposal is already coherent. If regenerating it through the existing live `TRIAGE BUGBRIDGE INC-001` or `npm run triage:incident`, preserve the superseded reports and review the resulting new digest before requesting approval. No regenerated report grants approval. Positive Phase 11A tests create coherent, explicitly local-review proposals only inside temporary test workspaces using real collected evidence.

For fresh Phase 11 reproduction, `npm run reproduce:phase11` calls the unchanged existing `runReproduction()` with a new output destination, `reports/phase11/`. This preserves every byte of the historical Phase 9/10 evidence and proposal instead of overwriting the evidence under review. The resulting HTTP observations still show both empty requests returning 500 INTERNAL_ERROR instead of the required 400 VALIDATION_ERROR.

## Executed verification

| Check | Actual result |
| --- | --- |
| npm run test:phase11 | 36 passed; 0 failed/skipped |
| Existing seven bridge test files, explicit node --test | 88 passed unchanged, including the original 44 and Phase 10's 44 |
| npm run test:phase7 | Expanded bridge suite: 124 passed = 88 existing + 36 Phase 11A |
| npm test | 46 API tests passed |
| npm run test:investigation | 15 investigation tests passed |
| npm run test:phase10 | 44 passed |
| npm run test:bug | Exit 1, expected: both variants actually 500 INTERNAL_ERROR versus asserted 400 VALIDATION_ERROR |
| npm run reproduce:phase11 | Exit 0: actual isolated HTTP baseline 201; both empty variants 500; cleanup and fresh evidence writes passed |
| npm run smoke | Passed real entrypoint HTTP health, CRUD, preserved bug and recovery |
| JavaScript syntax | All 42 project source/script/test files passed |
| npm --prefix switch-bridge run check | Passed all configured bridge modules |
| Operator CLI help | Both local approval and signing help ran without reading credentials |
| Unconfigured real local REQUEST preparation | Exit 1, safely denied; no real configuration, key enrollment or approval state created |
| Preservation hashes | 35 protected original files unchanged; the one expected transport change attaches message provenance |
| Live approval commands / real human enrollment | NOT PERFORMED; PENDING |

The 36 new tests cover the 20 requested categories and additional boundaries: complete signed request/decision flows; exact proposal digests; missing/forged transport provenance; unauthorized/other-bound-human/self approval; wrong room; expiration and clock rollback; signature/domain/action tampering; challenge/nonce/message replay; restart persistence; independent service and OS-process concurrency; rejection/new challenge; malformed grammar; allowlist revocation/key rotation; atomic-failure preservation; corrupt state/crash locks; snapshot tampering; private-path junction rejection; fixed-file planning; unconditional execution refusal; same-room replies; heartbeat during blocked storage; and log/key/challenge privacy.

Total normal automated coverage: **185 passed = 124 bridge + 46 API + 15 investigation**. Phase 10's separate 44-test invocation is included in the bridge total, not added again. The deliberately failing 400 regression remains separate.

Local WebSocket and CLI tests use only synthetic credentials, generated in-memory test keys and temporary directories. They are not live Switch or Mattermost tests. No normal assertion was disabled or weakened. The original source, regression, tests, scripts, Codex runner, Phase 9/10 reports and lockfiles were checked for preservation. No private key, real allowlist or production approval ledger was installed.

## Manual live verification — PENDING

Use the existing agent/room and existing configured runtime terminal. Do not create an agent, room, plugin or parallel live Switch session. Stop the older bridge before starting the updated runtime. Do not paste private keys, Switch tokens or private configuration into Mattermost or this document.

1. Verify the existing authenticated deployment's sender schema and enroll the intended human/own-agent IDs using the private procedure above. Keep metadata approval disabled until verified. Secure the directory ACL and key custody.
2. Generate and review a fresh coherent triage proposal against the current evidence. Confirm status AWAITING_APPROVAL and that the application still reproduces 500.
3. In the existing room, verify PING, ASK and TRIAGE still work. Record real observed results rather than inferring them from unit tests.
4. Send REQUEST FIX BUGBRIDGE INC-001 as the enrolled human. Expect one same-room AWAITING_APPROVAL reply containing the minimal change, effect/testing plan, digest, expiry and new challenge.
5. From an unauthorized account, another room, or without the verified sender mapping, attempt APPROVE. Expect no state transition and no private information. The agent's own replies must not trigger commands.
6. Send the exact APPROVE command as the bound human. Expect one APPROVED response explicitly saying execution is disabled and no fix applied. Reuse must be rejected. Check the private ledger locally; never paste it into the room.
7. Independently test rejection/expiry using new reviewed synthetic requests or an isolated approved test setup. Do not erase a final real APPROVED record to rerun a demo.
8. During pending storage work, verify heartbeat/PING responsiveness and same-room routing. Confirm dedup on a controlled same-message replay, including restart persistence.
9. Re-run the unchanged 400 regression and compare source hashes. It must still fail specifically with observed 500. No application patch may occur in Phase 11A.

If deployed metadata cannot be verified, keep chat approval closed and test the signed local alternative with the independently authenticated human instead. Its success proves that signature path only. Record live Mattermost approval as PENDING until actually observed.

## Limits and Phase 11B requirements

- Filesystem ownership/ACLs, the administrator's enrollment and audited server metadata are trust boundaries. An attacker who can modify the allowlist, application code and ledger under the same OS account is outside this filesystem-based mechanism's protection. Hashes detect inconsistency, not a hostile administrator rewriting everything. Windows ACLs were not audited in this environment.
- The metadata enablement field records an operator's deployment verification; it is not a cryptographic server attestation. Keep it off without that evidence. No live human authorization is claimed here.
- Crash locks intentionally require manual recovery; approval history is bounded and never automatically pruned. There is no distributed database, hardware anti-rollback counter or exactly-once message delivery guarantee. Challenge/nonce consumption is durable in the committed local ledger.
- The provided signer runs under an operator's explicit authority and reads that operator's key locally. It must not be invoked by the bridge or automated by Codex. Use stronger external key custody where required.
- The originally stale proposal/evidence were archived in Phase 11A.2 and the current binding is valid. Real enrollment and live approval verification remain pending; absent/unverified identity configuration still fails closed.
- A challenge expires after ten minutes. APPROVED is a recorded decision, not indefinite permission for a future executor. Phase 11B must separately define an execution deadline/fresh-approval requirement and recheck human/key authorization, proposal/evidence/source/plan integrity and exact edit scope at the instant of execution.

Phase 11B must implement and independently review a gated executor before any file write: bind execution to the immutable approved record; reject stale/revoked/replayed decisions; acquire an execution lock; validate the exact deterministic patch and one-file allowlist; preserve historical snapshots; transition APPROVED -> APPLYING only once; run the unchanged 400 regression and other fixed checks; record VERIFIED or FAILED plus sanitized real evidence; and provide a separately controlled rollback strategy. Failure must preserve evidence and never automatically retry an apply. Any required change to preserved-bug test policies needs explicit review, with the original regression remaining intact.

**Ready for operational Phase 11B: NO**, pending verified identity/enrollment, approval-storage ACL verification, live acceptance and separate explicit authorization to implement/enable the executor. The Phase 11A.2 current proposal/evidence binding passes. The approval mechanism is implemented and available for that next engineering phase. No patching is authorized by this document.

## File inventory

Created:

- `switch-bridge/approval-protocol.mjs`
- `switch-bridge/approval-service.mjs`
- `switch-bridge/approval-store.mjs`
- `switch-bridge/approval-files.mjs`
- `switch-bridge/fix-plan.mjs`
- `scripts/approval-local.mjs`
- `scripts/sign-approval.mjs`
- `scripts/verify-phase11-bug.mjs`
- `switch-bridge/test/phase11-fixture.mjs`
- `switch-bridge/test/phase11-approval.test.mjs`
- `switch-bridge/test/phase11-messages.test.mjs`
- `switch-bridge/test/phase11-cli.test.mjs`
- `reports/phase11/phase9-bug-evidence.json`
- `reports/phase11/phase9-bug-evidence.md`
- `docs/phase11-verification.md`

Modified: `.gitignore`, `package.json`, `switch-bridge/package.json`, `switch-bridge/agent-runtime.mjs`, `switch-bridge/message-handler.mjs`, and `switch-bridge/switch-client.mjs`. No application file, existing test, historical evidence/proposal, lockfile, Docker configuration, environment file or credential was changed. Nothing was committed, pushed or deployed.
