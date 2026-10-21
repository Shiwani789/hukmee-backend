import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { JsonWebTokenError } from "jsonwebtoken";
import { errorHandler, notFound } from "../src/middlewares/errors";
import { requestId } from "../src/middlewares/request-id";
import { AppError } from "../src/utils/errors";

function createApp() {
  const app = express();
  app.use(requestId);
  app.get("/unauthorized", (_req, _res, next) =>
    next(new AppError(401, "UNAUTHORIZED", "Authentication is required")),
  );
  app.get("/forbidden", (_req, _res, next) =>
    next(new AppError(403, "FORBIDDEN", "Access denied")),
  );
  app.get("/invalid-token", (_req, _res, next) =>
    next(new JsonWebTokenError("invalid token")),
  );
  app.get("/duplicate", (_req, _res, next) =>
    next(
      new Prisma.PrismaClientKnownRequestError("unique constraint", {
        code: "P2002",
        clientVersion: "test",
      }),
    ),
  );
  app.get("/unexpected", (_req, _res, next) =>
    next(new Error("database password=hidden")),
  );
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

describe("central error responses", () => {
  const app = createApp();

  it("preserves unauthorized and forbidden status codes", async () => {
    const unauthorized = await request(app).get("/unauthorized");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.code).toBe("UNAUTHORIZED");
    expect(unauthorized.body.requestId).toBeTruthy();

    const forbidden = await request(app).get("/forbidden");
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe("FORBIDDEN");
  });

  it("maps invalid tokens and missing routes predictably", async () => {
    const invalidToken = await request(app).get("/invalid-token");
    expect(invalidToken.status).toBe(401);
    expect(invalidToken.body.code).toBe("INVALID_TOKEN");

    const missing = await request(app).get("/missing");
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("NOT_FOUND");
    expect(missing.body.message).toBe("Requested resource was not found.");
  });

  it("maps Prisma unique constraint errors to a safe conflict response", async () => {
    const response = await request(app).get("/duplicate");
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("DUPLICATE_RESOURCE");
    expect(response.body.message).not.toContain("unique constraint");
  });

  it("hides unexpected internal error details from API responses", async () => {
    const response = await request(app).get("/unexpected");
    expect(response.status).toBe(500);
    expect(response.body.code).toBe("INTERNAL_ERROR");
    expect(response.body.message).toBe(
      "Something went wrong. Please try again later.",
    );
    expect(JSON.stringify(response.body)).not.toContain("database password");
  });
});
