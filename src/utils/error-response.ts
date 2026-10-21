import type { Response } from "express";

/** Standard flat envelope with the historical nested alias for older clients. */
export function errorResponse(
  res: Response,
  status: number,
  code: string,
  message: string,
  errors?: unknown,
): Response {
  const requestId = res.locals.requestId as string | undefined;
  return res.status(status).json({
    success: false,
    message,
    code,
    ...(errors !== undefined ? { errors } : {}),
    ...(requestId ? { requestId } : {}),
    error: {
      code,
      message,
      ...(errors !== undefined ? { details: errors } : {}),
      ...(requestId ? { requestId } : {}),
    },
  });
}
