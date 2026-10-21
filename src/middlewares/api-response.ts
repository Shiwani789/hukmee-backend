import type { RequestHandler, Response } from "express";
import { standardizeSuccessPayload } from "../utils/api-response";

export const standardizeApiResponse: RequestHandler = (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode < 400) {
      const path =
        (req.originalUrl.split("?")[0] ?? "").replace(/^\/api(?:\/v1)?/, "") ||
        "/";
      return originalJson(standardizeSuccessPayload(body, req.method, path));
    }
    return originalJson(body);
  }) as Response["json"];
  next();
};
