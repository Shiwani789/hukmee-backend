/**
 * Booking creation flow — API-level tests
 *
 * Pattern: single beforeAll (same as booking.api.test.ts / catalog-search-filter.api.test.ts)
 * All DB calls are jest.fn() mocks. Per-test behaviour is set via mockResolvedValue / mockReturnValue.
 *
 * Covers:
 *   - Auth: 401 without token, 403 for ADMIN-only role
 *   - Validation: bad UUIDs, short description, past scheduledAt, non-ISO scheduledAt
 *   - Cross-customer: device not found → 404, address not found → 404
 *   - Service checks: inactive/incompatible → 400
 *   - Slot conflict: → 409
 *   - Successful create: with/without scheduledAt → 201 REQUESTED
 *   - Identity from token (not body)
 *   - Status injection ignored
 *   - GET /bookings (list): 401, 403, 200
 *   - GET /bookings/:id: 400 bad uuid, 404 not owner, 200 owner
 *   - GET /availability: 401, 400 missing serviceId, 400 bad date, 400 past date,
 *                        200 slots, unavailable slot marked false
 */
import express from "express";
import request from "supertest";
import { BookingStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { errorHandler } from "../src/middlewares/errors";

// ── Stable UUIDs ──────────────────────────────────────────────────────
const USER_ID = "00000000-0000-4000-8001-000000000001";
const DEVICE_ID = "00000000-0000-4000-8003-000000000001";
const MODEL_ID = "00000000-0000-4000-8004-000000000001";
const SERVICE_ID = "00000000-0000-4000-8005-000000000001";
const PART_GRADE_ID = "00000000-0000-4000-8008-000000000001";
const ADDRESS_ID = "00000000-0000-4000-8006-000000000001";
const BOOKING_ID = "00000000-0000-4000-8007-000000000001";

// Slot 2h from now
const FUTURE_SLOT = (() => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(tomorrow);
  return new Date(`${localDate}T05:30:00.000Z`).toISOString();
})();
const PAST_SLOT = new Date(Date.now() - 60 * 60 * 1000).toISOString();

// ── Fixtures ──────────────────────────────────────────────────────────
const DEVICE = { id: DEVICE_ID, modelId: MODEL_ID };
const ADDRESS = { id: ADDRESS_ID };
const SERVICE = { id: SERVICE_ID };
const BOOKING = {
  id: BOOKING_ID,
  reference: "HK-AABBCCDD1234",
  userId: USER_ID,
  deviceId: DEVICE_ID,
  serviceId: SERVICE_ID,
  addressId: ADDRESS_ID,
  problemDescription: "Screen is cracked",
  scheduledAt: null,
  status: BookingStatus.REQUESTED,
  createdAt: new Date("2024-06-01T00:00:00Z"),
  updatedAt: new Date("2024-06-01T00:00:00Z"),
  statusEvents: [],
  service: SERVICE,
  device: DEVICE,
  address: ADDRESS,
};

// ── Shared mocks (mutated per test via mockResolvedValue) ─────────────
const deviceFindFirst = jest.fn();
const addressFindFirst = jest.fn();
const serviceFindFirst = jest.fn();
const partGradeFindFirst = jest.fn();
const bookingFindFirst = jest.fn();
const bookingFindMany = jest.fn();
const bookingCreate = jest.fn();
const auditCreate = jest.fn().mockResolvedValue({});
const statusEventCreate = jest.fn().mockResolvedValue({});

describe("Booking creation flow", () => {
  let app: express.Express;

  // ── Single beforeAll ─────────────────────────────────────────────────
  beforeAll(async () => {
    const db = {
      userDevice: { findFirst: deviceFindFirst },
      address: { findFirst: addressFindFirst },
      repairService: { findFirst: serviceFindFirst },
      partGrade: { findFirst: partGradeFindFirst },
      booking: {
        findFirst: bookingFindFirst,
        findMany: bookingFindMany,
        create: bookingCreate,
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      auditLog: { create: auditCreate },
      bookingStatusEvent: { create: statusEventCreate },
      $transaction: jest.fn(async (fn: (tx: PrismaClient) => unknown) =>
        fn(db as unknown as PrismaClient),
      ),
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
            sessionId: "sess",
            roles: [req.header("x-test-role") ?? "USER"],
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
            req.auth && roles.some((r) => req.auth?.roles.includes(r))
              ? next()
              : next(new AppError(403, "FORBIDDEN", "Insufficient role")),
        requirePermission:
          (perm: string) =>
          (
            req: express.Request,
            _res: express.Response,
            next: express.NextFunction,
          ) =>
            req.auth?.permissions.includes(perm)
              ? next()
              : next(new AppError(403, "FORBIDDEN", "Permission required")),
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

  // ── Default happy-path mocks, reset before every test ────────────────
  beforeEach(() => {
    jest.clearAllMocks();
    deviceFindFirst.mockResolvedValue(DEVICE);
    addressFindFirst.mockResolvedValue(ADDRESS);
    serviceFindFirst.mockResolvedValue(SERVICE);
    partGradeFindFirst.mockResolvedValue(null);
    // First findFirst call = slot-conflict check (null = no conflict)
    // Second call = getForUser
    bookingFindFirst
      .mockResolvedValueOnce(null) // no slot conflict
      .mockResolvedValue(BOOKING); // getForUser / subsequent reads
    bookingFindMany.mockResolvedValue([]);
    bookingCreate.mockResolvedValue(BOOKING);
    auditCreate.mockResolvedValue({});
    statusEventCreate.mockResolvedValue({});
  });

  const asUser = (r: request.Test) => r.set("x-test-user", USER_ID);

  // ── 1. Authentication ─────────────────────────────────────────────────
  describe("Authentication", () => {
    it("returns 401 when no token provided", async () => {
      const res = await request(app).post("/api/v1/bookings").send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        problemDescription: "Screen is cracked",
      });
      expect(res.status).toBe(401);
    });

    it("returns 403 when authenticated as ADMIN (not USER)", async () => {
      const res = await request(app)
        .post("/api/v1/bookings")
        .set("x-test-user", USER_ID)
        .set("x-test-role", "ADMIN")
        .send({
          deviceId: DEVICE_ID,
          serviceId: SERVICE_ID,
          problemDescription: "Screen is cracked",
        });
      expect(res.status).toBe(403);
    });
  });

  // ── 2. Input validation ───────────────────────────────────────────────
  describe("Input validation", () => {
    it("returns 400 for non-UUID deviceId", async () => {
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: "not-a-uuid",
        serviceId: SERVICE_ID,
        problemDescription: "Screen is cracked",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-UUID serviceId", async () => {
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: "bad",
        problemDescription: "Screen is cracked",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-UUID partGradeId", async () => {
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        partGradeId: "bad",
        problemDescription: "Screen is cracked",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when problemDescription is too short (< 5 chars)", async () => {
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        problemDescription: "ok",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for a past scheduledAt (Zod refine)", async () => {
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        problemDescription: "Screen is cracked",
        scheduledAt: PAST_SLOT,
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for a non-ISO scheduledAt string", async () => {
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        problemDescription: "Screen is cracked",
        scheduledAt: "tomorrow morning",
      });
      expect(res.status).toBe(400);
    });
  });

  // ── 3. Cross-customer ownership ───────────────────────────────────────
  describe("Ownership enforcement", () => {
    it("returns 404 when device belongs to another customer", async () => {
      deviceFindFirst.mockResolvedValue(null);
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        problemDescription: "Screen is cracked",
      });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("DEVICE_NOT_FOUND");
    });

    it("returns 404 when address belongs to another customer", async () => {
      addressFindFirst.mockResolvedValue(null);
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        addressId: ADDRESS_ID,
        problemDescription: "Screen is cracked",
      });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ADDRESS_NOT_FOUND");
    });
  });

  // ── 4. Service compatibility / active check ───────────────────────────
  describe("Service validation", () => {
    it("returns 400 when service is inactive or incompatible with device model", async () => {
      serviceFindFirst.mockResolvedValue(null);
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        problemDescription: "Screen is cracked",
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
    });
  });

  describe("Selected grade validation and price snapshot", () => {
    it("rejects an inactive, unpriced, incompatible, or unmapped grade", async () => {
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        partGradeId: PART_GRADE_ID,
        problemDescription: "Screen is cracked",
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("GRADE_UNAVAILABLE");
      expect(bookingCreate).not.toHaveBeenCalled();
    });

    it("loads configured price server-side and snapshots the selected grade", async () => {
      partGradeFindFirst.mockResolvedValue({
        id: PART_GRADE_ID,
        name: "Configured grade",
        price: "849.50",
        part: { name: "Display assembly" },
      });
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        partGradeId: PART_GRADE_ID,
        gradePriceSnapshot: 1,
        problemDescription: "Screen is cracked",
      });
      expect(res.status).toBe(201);
      expect(serviceFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: SERVICE_ID,
            active: true,
            category: { active: true },
            compatibility: {
              some: {
                modelId: MODEL_ID,
                model: { active: true, brand: { active: true } },
              },
            },
          }),
        }),
      );
      expect(partGradeFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: PART_GRADE_ID,
            active: true,
            price: { not: null },
            part: expect.objectContaining({
              active: true,
              serviceMappings: { some: { serviceId: SERVICE_ID } },
            }),
          }),
        }),
      );
      expect(bookingCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            partGradeId: PART_GRADE_ID,
            partNameSnapshot: "Display assembly",
            gradeNameSnapshot: "Configured grade",
            gradePriceSnapshot: "849.50",
          }),
        }),
      );
      expect(bookingCreate.mock.calls[0][0].data.gradePriceSnapshot).not.toBe(
        1,
      );
    });
  });

  // ── 5. Slot conflict ──────────────────────────────────────────────────
  describe("Slot conflict", () => {
    it("returns 409 when the requested time slot is already booked", async () => {
      // Override first findFirst (slot check) to return a conflicting booking
      bookingFindFirst.mockReset();
      bookingFindFirst
        .mockResolvedValueOnce({ id: "conflict-booking-id" }) // slot taken
        .mockResolvedValue(BOOKING);
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        problemDescription: "Screen is cracked",
        scheduledAt: FUTURE_SLOT,
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SLOT_UNAVAILABLE");
    });
  });

  // ── 6. Successful creation ────────────────────────────────────────────
  describe("Successful booking creation", () => {
    it("creates a booking without scheduledAt, returns 201 with REQUESTED status", async () => {
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        problemDescription: "Screen is cracked",
      });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe(BookingStatus.REQUESTED);
      expect(res.body.data.id).toBe(BOOKING_ID);
    });

    it("creates a booking with addressId and scheduledAt in the future", async () => {
      bookingCreate.mockResolvedValue({ ...BOOKING, scheduledAt: FUTURE_SLOT });
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        addressId: ADDRESS_ID,
        problemDescription: "Battery drains quickly",
        scheduledAt: FUTURE_SLOT,
      });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe(BookingStatus.REQUESTED);
      expect(res.body.data.scheduledAt).toBeTruthy();
    });

    it("takes customer identity from the token, not from the request body", async () => {
      await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        problemDescription: "Screen is cracked",
      });
      expect(deviceFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: DEVICE_ID, userId: USER_ID } }),
      );
    });

    it("ignores any status field in the body — always creates as REQUESTED", async () => {
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        problemDescription: "Screen is cracked",
        status: "COMPLETED", // must be stripped by schema
      });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe(BookingStatus.REQUESTED);
    });

    it("response includes device, service and address fields", async () => {
      const res = await asUser(request(app).post("/api/v1/bookings")).send({
        deviceId: DEVICE_ID,
        serviceId: SERVICE_ID,
        addressId: ADDRESS_ID,
        problemDescription: "Screen is cracked",
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty("service");
      expect(res.body.data).toHaveProperty("device");
      expect(res.body.data).toHaveProperty("address");
    });
  });

  // ── 7. List bookings ──────────────────────────────────────────────────
  describe("GET /bookings (list)", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).get("/api/v1/bookings");
      expect(res.status).toBe(401);
    });

    it("returns 403 for TECHNICIAN role (not USER)", async () => {
      const res = await request(app)
        .get("/api/v1/bookings")
        .set("x-test-user", USER_ID)
        .set("x-test-role", "TECHNICIAN");
      expect(res.status).toBe(403);
    });

    it("returns 200 with the authenticated user's bookings", async () => {
      bookingFindMany.mockResolvedValue([BOOKING]);
      const res = await asUser(request(app).get("/api/v1/bookings"));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ── 8. Get booking by ID ──────────────────────────────────────────────
  describe("GET /bookings/:bookingId", () => {
    it("returns 400 for a non-UUID bookingId", async () => {
      const res = await asUser(request(app).get("/api/v1/bookings/not-a-uuid"));
      expect(res.status).toBe(400);
    });

    it("returns 404 when booking belongs to another customer", async () => {
      // Skip the slot-conflict call; make getForUser return null
      bookingFindFirst.mockReset();
      bookingFindFirst.mockResolvedValue(null);
      const res = await asUser(
        request(app).get(`/api/v1/bookings/${BOOKING_ID}`),
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("BOOKING_NOT_FOUND");
    });

    it("returns 200 with full booking details for the owner", async () => {
      bookingFindFirst.mockReset();
      bookingFindFirst.mockResolvedValue(BOOKING);
      const res = await asUser(
        request(app).get(`/api/v1/bookings/${BOOKING_ID}`),
      );
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(BOOKING_ID);
    });
  });

  // ── 9. GET /availability ──────────────────────────────────────────────
  describe("GET /availability", () => {
    const tomorrow = () => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    };
    const yesterday = () => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    };

    it("returns 401 without auth", async () => {
      const res = await request(app)
        .get("/api/v1/bookings/availability")
        .query({ serviceId: SERVICE_ID, date: tomorrow() });
      expect(res.status).toBe(401);
    });

    it("returns 400 when serviceId is missing", async () => {
      const res = await asUser(
        request(app)
          .get("/api/v1/bookings/availability")
          .query({ date: tomorrow() }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for a malformed serviceId", async () => {
      const res = await asUser(
        request(app)
          .get("/api/v1/bookings/availability")
          .query({ serviceId: "not-a-uuid", date: tomorrow() }),
      );
      expect(res.status).toBe(400);
      expect(serviceFindFirst).not.toHaveBeenCalled();
    });

    it.each(["unknown", "inactive or in an inactive category"])(
      "does not return slots for a service that is %s",
      async () => {
        serviceFindFirst.mockResolvedValueOnce(null);
        const res = await asUser(
          request(app)
            .get("/api/v1/bookings/availability")
            .query({ serviceId: SERVICE_ID, date: tomorrow() }),
        );
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
        expect(res.body.error.message).toBe("Service not found or inactive");
        expect(bookingFindMany).not.toHaveBeenCalled();
      },
    );

    it("returns 400 for invalid date format (not YYYY-MM-DD)", async () => {
      const res = await asUser(
        request(app)
          .get("/api/v1/bookings/availability")
          .query({ serviceId: SERVICE_ID, date: "19-06-2025" }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for a past date", async () => {
      const res = await asUser(
        request(app)
          .get("/api/v1/bookings/availability")
          .query({ serviceId: SERVICE_ID, date: yesterday() }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 200 with 5 named slots for a valid future date", async () => {
      bookingFindMany.mockResolvedValue([]);
      const res = await asUser(
        request(app)
          .get("/api/v1/bookings/availability")
          .query({ serviceId: SERVICE_ID, date: tomorrow() }),
      );
      expect(res.status).toBe(200);
      expect(serviceFindFirst).toHaveBeenCalledWith({
        where: {
          id: SERVICE_ID,
          active: true,
          category: { active: true },
        },
        select: { id: true },
      });
      expect(res.body.data.date).toBe(tomorrow());
      expect(Array.isArray(res.body.data.slots)).toBe(true);
      expect(res.body.data.slots).toHaveLength(5); // 09:00 through 17:00, two-hour slots
      for (const slot of res.body.data.slots as Array<{
        startAt: string;
        endAt: string;
        available: boolean;
      }>) {
        expect(slot).toHaveProperty("startAt");
        expect(slot).toHaveProperty("endAt");
        expect(slot).toHaveProperty("status");
        expect(typeof slot.available).toBe("boolean");
      }
    });

    it("marks slot as unavailable when an existing booking occupies it", async () => {
      // Simulate DB returning a booking at 09:00 IST on tomorrow
      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
      const dateParts = tomorrow().split("-").map(Number);
      const nineAmIST = new Date(
        Date.UTC(dateParts[0]!, dateParts[1]! - 1, dateParts[2]!) -
          IST_OFFSET_MS +
          9 * 60 * 60 * 1000,
      );
      bookingFindMany.mockResolvedValue([{ scheduledAt: nineAmIST }]);
      const res = await asUser(
        request(app)
          .get("/api/v1/bookings/availability")
          .query({ serviceId: SERVICE_ID, date: tomorrow() }),
      );
      expect(res.status).toBe(200);
      // First slot (09:00) must be unavailable
      expect(res.body.data.slots[0]!.available).toBe(false);
      // Other slots should still be available
      expect(res.body.data.slots[1]!.available).toBe(true);
    });

    it("marks all slots available when no bookings exist for the date", async () => {
      bookingFindMany.mockResolvedValue([]);
      const res = await asUser(
        request(app)
          .get("/api/v1/bookings/availability")
          .query({ serviceId: SERVICE_ID, date: tomorrow() }),
      );
      expect(res.status).toBe(200);
      const allAvailable = (
        res.body.data.slots as Array<{ available: boolean }>
      ).every((s) => s.available === true);
      expect(allAvailable).toBe(true);
    });
  });

  it("rejects a timestamp that is not a configured slot start", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const invalid = new Date(tomorrow);
    invalid.setUTCHours(4, 30, 0, 0); // 10:00 IST, between the configured slots
    const res = await asUser(request(app).post("/api/v1/bookings")).send({
      deviceId: DEVICE_ID,
      serviceId: SERVICE_ID,
      problemDescription: "Screen is cracked",
      scheduledAt: invalid.toISOString(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SLOT");
  });

  it("rejects impossible calendar dates for availability", async () => {
    const res = await asUser(
      request(app)
        .get("/api/v1/bookings/availability")
        .query({ serviceId: SERVICE_ID, date: "2026-02-30" }),
    );
    expect(res.status).toBe(400);
  });
});
