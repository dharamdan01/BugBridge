import express from "express";
import { createTasksRouter } from "./routes/tasks.routes.js";
import { createTasksService } from "./services/tasks.service.js";
import { HttpError, errorHandler, notFound } from "./middleware/error-handler.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const hasBody = Number(req.headers["content-length"] || 0) > 0 || Boolean(req.headers["transfer-encoding"]);
    if (["POST", "PATCH"].includes(req.method) && hasBody && !req.is("application/json")) {
      return next(new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json."));
    }
    next();
  });
  // Allow JSON primitives through parsing so the validator can reject them uniformly.
  app.use(express.json({ limit: "16kb", strict: false }));
  app.get("/health", (req, res) => res.json({ success: true, data: { status: "ok" } }));
  // Each application instance owns its storage; tests and server runs are isolated.
  app.use("/api/tasks", createTasksRouter(createTasksService()));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
