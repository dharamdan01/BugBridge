import { randomUUID } from "node:crypto";
import { HttpError } from "../middleware/error-handler.js";

export function createTasksService() {
  const tasks = new Map();

  function get(id) {
    const task = tasks.get(id.toLowerCase());
    if (!task) throw new HttpError(404, "TASK_NOT_FOUND", "Task not found.");
    return { ...task };
  }

  return {
    list() {
      return [...tasks.values()].map(task => ({ ...task }));
    },
    get,
    create({ title, description = "", status = "todo" }) {
      const time = new Date().toISOString();
      const task = { id: randomUUID(), title, description, status, createdAt: time, updatedAt: time };
      tasks.set(task.id, task);
      return { ...task };
    },
    update(id, changes) {
      const task = { ...get(id), ...changes, updatedAt: new Date().toISOString() };
      tasks.set(task.id, task);
      return { ...task };
    },
    delete(id) {
      const task = get(id);
      tasks.delete(task.id);
      return { id: task.id };
    },
  };
}
