import type { RequestHandler } from "express";
import { AppError } from "../utils/errors";

export const requirePermission =
  (permission: string): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth?.permissions.includes(permission))
      return next(
        new AppError(
          403,
          "FORBIDDEN",
          "You do not have permission to perform this action.",
        ),
      );
    next();
  };
