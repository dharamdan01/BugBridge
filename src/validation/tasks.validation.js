import { HttpError } from "../middleware/error-handler.js";

export const TASK_STATUSES = Object.freeze(["todo", "in_progress", "done"]);
const fields = new Set(["title", "description", "status"]);
export const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function validateTaskInput(body, { partial = false } = {}) {
  const details = [];
  if (!isObject(body)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid task input.", [
      { field: "body", message: "Must be a JSON object." },
    ]);
  }
  if (partial && Object.keys(body).length === 0) {
    details.push({ field: "body", message: "Provide at least one task field." });
  }
  if (Object.keys(body).some(key => !fields.has(key))) {
    details.push({ field: "body", message: "Only title, description and status may be supplied." });
  }
  const has = key => Object.hasOwn(body, key);
  if ((!partial || has("title")) &&
      (typeof body.title !== "string" || body.title.trim().length === 0 || body.title.trim().length > 200)) {
    details.push({ field: "title", message: "Must be a nonempty string of at most 200 characters." });
  }
  if (has("description") && (typeof body.description !== "string" || body.description.length > 2000)) {
    details.push({ field: "description", message: "Must be a string of at most 2000 characters." });
  }
  if (has("status") && !TASK_STATUSES.includes(body.status)) {
    details.push({ field: "status", message: "Must be todo, in_progress or done." });
  }
  if (details.length) throw new HttpError(400, "VALIDATION_ERROR", "Invalid task input.", details);

  const result = {};
  if (has("title")) result.title = body.title.trim();
  if (has("description")) result.description = body.description.trim();
  if (has("status")) result.status = body.status;
  return result;
}

export function validateTaskId(req, res, next, id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return next(new HttpError(400, "INVALID_TASK_ID", "Task ID must be a UUID v4."));
  }
  next();
}
