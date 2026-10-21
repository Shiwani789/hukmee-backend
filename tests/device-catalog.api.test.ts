import express from "express";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { errorHandler } from "../src/middlewares/errors";

const deviceId = "00000000-0000-4000-8000-000000000101";
const modelId = "00000000-0000-4000-8000-000000000102";
const brandId = "00000000-0000-4000-8000-000000000103";
const serviceId = "00000000-0000-4000-8000-000000000104";

describe("device and catalogue APIs", () => {
  const devices = new Map<string, Record<string, unknown>>();
  const brandQuery = jest
    .fn()
    .mockResolvedValue([{ id: brandId, name: "Example" }]);
  const modelQuery = jest.fn().mockResolvedValue([
    {
      id: modelId,
      name: "Model One",
      brand: { id: brandId, name: "Example" },
    },
  ]);
  const serviceQuery = jest.fn().mockResolvedValue([
    {
      id: serviceId,
      name: "Screen repair",
      category: { id: "cat-1", name: "Repair" },
      partMappings: [],
    },
  ]);
  let app: express.Express;

  beforeAll(async () => {
    const db = {
      deviceModel: {
        findFirst: async ({ where }: { where: { id: string } }) =>
          where.id === modelId ? { id: modelId } : null,
        findMany: modelQuery,
      },
      brand: { findMany: brandQuery },
      repairService: { findMany: serviceQuery },
      userDevice: {
        findMany: async ({ where }: { where: { userId: string } }) =>
          [...devices.values()].filter(
            (device) => device.userId === where.userId,
          ),
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const device = {
            ...data,
            id: deviceId,
            userId: "user-1",
            model: {
              id: modelId,
              name: "Model One",
              brand: { id: brandId, name: "Example" },
            },
          };
          devices.set(deviceId, device);
          return device;
        },
        findFirst: async ({
          where,
        }: {
          where: { id: string; user: { id: string } };
        }) => {
          const device = devices.get(where.id);
          return device?.userId === "user-1" && where.user.id === "user-1"
            ? device
            : null;
        },
      },
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
          const userId = req.header("x-test-user");
          if (!userId)
            return next(
              new AppError(401, "UNAUTHORIZED", "Authentication required"),
            );
          req.auth = {
            userId,
            sessionId: "session-test",
            roles: [req.header("x-test-role") ?? "USER"],
            permissions: [],
          };
          next();
        },
        requireRole:
          (...roles: string[]) =>
          (
            req: express.Request,
            _res: express.Response,
            next: express.NextFunction,
          ) =>
            req.auth && roles.some((role) => req.auth?.roles.includes(role))
              ? next()
              : next(new AppError(403, "FORBIDDEN", "Insufficient role")),
      };
    });
    const [{ default: deviceRoutes }, { default: catalogRoutes }] =
      await Promise.all([
        import("../src/modules/devices/device.routes"),
        import("../src/modules/catalog/catalog.routes"),
      ]);
    app = express();
    app.use(express.json());
    app.use("/api/v1/devices", deviceRoutes);
    app.use("/api/v1/catalog", catalogRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    devices.clear();
    brandQuery.mockClear();
    modelQuery.mockClear();
    serviceQuery.mockClear();
  });

  it("creates and returns only an owned device; validates role and model", async () => {
    expect((await request(app).get("/api/v1/devices")).status).toBe(401);
    const forbidden = await request(app)
      .post("/api/v1/devices")
      .set("x-test-user", "admin-1")
      .set("x-test-role", "ADMIN")
      .send({ modelId });
    expect(forbidden.status).toBe(403);

    const invalid = await request(app)
      .post("/api/v1/devices")
      .set("x-test-user", "user-1")
      .send({ modelId: "bad-id" });
    expect(invalid.status).toBe(400);

    const unavailable = await request(app)
      .post("/api/v1/devices")
      .set("x-test-user", "user-1")
      .send({ modelId: "00000000-0000-4000-8000-000000000199" });
    expect(unavailable.status).toBe(404);

    const created = await request(app)
      .post("/api/v1/devices")
      .set("x-test-user", "user-1")
      .send({ modelId, nickname: "My phone" });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      id: deviceId,
      nickname: "My phone",
    });

    expect(
      (
        await request(app)
          .get(`/api/v1/devices/${deviceId}`)
          .set("x-test-user", "user-1")
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/v1/devices/${deviceId}`)
          .set("x-test-user", "user-2")
      ).status,
    ).toBe(404);
  });

  it("serves active catalogue reads and validates filter IDs", async () => {
    expect(
      (await request(app).get("/api/v1/catalog/brands")).body.data,
    ).toEqual([{ id: brandId, name: "Example" }]);
    expect(
      (await request(app).get("/api/v1/catalog/models").query({ brandId }))
        .status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get("/api/v1/catalog/models")
          .query({ brandId: "bad-id" })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).get("/api/v1/catalog/services").query({ modelId }))
        .status,
    ).toBe(200);
    expect(modelQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ active: true }),
      }),
    );
    expect(serviceQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ active: true }),
      }),
    );
  });
});
