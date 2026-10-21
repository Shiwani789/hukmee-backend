import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { AppError } from "./errors";
import { rememberValidatedInput } from "./validated-request";

type ValidatedRequest = { body?: unknown; params?: unknown; query?: unknown };

export const validate =
  (schema: ZodType<ValidatedRequest>): RequestHandler =>
  (req, res, next) => {
    const input = {
      body: req.body ?? {},
      params: req.params,
      query: req.query,
    };
    const result = schema.safeParse(input);
    if (!result.success) {
      return next(
        new AppError(
          400,
          "VALIDATION_ERROR",
          result.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(", "),
          result.error.issues.map((issue) => ({
            field: issue.path.map(String).join("."),
            message: issue.message,
          })),
        ),
      );
    }
    rememberValidatedInput(res, schema, input);
    const validated = result.data;
    if (validated.body !== undefined) {
      req.body = validated.body;
      res.locals.validatedBody = validated.body;
    }
    res.locals.validatedParams = validated.params;
    res.locals.validatedQuery = validated.query;
    next();
  };
