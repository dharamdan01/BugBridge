import { validateSchema } from "./schema-validator.mjs";

const object = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const literal = value => ({ type: typeof value, enum: [value] });
const text = { type: "string", minLength: 1, maxLength: 1000 };
const choices = values => ({ type: "string", enum: values });
const list = (items, minItems = 1, maxItems = 30) => ({ type: "array", items, minItems, maxItems, uniqueItems: true });
// Keep the model-facing schema within the structured-output subset. Enforce
// uniqueness again in validateAnalysis instead of relying on provider support.
const modelList = (values, count) => ({ type: "array", items: choices(values), minItems: count, maxItems: count });
export const ROOT_CAUSE = "The create controller throws a generic Error for undefined bodies and empty objects before validateTaskInput. Express forwards it to errorHandler, which maps non-HttpError exceptions to 500 INTERNAL_ERROR. The existing validator would reject both inputs with 400 VALIDATION_ERROR.";
export const MINIMAL_FIX = "After separate human approval, remove the intentional empty-input throw branch from create and remove its unused isObject import. Keep validateTaskInput and generic-error sanitization unchanged.";
export const VERIFICATION_PLAN = [
  "After approval: npm run test:bug must pass unchanged; both empty JSON and absent bodies must return 400 VALIDATION_ERROR with no inserted task.",
  "After approval: npm test must pass; valid creation must remain 201 with defaults and Location; other validation and error sanitization must remain intact.",
  "After approval: npm run smoke must pass after its preserved-500 expectation is explicitly reviewed and updated for the approved fixed state.",
  "After approval: review and update the preserved-bug acceptance policy in npm run reproduce:bug, npm run test:investigation and Phase 10 incident acceptance tests; record new real HTTP evidence.",
  "After approval: npm run test:phase7, npm run test:phase10 and JavaScript syntax checks must pass; manually verify existing PING, ASK and triage in the same Mattermost room.",
];
export const RISKS = [
  "Small change to the create validation path; regression risk includes accidentally changing valid creation or generic-error sanitization.",
  "Measured scope is two synthetic requests in a fresh in-memory instance. Production frequency, users affected, retry traffic and business loss were not measured.",
  "No runtime stack trace was collected. Root cause is source-supported analysis, not a measured stack trace. Proposed behavior has not been applied or tested.",
];
export const SOURCE_FILES = [
  "src/app.js", "src/routes/tasks.routes.js", "src/controllers/tasks.controller.js",
  "src/validation/tasks.validation.js", "src/middleware/error-handler.js", "src/services/tasks.service.js",
  "tests/regression/empty-body.test.js", "tests/tasks.test.js",
  "tests/investigation/reproduce-bug.test.mjs", "scripts/reproduce-bug.mjs",
];

// Codex selects evidence-linked interpretations, never arbitrary prose or paths.
// Unknown fields (including model claims of executed tests) fail closed.
export const analysisSchema = object({
  incidentId: literal("INC-001"),
  mechanism: choices(["GENERIC_ERROR_BEFORE_VALIDATION", "INSUFFICIENT_EVIDENCE"]),
  fix: choices(["REMOVE_EMPTY_INPUT_THROW_AND_UNUSED_IMPORT", "INSUFFICIENT_EVIDENCE"]),
  evidenceRefs: modelList(["empty-json", "empty-body", "controller-throw", "controller-validation", "validator-400", "handler-500"], 6),
  verification: modelList(["EMPTY_INPUT_400", "VALID_CREATE_201", "NO_INSERT_ON_REJECTION", "PRESERVE_ERROR_SANITIZATION", "ALL_SUITES_AFTER_APPROVAL"], 5),
});
const scenario = object({
  id: choices(["empty-json", "empty-body"]), method: literal("POST"), route: literal("/api/tasks"),
  bodyBytes: { type: "integer", enum: [0, 2] }, expectedStatus: literal(400), expectedCode: literal("VALIDATION_ERROR"),
  observedStatus: literal(500), observedCode: literal("INTERNAL_ERROR"), observedMessage: literal("Internal server error."),
});
export const proposalSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "BugBridge incident proposal",
  ...object({
    incidentId: literal("INC-001"), title: literal("Empty task creation causes HTTP 500"),
    status: literal("AWAITING_APPROVAL"),
    severity: object({ basis: literal("AI_ANALYSIS"), level: choices(["LOW", "MODERATE", "HIGH"]), rationale: text }),
    problem: literal("Empty task creation is misclassified as a server failure."),
    expectedBehavior: object({ basis: literal("API_CONTRACT"), status: literal(400), code: literal("VALIDATION_ERROR") }),
    observedBehavior: object({ basis: literal("MEASURED_HTTP"), status: literal(500), code: literal("INTERNAL_ERROR"), validCreationStatus: literal(201) }),
    reproductionEvidence: object({
      basis: literal("MEASURED_HTTP"), file: literal("reports/phase9-bug-evidence.json"),
      sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, reproducedAt: text,
      scenarios: list(scenario, 2, 2), storageUnchangedAfterInvalidRequests: literal(true), healthyAfterErrors: literal(true), temporaryServerClosed: literal(true),
    }),
    rootCause: object({ basis: literal("AI_ANALYSIS"), analyst: choices(["CODEX_CLI", "LOCAL_SOURCE_REVIEW"]),
      explanation: literal(ROOT_CAUSE), assessment: analysisSchema }),
    supportingFiles: list(object({
      file: choices(SOURCE_FILES), sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      excerpts: list(object({ line: { type: "integer", minimum: 1 }, text: { type: "string", minLength: 1, maxLength: 500 } })),
    }), SOURCE_FILES.length, SOURCE_FILES.length),
    proposedFix: object({ basis: literal("AI_ANALYSIS"), file: literal("src/controllers/tasks.controller.js"), description: literal(MINIMAL_FIX), applied: literal(false) }),
    riskAssessment: object({ basis: literal("AI_ANALYSIS"), risks: { const: RISKS } }),
    verificationPlan: { const: VERIFICATION_PLAN }, approvalRequired: literal(true),
    generatedAt: { type: "string", pattern: "^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$" },
  }),
};

export function validateAnalysis(value) {
  validateSchema(value, analysisSchema);
  if (new Set(value.evidenceRefs).size !== 6 || new Set(value.verification).size !== 5) throw new Error("Incomplete analysis references");
  if (value.mechanism === "INSUFFICIENT_EVIDENCE" || value.fix === "INSUFFICIENT_EVIDENCE") throw new Error("Insufficient incident analysis");
  return value;
}

export function deriveSeverity(observations) {
  const high = !observations.healthyAfterErrors || !observations.storageUnchangedAfterInvalidRequests || !observations.baseline.passed;
  const level = high ? "HIGH" : observations.scenarios.some(item => item.observed.status >= 500) ? "MODERATE" : "LOW";
  return { basis: "AI_ANALYSIS", level, rationale: high
    ? "Evidence indicates wider availability, storage or valid-creation impact."
    : level === "MODERATE"
      ? "Both invalid requests returned server errors, but valid creation succeeded, health recovered and storage was unchanged. Broader production impact is unknown."
      : "No server-error, health or storage impact appears in the supplied observations." };
}

export function validateProposal(proposal) {
  validateSchema(proposal, proposalSchema);
  validateAnalysis(proposal.rootCause.assessment);
  const evidence = proposal.reproductionEvidence;
  if (new Date(proposal.generatedAt).toISOString() !== proposal.generatedAt ||
      new Date(evidence.reproducedAt).toISOString() !== evidence.reproducedAt || evidence.reproducedAt > proposal.generatedAt) throw new Error("Invalid triage timestamp");
  if (JSON.stringify(proposal.severity) !== JSON.stringify(deriveSeverity({
    ...evidence, baseline: { passed: proposal.observedBehavior.validCreationStatus === 201 },
    scenarios: evidence.scenarios.map(item => ({ observed: { status: item.observedStatus } })),
  }))) throw new Error("Inconsistent impact assessment");
  if (evidence.scenarios[0].id !== "empty-json" || evidence.scenarios[0].bodyBytes !== 2 ||
      evidence.scenarios[1].id !== "empty-body" || evidence.scenarios[1].bodyBytes !== 0 ||
      new Set(proposal.supportingFiles.map(item => item.file)).size !== SOURCE_FILES.length) throw new Error("Inconsistent triage evidence");
  return proposal;
}
