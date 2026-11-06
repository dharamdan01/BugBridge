# Phase 12/13: end-to-end verification

Date: 2026-11-06. Supported result: a reproducible local **investigation and human review** workflow. Automatic fixing, verified live sender authorization and enrolled production human approval are not demonstrated.

Historical Phase 14 added publication/privacy preparation, two exclusion tests and a verified demo API override on port 3100. Its 2026-11-06 07:47 UTC run recorded 300 passed, 0 failed, 1 skipped. The later [communication investigation](ping-communication-investigation.md#actual-local-verification) recorded 278 passed, 22 failed, 5 skipped across its normal suites; native ACL checks were unavailable and a sampled enrollment failure confirmed script restrictions. It was not a full PASS. Phase 16A ran only publication security tests: 11 passed, 0 failed, 0 skipped. See [the dated submission record](submission-checklist.md#phase-14-verification-results). The Phase 12/13 counts/artifacts below remain historical and are not rewritten to hide earlier failures or privacy-review findings.

## Incident and evidence history

INC-001 refers to the BUG-001 marker in `src/controllers/tasks.controller.js`. Empty JSON and absent-body POST `/api/tasks` requests should return 400 VALIDATION_ERROR but return sanitized 500 INTERNAL_ERROR. The generic throw precedes the existing validator. A valid control returns 201, storage is unchanged by rejected empty requests, and health remains 200. Root cause is source-supported analysis; no runtime stack trace was measured. Smallest proposed change: remove the intentional branch and unused isObject import after separate authorization. No change was applied or validated as fixed.

Historical evidence: `reports/phase9-bug-evidence.json` and `.md`; historical Phase 11 reproduction and archived pre-refresh reports are preserved. At Phase 16A review, `reports/incidents/INC-001-triage.json` records AWAITING_APPROVAL, approvalRequired true, applied false and rootCause.analyst CODEX_CLI. Older local-review reports record LOCAL_SOURCE_REVIEW. These are inspected artifact fields, not proof of a fresh model invocation or chat delivery in this review. The operator previously observed real PING, ASK/Codex and TRIAGE successes in earlier sessions. No fresh latest-session TRIAGE response was verified here; current live acceptance remains PENDING. Human enrollment remains incomplete; automatic patch execution remains disabled.

`verify:local` invokes the existing real HTTP reproduction into a **new** timestamp/UUID report folder. It does not rewrite canonical evidence or replace the proposal. Live TRIAGE reads the existing verified evidence; it does not collect fresh HTTP evidence itself. The demo must distinguish evidence timestamp, proposal generation timestamp and live command time.

## Automated coverage and boundaries

| Segment | What is actually exercised | What is not established |
| --- | --- | --- |
| HTTP API/reproduction | Real loopback HTTP, actual Express code, valid 201 plus both 500 cases, storage/health/cleanup | Production traffic, frequency or customer/business impact |
| New combined local E2E test | Real HTTP report, actual triager/file loaders/schema/hash checks/report persistence/message handler/client; slow-analysis heartbeat, PING, duplicate suppression, same-room reply and denied approval | The Switch peer and Codex subprocess are explicitly mocked in isolated temporary fixtures; no deployed session, real model or real human |
| Existing bridge/triage suites | Filtering, PING/ASK/TRIAGE, authenticated synthetic protocol, reconnect/cursors/heartbeat, process sandbox args/EOF/timeouts, error redaction and malformed output rejection | Deployed image equivalence or account authentication |
| Existing approval suites | Real Ed25519 signatures using synthetic keys, expiry, replay, room/identity binding, self/bot rejection, concurrent/restart state, source/evidence integrity | Production key custody, real enrollment or live approval |
| Windows setup suites | Native owner-only ACL prepare/verify, unsafe-parent/inherited/non-owner refusal, synthetic key format/fingerprint/signature tests | Production storage revalidation under a different execution SID |
| Submission scan | Nine fixture tests plus real current-file heuristic scan; no matched secret content printed | Git history/index, excluded files, arbitrary secret formats or complete security |

The combined test creates only a loopback mock Switch fixture, never another connection to the deployed server. Any temporary synthetic proposal carrying CODEX_CLI provenance exists only inside that mocked test fixture and is deleted; it is not a real model execution or submission evidence. The actual verification report explicitly records realCodexInvokedThisRun=false and liveMattermostVerifiedThisRun=false.

## Reproducible full check

Use the exact policy guard and `npm.cmd run verify:local` instructions in [the demo runbook](demo-workflow.md). It runs normal API, investigation, all bridge (including triage/approval/E2E), setup/native ACL, enrollment and submission tests once each, serially; checks every project JavaScript module's syntax; runs the actual API-entrypoint smoke; reproduces the intentional bug; checks the separately failing 400 regression; verifies proposal/disabled execution and protected source/report hashes; and performs the submission scan.

The command does not change execution policy or start real Switch/Codex. It closes child stdin, bounds runtime/output and suppresses raw subprocess errors. Failure, cancellation, missing TAP counts or failed checks yields FAILED_OR_BLOCKED and nonzero exit. Five explicit native Windows ACL success records are required; skipped/missing native checks block completion even if the portable suite exits zero. Fixed failure codes/test ordinals are retained without raw errors. An intentional-regression failure is accepted only alongside independently confirmed 500 observations and its expected error signatures; it is never counted as a passing test. Fresh evidence and `verification.json` are saved under `reports/local-demo/<timestamp>-<uuid>/`; these are evidence artifacts, not a mocked live transcript.

## Historical Phase 12/13 results

Final report: [verification.json](../reports/local-demo/2026-11-06T07-02-23-537Z-be6e44da-f5cd-4d32-8492-b377d8031108/verification.json). Fresh [HTTP evidence JSON](../reports/local-demo/2026-11-06T07-02-23-537Z-be6e44da-f5cd-4d32-8492-b377d8031108/phase9-bug-evidence.json) and [Markdown](../reports/local-demo/2026-11-06T07-02-23-537Z-be6e44da-f5cd-4d32-8492-b377d8031108/phase9-bug-evidence.md) are separate from historical reports. This final run also confirms the verifier's explicit nativeAcl=VERIFIED_SYNTHETIC_FIXTURES gate; repeated successful runs are not added to the distinct test count.

| Suite/check | Passed | Unexpected failed | Skipped |
| --- | --- | --- | --- |
| Normal API | 46 | 0 | 0 |
| Investigation | 15 | 0 | 0 |
| All bridge, triage, approval and local E2E | 141 | 0 | 0 |
| Approval setup including native Windows ACL | 64 | 0 | 1 |
| Enrollment fixtures | 23 | 0 | 0 |
| New submission scanner tests | 9 | 0 | 0 |
| **Total distinct normal cases** | **298** | **0** | **1** |
| Separate intentional 400 regression | 0 | **1 expected failure** | 0 |

The ten new cases comprise one integrated local workflow and nine submission-scanner cases. Do not add overlapping focused phase10/phase11/local-e2e counts to the bridge total. Native owner-only prepare/verify and unsafe-parent/inherited/non-owner rejection tests actually executed. The sole skip is the existing test that requires a Restricted script host; this run used the previously authorized temporary Process RemoteSigned with no Group Policy override. Five PowerShell scripts passed Parser.ParseFile syntax checks without executing them. All JavaScript syntax and real API-entrypoint smoke checks passed; exact file count is recorded in the JSON.

Real HTTP reproduction passed as **known-bug reproduction**, with valid 201 and both empty variants 500 versus expected 400. Temporary server cleanup, protected source/canonical report hashes, proposal integrity and disabled executor passed. No real Codex/deployed Switch was invoked. The final heuristic scan returned zero selected secret-pattern findings, four historical documentation privacy-review locations, no Git history metadata and submissionApproved=false. Advisory audits for both packages returned no advisory metadata, so dependency vulnerability status remains UNVERIFIED.

Earlier attempts are retained as separate FAILED_OR_BLOCKED reports: the first stopped at setup (63 passed, 1 failed, 1 skipped); its raw detail was not retained, and a direct rerun passed 64/65 with the one disclosed skip. Another complete attempt captured EBUSY in bridge fixture teardown. Bounded native rm retries were added **only** to validated temporary approval/CLI fixture directories (maximum five retries, 200 ms initial delay); persistent failures still fail, and production operations/security assertions/timeouts were unchanged. The final complete run above passed after that correction. No automatic suite rerun hides a failure in the verifier.

## Manual live acceptance — PENDING this run

- [ ] Confirm existing Docker services and the **single existing** bridge remain running. Do not recreate/reconnect them to collect proof.
- [ ] In the already-configured `bugbridge-incidents` room, send a fresh `PING BUGBRIDGE`; observe one same-room reply.
- [ ] Send the runbook's harmless ASK; observe a fresh real Codex response. Never use private prompts.
- [ ] Archive the current proposal pair as described in the runbook before live TRIAGE; do not refresh evidence blindly.
- [ ] Send `TRIAGE BUGBRIDGE INC-001`. Observe real Codex activity through safe event counters and exactly one same-room structured summary.
- [ ] Inspect the newly generated JSON/Markdown, measured evidence references/hashes, analyst CODEX_CLI, source cause, minimal unapplied fix, risk and future verification plan. Record fresh timestamps, not an old chat screenshot.
- [ ] Confirm status AWAITING_APPROVAL, approvalRequired true and applied false. Recheck proposal integrity afterwards.
- [ ] If demonstrating denial, send only `REQUEST FIX BUGBRIDGE INC-001`; absent enrollment/unverified identity must deny. A denial is successful protection, not successful approval. Do not enroll, enable metadata approval, sign/submit intents or invent a challenge.
- [ ] Confirm both empty HTTP variants still return 500, source remains unchanged and execution remains disabled.
- [ ] Record only the reviewed room/reports/safe counters; redact all personal IDs, profile paths, avatars/names and credentials. Label pre-recorded footage honestly.

An earlier operator-reported live triage success is acknowledged. None of these fresh manual boxes was checked by automation; no live approval success is claimed. Deployed sender authentication and bot classification remain unverified, with exact read-only steps in `phase11-final-security-audit.md`.
