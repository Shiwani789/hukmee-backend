import type { Request } from "express";
import { AppError } from "./errors";

export type AuthContext = NonNullable<Request["auth"]>;

export function authenticatedContext(req: Request): AuthContext {
  if (!req.auth)
    throw new AppError(
      401,
      "UNAUTHORIZED",
      "Authentication required. Please log in.",
    );
  return req.auth;
}
