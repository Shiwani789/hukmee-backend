import express from "express";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { errorHandler } from "../src/middlewares/errors";

describe("technician self-service read APIs", () => {
  const findProfile = jest.fn(
    async ({
      where,
      select,
    }: {
      where: { userId: string };
      select?: { skills?: unknown };
    }) => {
      if (where.userId !== "tech-1") return null;
      const base = {
        active: true,
        approvedAt: new Date("2026-01-01T00:00:00.000Z"),
      };
      return select?.skills
        ? {
            ...base,
            skills: [
              {
                serviceId: "service-1",
                service: { name: "Screen repair", active: true },
              },
            ],
          }
        : base;
    },
  );
  let app: express.Express;

  beforeAll(async () => {
    const db = {
      technicianProfile: { findUnique: findProfile },
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
    const { default: technicianRoutes } = await import(
      "../src/modules/technician/technician.routes"
    );
    app = express();
    app.use("/api/v1/technicians", technicianRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => findProfile.mockClear());

  it("requires TECHNICIAN and returns only the caller's profile fields", async () => {
    const unauthenticated = await request(app).get(
      "/api/v1/technicians/profile",
    );
    expect(unauthenticated.status).toBe(401);

    const forbidden = await request(app)
      .get("/api/v1/technicians/profile")
      .set("x-test-user", "user-1");
    expect(forbidden.status).toBe(403);
    expect(findProfile).not.toHaveBeenCalled();

    const response = await request(app)
      .get("/api/v1/technicians/profile")
      .set("x-test-user", "tech-1")
      .set("x-test-role", "TECHNICIAN");
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      active: true,
      approvedAt: "2026-01-01T00:00:00.000Z",
      skills: [{ serviceId: "service-1", service: { name: "Screen repair" } }],
    });
    expect(response.body.data.userId).toBeUndefined();
    expect(response.body.data.documentUrl).toBeUndefined();
    expect(findProfile).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "tech-1" } }),
    );
  });

  it("returns existing approval metadata without inventing onboarding states", async () => {
    const response = await request(app)
      .get("/api/v1/technicians/onboarding/status")
      .set("x-test-user", "tech-1")
      .set("x-test-role", "TECHNICIAN");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      active: true,
      approvedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(response.body.data.status).toBeUndefined();
    expect(response.body.data.rejectionReason).toBeUndefined();
  });

  it("does not expose another user's technician profile", async () => {
    const response = await request(app)
      .get("/api/v1/technicians/profile")
      .set("x-test-user", "tech-2")
      .set("x-test-role", "TECHNICIAN");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("TECHNICIAN_PROFILE_NOT_FOUND");
    expect(findProfile).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "tech-2" } }),
    );
  });
});
