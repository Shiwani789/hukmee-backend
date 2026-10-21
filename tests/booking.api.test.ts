import express from "express";
import request from "supertest";
import { AssignmentStatus, BookingStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { errorHandler } from "../src/middlewares/errors";

const bookingId = "00000000-0000-4000-8000-000000000001";

describe("booking assignment decision API", () => {
  const state = {
    bookingStatus: BookingStatus.ASSIGNED as BookingStatus,
    assignmentStatus: AssignmentStatus.OFFERED as AssignmentStatus,
    events: [] as Record<string, unknown>[],
    audits: [] as Record<string, unknown>[],
  };
  let app: express.Express;

  beforeAll(async () => {
    const fakeDb = {
      technicianProfile: {
        findMany: async () => [{ userId: "tech-1" }],
      },
      booking: {
        findUnique: async () => ({
          id: bookingId,
          status: state.bookingStatus,
        }),
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; status: BookingStatus };
          data: { status: BookingStatus };
        }) => {
          if (where.id !== bookingId || where.status !== state.bookingStatus)
            return { count: 0 };
          state.bookingStatus = data.status;
          return { count: 1 };
        },
      },
      repairAssignment: {
        findFirst: async ({
          where,
        }: {
          where: { bookingId: string; technician: { userId: string } };
        }) =>
          where.bookingId === bookingId && where.technician.userId === "tech-1"
            ? { id: "assignment-1", bookingId, status: state.assignmentStatus }
            : null,
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; status: AssignmentStatus };
          data: { status: AssignmentStatus; decidedAt: Date };
        }) => {
          if (
            where.id !== "assignment-1" ||
            where.status !== state.assignmentStatus
          )
            return { count: 0 };
          state.assignmentStatus = data.status;
          return { count: 1 };
        },
      },
      bookingStatusEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.events.push(data);
          return data;
        },
      },
      auditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.audits.push(data);
          return data;
        },
      },
    };
    const db = {
      ...fakeDb,
      $transaction: async <T>(callback: (tx: unknown) => Promise<T>) =>
        callback(db as unknown),
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
          const role = req.header("x-test-role") ?? "USER";
          req.auth = {
            userId,
            sessionId: "session-test",
            roles: [role],
            permissions: req.header("x-test-permission")?.split(",") ?? [],
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
    const { default: bookingRoutes } = await import(
      "../src/modules/bookings/booking.routes"
    );
    app = express();
    app.use("/api/v1/bookings", bookingRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    state.bookingStatus = BookingStatus.ASSIGNED;
    state.assignmentStatus = AssignmentStatus.OFFERED;
    state.events.length = 0;
    state.audits.length = 0;
  });

  it("requires authentication and technician role, then accepts the assigned offer", async () => {
    expect(
      (await request(app).post(`/api/v1/bookings/${bookingId}/accept`)).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/v1/bookings/not-a-uuid/accept")
          .set("x-test-user", "tech-1")
          .set("x-test-role", "TECHNICIAN")
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`/api/v1/bookings/${bookingId}/accept`)
          .set("x-test-user", "user-1")
      ).status,
    ).toBe(403);

    const accepted = await request(app)
      .post(`/api/v1/bookings/${bookingId}/accept`)
      .set("x-test-user", "tech-1")
      .set("x-test-role", "TECHNICIAN");
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.bookingStatus).toBe(BookingStatus.ACCEPTED);
    expect(state.assignmentStatus).toBe(AssignmentStatus.ACCEPTED);
  });

  it("does not expose an offer to another technician or accept a duplicate decision", async () => {
    const foreignDecision = await request(app)
      .post(`/api/v1/bookings/${bookingId}/accept`)
      .set("x-test-user", "tech-2")
      .set("x-test-role", "TECHNICIAN");
    expect(foreignDecision.status).toBe(404);

    await request(app)
      .post(`/api/v1/bookings/${bookingId}/accept`)
      .set("x-test-user", "tech-1")
      .set("x-test-role", "TECHNICIAN");
    const repeat = await request(app)
      .post(`/api/v1/bookings/${bookingId}/accept`)
      .set("x-test-user", "tech-1")
      .set("x-test-role", "TECHNICIAN");
    expect(repeat.status).toBe(409);
  });

  it("requires bookings:manage permission to list eligible technicians", async () => {
    const denied = await request(app)
      .get("/api/v1/bookings/eligible-technicians")
      .query({ serviceId: "00000000-0000-4000-8000-000000000002" })
      .set("x-test-user", "admin-1")
      .set("x-test-role", "ADMIN");
    expect(denied.status).toBe(403);

    const invalid = await request(app)
      .get("/api/v1/bookings/eligible-technicians")
      .query({ serviceId: "not-a-uuid" })
      .set("x-test-user", "admin-1")
      .set("x-test-role", "ADMIN")
      .set("x-test-permission", "bookings:manage");
    expect(invalid.status).toBe(400);

    const listed = await request(app)
      .get("/api/v1/bookings/eligible-technicians")
      .query({ serviceId: "00000000-0000-4000-8000-000000000002" })
      .set("x-test-user", "admin-1")
      .set("x-test-role", "ADMIN")
      .set("x-test-permission", "bookings:manage");
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([{ userId: "tech-1" }]);
  });
});
