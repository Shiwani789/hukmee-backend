import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
import { ZodError } from "zod";
import { JsonWebTokenError } from "jsonwebtoken";
import { AppError } from "../utils/errors";
import { env } from "../config/env";
import { sanitizeLogText } from "../config/logger";
import { errorResponse } from "../utils/error-response";

export const notFound: RequestHandler = (_req, res) => {
  res.locals.errorMessage = "Requested resource was not found.";
  res.locals.errorCode = "NOT_FOUND";
  errorResponse(res, 404, "NOT_FOUND", "Requested resource was not found.");
};
export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req,
  res,
  next,
) => {
  if (res.headersSent) return next(error);
  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "Something went wrong. Please try again later.";
  let details: unknown;
  if (error instanceof AppError) {
    status = error.status;
    code = error.code;
    message = error.message;
    details = error.details;
    if (code === "VALIDATION_ERROR")
      message = "Please check the submitted information.";
    else if (code === "INVALID_CREDENTIALS")
      message = "Invalid email/phone or password.";
    else if (code === "UNAUTHORIZED" || code === "SESSION_REVOKED")
      message = "Authentication required. Please log in.";
    else if (code === "FORBIDDEN")
      message = "You do not have permission to perform this action.";
    else if (code === "INVALID_TOKEN")
      message = "Your session is invalid or has expired. Please log in again.";
    else if (code === "INVALID_OTP")
      message =
        "Invalid or expired OTP. Please request a new one and try again.";
    else if (
      code === "OTP_PROVIDER_UNAVAILABLE" ||
      code === "OTP_DELIVERY_FAILED"
    )
      message = "Unable to send OTP right now. Please try again later.";
    else if (code === "NOT_FOUND" || code === "USER_NOT_FOUND")
      message = "Requested record was not found.";
  } else if (error instanceof ZodError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "Please check the submitted information.";
    details = error.issues.map((issue) => ({
      field: issue.path.map(String).join("."),
      message: issue.message,
    }));
  } else if (error instanceof JsonWebTokenError) {
    status = 401;
    code = "INVALID_TOKEN";
    message = "Your session is invalid or has expired. Please log in again.";
  } else if (error instanceof multer.MulterError) {
    status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    code = "INVALID_UPLOAD";
    message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Uploaded image must be 5 MB or smaller."
        : "The uploaded image is invalid.";
  } else if (
    error instanceof Error &&
    (error.message.startsWith("Profile image must") ||
      error.message.startsWith("Catalog image must"))
  ) {
    status = 400;
    code = "INVALID_UPLOAD";
    message = error.message;
  } else if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2000"
  ) {
    status = 400;
    code = "INVALID_INPUT";
    message = "One or more submitted values are too long.";
  } else if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    status = 409;
    code = "DUPLICATE_RESOURCE";
    message = "This record already exists.";
  } else if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P2003", "P2014"].includes(error.code)
  ) {
    status = 409;
    code = "CONFLICT";
    message = "This request conflicts with existing data.";
  } else if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    status = 404;
    code = "NOT_FOUND";
    message = "Requested record was not found.";
  } else if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2024"
  ) {
    status = 503;
    code = "DATABASE_UNAVAILABLE";
    message = "The service is temporarily unavailable.";
  } else if (error instanceof Prisma.PrismaClientInitializationError) {
    status = 503;
    code = "DATABASE_UNAVAILABLE";
    message = "The service is temporarily unavailable.";
  } else if (isBodyParserError(error)) {
    status = error.status;
    code = error.status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON";
    message =
      error.status === 413
        ? "The request payload is too large."
        : "Please check the submitted information.";
  }
  res.locals.errorMessage = message;
  res.locals.errorCode = code;
  if (status >= 500) {
    const type = error instanceof Error ? error.name : "UnknownError";
    const rawMessage = error instanceof Error ? error.message : String(error);
    res.locals.logError = {
      type,
      message: sanitizeLogText(rawMessage),
      ...(env.NODE_ENV === "development" &&
      error instanceof Error &&
      error.stack
        ? { stack: sanitizeLogText(error.stack) }
        : {}),
    };
  }

  errorResponse(res, status, code, message, details);
};

function isBodyParserError(
  error: unknown,
): error is { status: number; type?: string } {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; type?: unknown };
  return (
    (candidate.type === "entity.parse.failed" && candidate.status === 400) ||
    (candidate.type === "entity.too.large" && candidate.status === 413)
  );
}
