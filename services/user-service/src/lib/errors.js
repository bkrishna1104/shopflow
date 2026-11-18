// One error type + one error handler = consistent JSON errors from every service.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(req, res) {
  res.status(404).json({ error: 'Not Found', path: req.path });
}

export function errorHandler(logger) {
  // Express recognises error handlers by their 4 arguments, so `next` must stay.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) logger.error({ err, path: req.path }, 'request failed');
    res.status(status).json({
      // Never leak internal messages / stack traces to clients on 5xx.
      error: status >= 500 && !(err instanceof HttpError) ? 'Internal Server Error' : err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  };
}
