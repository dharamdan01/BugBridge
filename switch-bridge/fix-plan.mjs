import { digest } from "./approval-protocol.mjs";

export const FIX_EXECUTION_ENABLED = false;
export const FIX_SOURCE_ALLOWLIST = Object.freeze(["src/controllers/tasks.controller.js"]);
export const APPROVAL_TRANSITION_DESIGN = Object.freeze({
  AWAITING_APPROVAL: ["APPROVED", "REJECTED", "FAILED"],
  APPROVED: ["APPLYING"], REJECTED: [], APPLYING: ["VERIFIED", "FAILED"], VERIFIED: [], FAILED: [],
});
export const FIX_CHECKS = Object.freeze([
  { program: "node", args: ["--test", "tests/regression/empty-body.test.js"], expected: "Both empty inputs return 400 VALIDATION_ERROR; no task inserted" },
  { program: "node", args: ["--test", "tests/tasks.test.js"], expected: "All normal API tests pass; valid creation remains 201" },
  { program: "node", args: ["--check", "src/controllers/tasks.controller.js"], expected: "Patched controller parses" },
]);

// Pure preparation, never a filesystem writer or command executor. Even an
// APPROVED record cannot enable execution in Phase 11A.
export function prepareFixPlan(incidentId, controllerText) {
  if (incidentId !== "INC-001" || typeof controllerText !== "string") throw new Error("Unsupported fix plan");
  const eol = controllerText.includes("\r\n") ? "\r\n" : "\n";
  const originalImport = 'import { isObject, validateTaskInput } from "../validation/tasks.validation.js";';
  const guard = [
    '      if (req.body === undefined || (isObject(req.body) && Object.keys(req.body).length === 0)) {',
    '        // BUG-001: intentionally misclassified empty-body validation failure.',
    '        // Preserve for the AI investigation demo. test:bug expects HTTP 400.',
    '        // Generic errors are safely converted to HTTP 500 by errorHandler.',
    '        throw new Error("BUG-001: empty task body bypasses validation");',
    '      }', "",
  ].join(eol);
  if (controllerText.split(originalImport).length !== 2 || controllerText.split(guard).length !== 2 ||
      controllerText.split("isObject").length !== 3) throw new Error("Controller does not match reviewed patch strategy");
  const proposedText = controllerText.replace(originalImport, 'import { validateTaskInput } from "../validation/tasks.validation.js";').replace(guard, "");
  return {
    version: 1, incidentId, executionEnabled: false, strategy: "REMOVE_EMPTY_GUARD_AND_UNUSED_IMPORT",
    files: [{ path: FIX_SOURCE_ALLOWLIST[0], beforeSha256: digest(controllerText), proposedSha256: digest(proposedText) }],
    verification: FIX_CHECKS,
    rollback: "Restore the exact controller snapshot only after separate Phase 11B authorization; never retry an apply automatically.",
    policyReviewRequired: "Phase 9 investigation, smoke and Phase 10 acceptance currently require HTTP 500; review those policies separately without weakening the 400 regression.",
  };
}
export async function executeApprovedFix() {
  throw new Error("PHASE_11A_EXECUTION_DISABLED");
}
