import { AssignmentStatus, BookingStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { BookingService } from "../src/modules/bookings/booking.service";

function bookingFixture() {
  const state = {
    booking: {
      id: "booking-1",
      status: BookingStatus.ASSIGNED as BookingStatus,
    },
    assignment: {
      id: "assignment-1",
      bookingId: "booking-1",
      technicianUserId: "technician-1",
      status: AssignmentStatus.OFFERED as AssignmentStatus,
      decidedAt: null as Date | null,
    },
    events: [] as Record<string, unknown>[],
    audits: [] as Record<string, unknown>[],
  };
  const fake = {
    booking: {
      findUnique: async () => ({ ...state.booking }),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: BookingStatus };
        data: { status: BookingStatus };
      }) => {
        if (
          state.booking.id !== where.id ||
          state.booking.status !== where.status
        ) {
          return { count: 0 };
        }
        state.booking.status = data.status;
        return { count: 1 };
      },
    },
    repairAssignment: {
      findFirst: async ({
        where,
      }: {
        where: { bookingId: string; technician: { userId: string } };
      }) =>
        state.assignment.bookingId === where.bookingId &&
        state.assignment.technicianUserId === where.technician.userId
          ? {
              id: state.assignment.id,
              bookingId: state.assignment.bookingId,
              status: state.assignment.status,
            }
          : null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: AssignmentStatus };
        data: { status: AssignmentStatus; decidedAt: Date };
      }) => {
        if (
          state.assignment.id !== where.id ||
          state.assignment.status !== where.status
        ) {
          return { count: 0 };
        }
        state.assignment.status = data.status;
        state.assignment.decidedAt = data.decidedAt;
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
    ...fake,
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) =>
      callback(db as unknown),
  } as unknown as PrismaClient;
  return { state, service: new BookingService(db) };
}

describe("booking assignment lifecycle", () => {
  it("lists only active, approved, skilled technician accounts for an active service", async () => {
    const requestedServiceId = "service-1";
    let captured: Record<string, unknown> | undefined;
    const db = {
      technicianProfile: {
        findMany: async (args: Record<string, unknown>) => {
          captured = args;
          return [{ userId: "technician-1" }];
        },
      },
    } as unknown as PrismaClient;
    const result = await new BookingService(db).listEligibleTechnicians({
      serviceId: requestedServiceId,
    });

    expect(result).toEqual([{ userId: "technician-1" }]);
    expect(captured).toMatchObject({
      where: {
        active: true,
        approvedAt: { not: null },
        user: {
          is: {
            isActive: true,
            role: { is: { name: "WORKER" } },
          },
        },
        skills: {
          some: {
            serviceId: requestedServiceId,
            service: { is: { active: true } },
          },
        },
      },
      select: { userId: true },
    });
  });

  it("accepts an offer and advances the booking to ACCEPTED", async () => {
    const { state, service } = bookingFixture();
    const result = await service.decideAssignment(
      "booking-1",
      "technician-1",
      "accept",
    );
    expect(result).toMatchObject({
      assignmentId: "assignment-1",
      assignmentStatus: AssignmentStatus.ACCEPTED,
      bookingStatus: BookingStatus.ACCEPTED,
    });
    expect(state.assignment.decidedAt).toBeInstanceOf(Date);
    expect(state.events).toHaveLength(1);
    expect(state.audits[0]?.action).toBe("booking.assignment.accepted");
  });

  it("rejects an offer and returns the request to REQUESTED for reassignment", async () => {
    const { state, service } = bookingFixture();
    const result = await service.decideAssignment(
      "booking-1",
      "technician-1",
      "reject",
    );
    expect(result.bookingStatus).toBe(BookingStatus.REQUESTED);
    expect(state.assignment.status).toBe(AssignmentStatus.REJECTED);
    expect(state.booking.status).toBe(BookingStatus.REQUESTED);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      status: BookingStatus.REQUESTED,
      actorUserId: "technician-1",
    });
    expect(state.audits[0]).toMatchObject({
      action: "booking.assignment.rejected",
      entityId: "booking-1",
      metadata: { assignmentId: "assignment-1" },
    });
  });

  it("does not allow a different technician to decide the offer", async () => {
    const { service } = bookingFixture();
    await expect(
      service.decideAssignment("booking-1", "another-technician", "accept"),
    ).rejects.toMatchObject({
      status: 404,
      code: "ASSIGNMENT_NOT_FOUND",
    });
  });

  it("allows only one winner in concurrent accept and reject attempts", async () => {
    const { service } = bookingFixture();
    const results = await Promise.allSettled([
      service.decideAssignment("booking-1", "technician-1", "accept"),
      service.decideAssignment("booking-1", "technician-1", "reject"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { status: 409, code: "ASSIGNMENT_ALREADY_DECIDED" },
    });
  });

  it.each([
    [
      "inactive profile",
      { active: false, approvedAt: new Date(), userActive: true },
    ],
    [
      "unapproved profile",
      { active: true, approvedAt: null, userActive: true },
    ],
    [
      "inactive account",
      { active: true, approvedAt: new Date(), userActive: false },
    ],
  ])(
    "does not assign to a technician with an %s",
    async (_description, eligibility) => {
      const db = {
        technicianProfile: {
          findFirst: async () =>
            eligibility.active &&
            eligibility.approvedAt &&
            eligibility.userActive
              ? { id: "technician-profile-1" }
              : null,
        },
      } as unknown as PrismaClient;
      const service = new BookingService(db);
      await expect(
        service.assign("booking-1", "manager-1", {
          technicianUserId: "technician-1",
        }),
      ).rejects.toMatchObject({ status: 400, code: "TECHNICIAN_INELIGIBLE" });
    },
  );
});

describe("booking availability service validation", () => {
  const date = "2099-06-15";

  it("checks active service and category before returning slots", async () => {
    const serviceFindFirst = jest.fn().mockResolvedValue({ id: "service-1" });
    const bookingFindMany = jest.fn().mockResolvedValue([]);
    const db = {
      repairService: { findFirst: serviceFindFirst },
      booking: { findMany: bookingFindMany },
    } as unknown as PrismaClient;

    const result = await new BookingService(db).getAvailableSlots({
      serviceId: "service-1",
      date,
    });

    expect(result.slots).toHaveLength(5);
    expect(serviceFindFirst).toHaveBeenCalledWith({
      where: {
        id: "service-1",
        active: true,
        category: { active: true },
      },
      select: { id: true },
    });
    expect(bookingFindMany).toHaveBeenCalledTimes(1);
  });

  it.each(["unknown", "inactive or in an inactive category"])(
    "rejects a service that is %s without querying bookings",
    async () => {
      const serviceFindFirst = jest.fn().mockResolvedValue(null);
      const bookingFindMany = jest.fn();
      const db = {
        repairService: { findFirst: serviceFindFirst },
        booking: { findMany: bookingFindMany },
      } as unknown as PrismaClient;

      await expect(
        new BookingService(db).getAvailableSlots({
          serviceId: "service-1",
          date,
        }),
      ).rejects.toMatchObject({
        status: 400,
        code: "SERVICE_UNAVAILABLE",
        message: "Service not found or inactive",
      });
      expect(bookingFindMany).not.toHaveBeenCalled();
    },
  );
});
