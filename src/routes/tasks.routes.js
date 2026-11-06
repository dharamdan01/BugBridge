import { Router } from "express";
import { createTasksController } from "../controllers/tasks.controller.js";
import { validateTaskId } from "../validation/tasks.validation.js";

export function createTasksRouter(service) {
  const router = Router();
  const controller = createTasksController(service);
  router.param("id", validateTaskId);
  router.route("/").get(controller.list).post(controller.create);
  router.route("/:id").get(controller.get).patch(controller.update).delete(controller.delete);
  return router;
}
