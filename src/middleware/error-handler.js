export class HttpError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound(req, res, next) {
  next(new HttpError(404, "ROUTE_NOT_FOUND", "Route not found."));
}

// Express identifies error middleware by its four arguments.
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let failure = error;
  if (error instanceof URIError && error.status === 400) {
    failure = new HttpError(400, "INVALID_PATH", "Request path contains invalid encoding.");
  } else if (error.type === "entity.parse.failed") {
    failure = new HttpError(400, "INVALID_JSON", "Request body must contain valid JSON.");
  } else if (error.type === "entity.too.large") {
    failure = new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds the 16 KiB limit.");
  } else if (error.type === "charset.unsupported" || error.type === "encoding.unsupported") {
    failure = new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported request encoding.");
  }
  const known = failure instanceof HttpError;
  res.status(known ? failure.status : 500).json({
    success: false,
    error: {
      code: known ? failure.code : "INTERNAL_ERROR",
      message: known ? failure.message : "Internal server error.",
      details: known ? failure.details : [],
    },
  });
}
