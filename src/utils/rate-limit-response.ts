import type { Response } from "express";
import { errorResponse } from "./error-response";

export function sendRateLimitResponse(res: Response): void {
  const message = "Too many requests. Please try again later.";
  res.locals.errorMessage = message;
  res.locals.errorCode = "RATE_LIMITED";
  errorResponse(res, 429, "RATE_LIMITED", message);
}
