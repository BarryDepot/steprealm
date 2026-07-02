// Central error handling.
//
// Domain errors (GameRuleError, NotFoundError, BadRequestError) carry their own
// HTTP status. Anything else is an unexpected failure: it is logged in full on
// the server and reported to the client as a bare 500, so internal details and
// SQL text never reach the device.

import type { Request, Response, NextFunction } from 'express';

interface StatusError extends Error {
  status?: number;
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'No such endpoint.' });
}

export function errorHandler(
  err: StatusError,
  _req: Request,
  res: Response,
  // Express identifies error middleware by arity, so `next` must stay in the
  // signature even though it is unused.
  _next: NextFunction
): void {
  const status = err.status ?? 500;

  if (status >= 500) {
    console.error('[error]', err);
    res.status(status).json({ error: 'Internal server error.' });
    return;
  }

  res.status(status).json({ error: err.message });
}
