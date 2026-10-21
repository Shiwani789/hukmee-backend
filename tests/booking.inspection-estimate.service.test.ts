/* eslint-disable @typescript-eslint/no-explicit-any */
import { AssignmentStatus, BookingStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { BookingService } from "../src/modules/bookings/booking.service";

function fixture() {
  const state = {
    booking: {
      id: "booking-1",
      status: BookingStatus.ACCEPTED as BookingStatus,
    },
    assignments: [
      {
        id: "assignment-1",
        status: AssignmentStatus.ACCEPTED,
        technician: {
          userId: "tech-1",
          active: true,
          approvedAt: new Date(),
          user: { isActive: true },
        },
      },
    ],
    inspection: null as Record<string, unknown> | null,
    estimates: [] as Array<Record<string, any>>,
    decisions: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, any>>,
  };
  let nextId = 0;
  const tx = {
    booking: {
      findUnique: async () => state.booking,
    },
    repairAssignment: {
      findFirst: async ({ where }: any) =>
        state.assignments.find(
          (item) =>
            item.status === where.status &&
            item.technician.userId === where.technician.userId &&
            item.technician.active &&
            item.technician.approvedAt &&
            item.technician.user.isActive,
        ) ?? null,
    },
    repairInspection: {
      create: async ({ data }: any) => {
        if (state.inspection) {
          const error = new Error("duplicate inspection") as Error & {
            code: string;
          };
          error.code = "P2002";
          throw error;
        }
        state.inspection = {
          id: `inspection-${++nextId}`,
          ...data,
          evidence: [],
        };
        return state.inspection;
      },
      findUnique: async () => state.inspection,
    },
    repairEstimate: {
      findFirst: async ({ where }: any) =>
        state.estimates.find(
          (estimate) =>
            estimate.bookingId === where.bookingId &&
            (!where.status || estimate.status === where.status) &&
            (!where.id || estimate.id === where.id),
        ) ?? null,
      aggregate: async () => ({
        _max: {
          version: state.estimates.reduce<number | null>(
            (max, estimate) => Math.max(max ?? 0, estimate.version),
            null,
          ),
        },
      }),
      create: async ({ data }: any) => {
        const estimate = {
          id: `estimate-${++nextId}`,
          ...data,
          lines: data.lines.create,
          decisions: [],
          booking: { userId: "user-1" },
        };
        state.estimates.push(estimate);
        return estimate;
      },
      updateMany: async ({ where, data }: any) => {
        const estimate = state.estimates.find(
          (item) => item.id === where.id && item.status === where.status,
        );
        if (!estimate) return { count: 0 };
        estimate.status = data.status;
        return { count: 1 };
      },
    },
    repairEstimateDecision: {
      create: async ({ data }: any) => {
        const decision = { id: `decision-${++nextId}`, ...data };
        state.decisions.push(decision);
        return decision;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        state.audits.push(data);
        return data;
      },
    },
  };
  const db = {
    ...tx,
    $transaction: async <T>(callback: (transaction: unknown) => Promise<T>) =>
      callback(tx),
  } as unknown as PrismaClient;
  return { state, service: new BookingService(db) };
}

const lines = [
  { description: "Replacement part", quantity: "1.00", unitAmount: "1250.00" },
];

describe("inspection and estimate service", () => {
  it("creates an inspection only for the accepted technician and audits it", async () => {
    const { state, service } = fixture();
    const inspection = await service.createInspection("booking-1", "tech-1", {
      findings: "Screen is damaged",
      technicianNotes: "Device received powered off",
    });
    expect(inspection).toMatchObject({ findings: "Screen is damaged" });
    expect(state.audits[0]).toMatchObject({
      actorUserId: "tech-1",
      action: "booking.inspection.created",
      metadata: { inspectionId: inspection.id, assignmentId: "assignment-1" },
    });
    await expect(
      service.createInspection("booking-1", "other-tech", {
        findings: "Unauthorized inspection",
      }),
    ).rejects.toMatchObject({ status: 404, code: "ASSIGNMENT_NOT_FOUND" });
  });

  it("requires accepted booking state and prevents a second inspection", async () => {
    const { state, service } = fixture();
    state.booking.status = BookingStatus.ASSIGNED;
    await expect(
      service.createInspection("booking-1", "tech-1", { findings: "Finding" }),
    ).rejects.toMatchObject({ status: 409, code: "BOOKING_STATE_CONFLICT" });
    state.booking.status = BookingStatus.ACCEPTED;
    await service.createInspection("booking-1", "tech-1", {
      findings: "Finding",
    });
    await expect(
      service.createInspection("booking-1", "tech-1", { findings: "Finding" }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("requires inspection, rejects a second pending estimate, versions after decisions, and audits", async () => {
    const { state, service } = fixture();
    await expect(
      service.submitEstimate("booking-1", "tech-1", { lines }),
    ).rejects.toMatchObject({ status: 409, code: "INSPECTION_REQUIRED" });
    await service.createInspection("booking-1", "tech-1", {
      findings: "Finding",
    });
    const first = await service.submitEstimate("booking-1", "tech-1", {
      lines,
    });
    expect(first.version).toBe(1);
    expect(first.lines).toEqual(lines);
    await expect(
      service.submitEstimate("booking-1", "tech-1", { lines }),
    ).rejects.toMatchObject({
      status: 409,
      code: "ESTIMATE_AWAITING_DECISION",
    });
    await service.decideEstimate("booking-1", first.id, "user-1", {
      accepted: false,
      reason: "Please review this estimate",
    });
    const second = await service.submitEstimate("booking-1", "tech-1", {
      lines,
    });
    expect(second.version).toBe(2);
    expect(state.audits.map((audit) => audit.action)).toEqual([
      "booking.inspection.created",
      "booking.estimate.submitted",
      "booking.estimate.rejected",
      "booking.estimate.submitted",
    ]);
  });

  it("scopes decisions to booking owner and permits only one decision", async () => {
    const { state, service } = fixture();
    await service.createInspection("booking-1", "tech-1", {
      findings: "Finding",
    });
    const estimate = await service.submitEstimate("booking-1", "tech-1", {
      lines,
    });
    await expect(
      service.decideEstimate("booking-1", estimate.id, "other-user", {
        accepted: true,
      }),
    ).rejects.toMatchObject({ status: 404, code: "ESTIMATE_NOT_FOUND" });
    const decisions = await Promise.allSettled([
      service.decideEstimate("booking-1", estimate.id, "user-1", {
        accepted: true,
      }),
      service.decideEstimate("booking-1", estimate.id, "user-1", {
        accepted: false,
      }),
    ]);
    expect(
      decisions.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      decisions.find((result) => result.status === "rejected"),
    ).toMatchObject({
      status: "rejected",
      reason: { status: 409, code: "ESTIMATE_ALREADY_DECIDED" },
    });
    expect(state.decisions).toHaveLength(1);
  });
});
