import { runReproduction } from "./reproduce-bug.mjs";

// New evidence destination preserves every byte of the reviewed Phase 9/10
// proposal and evidence. This invokes the existing real HTTP reproduction.
try {
  const { report, exitCode } = await runReproduction({ directory: new URL("../reports/phase11/", import.meta.url) });
  console.log(`INC-001 Phase 11 reproduction: ${report.outcome}; valid baseline HTTP ${report.verifiedObservations.baseline.observed.status}.`);
  for (const s of report.verifiedObservations.scenarios) console.log(`${s.id}: expected ${s.expected.status} ${s.expected.errorCode}; observed ${s.observed.status} ${s.observed.error.code}.`);
  console.log("Historical Phase 9/10 evidence preserved; fresh evidence: reports/phase11/phase9-bug-evidence.json and .md. No fix applied.");
  process.exitCode = exitCode;
} catch {
  console.error("Phase 11 reproduction failed; no success claimed. No fix applied.");
  process.exitCode = 1;
}
