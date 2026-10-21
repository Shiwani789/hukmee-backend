import express from "express";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { errorHandler } from "../src/middlewares/errors";

describe("inventory API permission and input boundaries", () => {
  const hubQuery = jest.fn().mockResolvedValue([]);
  let app: express.Express;

  beforeAll(async () => {
    const db = {
      hub: { findMany: hubQuery },
    } as unknown as PrismaClient;
    jest.doMock("../src/config/database", () => ({ prisma: db }));
    jest.doMock("../src/middlewares/auth", () => {
      const { AppError } = jest.requireActual(
        "../src/utils/errors",
      ) as typeof import("../src/utils/errors");
      return {
        authenticate: (
          req: express.Request,
          _res: express.Response,
          next: express.NextFunction,
        ) => {
          if (!req.header("x-test-user"))
            return next(
              new AppError(401, "UNAUTHORIZED", "Authentication required"),
            );
          req.auth = {
            userId: req.header("x-test-user")!,
            sessionId: "session-test",
            roles: ["USER"],
            permissions: req.header("x-test-permission")?.split(",") ?? [],
          };
          next();
        },
        requirePermission:
          (permission: string) =>
          (
            req: express.Request,
            _res: express.Response,
            next: express.NextFunction,
          ) =>
            req.auth?.permissions.includes(permission)
              ? next()
              : next(new AppError(403, "FORBIDDEN", "Permission required")),
      };
    });
    const { default: inventoryRoutes } = await import(
      "../src/modules/inventory/inventory.routes"
    );
    app = express();
    app.use("/api/v1/inventory", inventoryRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => hubQuery.mockClear());

  it("requires the inventory permission before querying data", async () => {
    expect((await request(app).get("/api/v1/inventory/hubs")).status).toBe(401);
    const denied = await request(app)
      .get("/api/v1/inventory/hubs")
      .set("x-test-user", "user-1");
    expect(denied.status).toBe(403);
    expect(hubQuery).not.toHaveBeenCalled();

    const allowed = await request(app)
      .get("/api/v1/inventory/hubs")
      .set("x-test-user", "operator-1")
      .set("x-test-permission", "inventory:manage");
    expect(allowed.status).toBe(200);
    expect(allowed.body.data).toEqual([]);
    expect(hubQuery).toHaveBeenCalledTimes(1);
  });

  it("validates hub IDs and pagination inputs before service queries", async () => {
    const response = await request(app)
      .get("/api/v1/inventory/hubs/not-a-uuid/stock")
      .set("x-test-user", "operator-1")
      .set("x-test-permission", "inventory:manage");
    expect(response.status).toBe(400);

    const invalidLimit = await request(app)
      .get(
        "/api/v1/inventory/hubs/00000000-0000-4000-8000-000000000001/movements",
      )
      .query({ limit: 101 })
      .set("x-test-user", "operator-1")
      .set("x-test-permission", "inventory:manage");
    expect(invalidLimit.status).toBe(400);
    expect(hubQuery).not.toHaveBeenCalled();
  });
});
