import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-request-id");
  const id =
    incoming && /^[\w.-]{1,100}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader("x-request-id", id);
  res.locals.requestId = id;
  next();
};
