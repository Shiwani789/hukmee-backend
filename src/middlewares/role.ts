import type { RequestHandler } from "express";
import { AppError } from "../utils/errors";

export const requireRole =
  (...allowed: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth || !allowed.some((role) => req.auth?.roles.includes(role)))
      return next(
        new AppError(
          403,
          "FORBIDDEN",
          "You do not have permission to perform this action.",
        ),
      );
    next();
  };
