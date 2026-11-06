import { isObject, validateTaskInput } from "../validation/tasks.validation.js";

export function createTasksController(service) {
  return {
    list(req, res) {
      res.json({ success: true, data: service.list() });
    },
    get(req, res) {
      res.json({ success: true, data: service.get(req.params.id) });
    },
    create(req, res) {
      if (req.body === undefined || (isObject(req.body) && Object.keys(req.body).length === 0)) {
        // BUG-001: intentionally misclassified empty-body validation failure.
        // Preserve for the AI investigation demo. test:bug expects HTTP 400.
        // Generic errors are safely converted to HTTP 500 by errorHandler.
        throw new Error("BUG-001: empty task body bypasses validation");
      }
      const task = service.create(validateTaskInput(req.body));
      res.location(`/api/tasks/${task.id}`).status(201).json({ success: true, data: task });
    },
    update(req, res) {
      // Resolve existence before validating the proposed update.
      service.get(req.params.id);
      const task = service.update(req.params.id, validateTaskInput(req.body, { partial: true }));
      res.json({ success: true, data: task });
    },
    delete(req, res) {
      res.json({ success: true, data: service.delete(req.params.id) });
    },
  };
}
