/* eslint-disable @typescript-eslint/no-explicit-any */
import express from "express";
import request from "supertest";
import {
  AssignmentStatus,
  BookingStatus,
  EstimateStatus,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { errorHandler } from "../src/middlewares/errors";

const bookingId = "00000000-0000-4000-8000-000000000001";
const estimateId = "00000000-0000-4000-8000-000000000002";

describe("inspection and estimate API", () => {
  const state = {
    inspection: null as Record<string, unknown> | null,
    estimateStatus: EstimateStatus.SUBMITTED,
    estimateExists: false,
    audit: [] as Record<string, unknown>[],
    decisions: [] as Record<string, unknown>[],
  };
  let app: express.Express;

  beforeAll(async () => {
    const tx = {
      booking: {
        findUnique: async () => ({
          id: bookingId,
          status: BookingStatus.ACCEPTED,
        }),
      },
      repairAssignment: {
        findFirst: async ({ where }: any) =>
          where.technician.userId === "tech-1" &&
          where.status === AssignmentStatus.ACCEPTED
            ? { id: "assignment-1" }
            : null,
      },
      repairInspection: {
        create: async ({ data }: any) => {
          state.inspection = { id: "inspection-1", ...data, evidence: [] };
          return state.inspection;
        },
        findUnique: async () => state.inspection,
      },
      repairEstimate: {
        findFirst: async ({ where }: any) => {
          if (where.id === estimateId && state.estimateExists)
            return {
              id: estimateId,
              status: state.estimateStatus,
              booking: { userId: "user-1" },
            };
          return state.estimateExists &&
            where.status === EstimateStatus.SUBMITTED &&
            state.estimateStatus === EstimateStatus.SUBMITTED
            ? { id: estimateId }
            : null;
        },
        aggregate: async () => ({ _max: { version: 0 } }),
        create: async ({ data }: any) => {
          state.estimateExists = true;
          return {
            id: estimateId,
            ...data,
            lines: data.lines.create,
            decisions: [],
          };
        },
        updateMany: async ({ data }: any) => {
          if (state.estimateStatus !== EstimateStatus.SUBMITTED)
            return { count: 0 };
          state.estimateStatus = data.status;
          return { count: 1 };
        },
      },
      repairEstimateDecision: {
        create: async ({ data }: any) => {
          const decision = { id: "decision-1", ...data };
          state.decisions.push(decision);
          return decision;
        },
      },
      auditLog: {
        create: async ({ data }: any) => {
          state.audit.push(data);
          return data;
        },
      },
    };
    const db = {
      ...tx,
      $transaction: async <T>(callback: (transaction: unknown) => Promise<T>) =>
        callback(tx),
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
        requirePermission:
          () =>
          (
            _req: express.Request,
            _res: express.Response,
            next: express.NextFunction,
          ) =>
            next(),
      };
    });
    const { default: bookingRoutes } = await import(
      "../src/modules/bookings/booking.routes"
    );
    app = express();
    app.use(express.json());
    app.use("/api/v1/bookings", bookingRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    state.inspection = null;
    state.estimateStatus = EstimateStatus.SUBMITTED;
    state.estimateExists = false;
    state.audit.length = 0;
    state.decisions.length = 0;
  });

  it("validates inspection input and restricts the write to technicians", async () => {
    const invalid = await request(app)
      .post(`/api/v1/bookings/${bookingId}/inspection`)
      .set("x-test-user", "tech-1")
      .set("x-test-role", "TECHNICIAN")
      .send({ findings: "" });
    expect(invalid.status).toBe(400);

    const forbidden = await request(app)
      .post(`/api/v1/bookings/${bookingId}/inspection`)
      .set("x-test-user", "user-1")
      .send({ findings: "Screen is damaged" });
    expect(forbidden.status).toBe(403);

    const response = await request(app)
      .post(`/api/v1/bookings/${bookingId}/inspection`)
      .set("x-test-user", "tech-1")
      .set("x-test-role", "TECHNICIAN")
      .send({ findings: "Screen is damaged" });
    expect(response.status).toBe(201);
    expect(response.body.data.findings).toBe("Screen is damaged");
    expect(state.audit[0]).toMatchObject({
      action: "booking.inspection.created",
    });
  });

  it("validates estimate decimals, creates an estimate, and owner-scopes decisions", async () => {
    state.inspection = { id: "inspection-1" };
    const invalid = await request(app)
      .post(`/api/v1/bookings/${bookingId}/estimates`)
      .set("x-test-user", "tech-1")
      .set("x-test-role", "TECHNICIAN")
      .send({
        lines: [{ description: "Part", quantity: "0", unitAmount: "10" }],
      });
    expect(invalid.status).toBe(400);

    const submitted = await request(app)
      .post(`/api/v1/bookings/${bookingId}/estimates`)
      .set("x-test-user", "tech-1")
      .set("x-test-role", "TECHNICIAN")
      .send({
        lines: [
          { description: "Part", quantity: "1.00", unitAmount: "1250.00" },
        ],
      });
    expect(submitted.status).toBe(201);
    expect(submitted.body.data.version).toBe(1);

    const forbidden = await request(app)
      .post(`/api/v1/bookings/${bookingId}/estimates/${estimateId}/decision`)
      .set("x-test-user", "tech-1")
      .set("x-test-role", "TECHNICIAN")
      .send({ accepted: true });
    expect(forbidden.status).toBe(403);

    const foreignOwner = await request(app)
      .post(`/api/v1/bookings/${bookingId}/estimates/${estimateId}/decision`)
      .set("x-test-user", "other-user")
      .set("x-test-role", "USER")
      .send({ accepted: true });
    expect(foreignOwner.status).toBe(404);

    const decision = await request(app)
      .post(`/api/v1/bookings/${bookingId}/estimates/${estimateId}/decision`)
      .set("x-test-user", "user-1")
      .set("x-test-role", "USER")
      .send({ accepted: true });
    expect(decision.status).toBe(200);
    expect(decision.body.data.status).toBe(EstimateStatus.ACCEPTED);
  });
});
