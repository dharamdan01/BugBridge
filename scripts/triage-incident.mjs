import { createCodexRunner } from "../switch-bridge/codex-runner.mjs";
import { loadIncident, buildProposal, writeTriageReports, createIncidentTriager, summarizeTriage } from "../switch-bridge/incident-triage.mjs";

try {
  const [id, option, ...extra] = process.argv.slice(2);
  if (extra.length || (option !== undefined && option !== "--source-review")) throw new Error("Invalid arguments");
  let proposal;
  if (option === "--source-review") {
    // Explicit local review mode for environments where CLI login is unavailable.
    // Never used as a fallback by Switch; never claims Codex CLI execution.
    proposal = buildProposal(await loadIncident(id), {
      incidentId: "INC-001", mechanism: "GENERIC_ERROR_BEFORE_VALIDATION", fix: "REMOVE_EMPTY_INPUT_THROW_AND_UNUSED_IMPORT",
      evidenceRefs: ["empty-json", "empty-body", "controller-throw", "controller-validation", "validator-400", "handler-500"],
      verification: ["EMPTY_INPUT_400", "VALID_CREATE_201", "NO_INSERT_ON_REJECTION", "PRESERVE_ERROR_SANITIZATION", "ALL_SUITES_AFTER_APPROVAL"],
    }, { analyst: "LOCAL_SOURCE_REVIEW" });
    await writeTriageReports(proposal);
  } else {
    proposal = await createIncidentTriager({ askCodex: createCodexRunner() })(id);
  }
  console.log(summarizeTriage(proposal));
  console.log(`Analysis origin: ${proposal.rootCause.analyst}.`);
} catch {
  console.error("BugBridge triage failed: unsupported incident, incomplete evidence, source drift, Codex execution/analysis or report-writing failure. No new proposal accepted; existing reports may be stale. No fix applied.");
  process.exitCode = 1;
}
