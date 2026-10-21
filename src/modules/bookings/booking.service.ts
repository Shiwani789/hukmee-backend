import { randomUUID } from "node:crypto";
import { BookingStatus } from "@prisma/client";
import { AssignmentStatus } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { EstimateStatus } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/errors";
import type {
  AssignBookingInput,
  AvailabilityQuery,
  CreateBookingInput,
  EligibleTechniciansQuery,
  CreateInspectionInput,
  SubmitEstimateInput,
  DecideEstimateInput,
} from "../../validation/booking";

// Existing business rule: appointments run 09:00–19:00 Asia/Kolkata in
// exclusive two-hour windows. These constants preserve that established API
// behavior until working hours are represented as persisted configuration.
const BOOKING_TIME_ZONE = "Asia/Kolkata";
const SLOT_DURATION_MINUTES = 120;
const WORKING_START_MINUTES = 9 * 60;
const WORKING_END_MINUTES = 19 * 60;

function dateAtLocalMinutes(date: string, minutes: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  // Asia/Kolkata has a fixed UTC+05:30 offset (no DST).
  return new Date(
    Date.UTC(year!, month! - 1, day!) + minutes * 60_000 - 330 * 60_000,
  );
}

function istDateString(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BOOKING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function slotStartsForDate(date: string): Date[] {
  const result: Date[] = [];
  for (
    let minute = WORKING_START_MINUTES;
    minute + SLOT_DURATION_MINUTES <= WORKING_END_MINUTES;
    minute += SLOT_DURATION_MINUTES
  ) {
    result.push(dateAtLocalMinutes(date, minute));
  }
  return result;
}

export class BookingService {
  constructor(private readonly db: typeof prisma = prisma) {}

  listForUser(userId: string) {
    return this.db.booking.findMany({
      where: { userId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        device: { include: { model: { include: { brand: true } } } },
        service: true,
      },
    });
  }

  listOffersForTechnician(userId: string) {
    return this.db.repairAssignment.findMany({
      where: {
        technician: { userId },
        status: { in: [AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED] },
      },
      orderBy: { assignedAt: "desc" },
      include: {
        booking: {
          include: {
            device: { include: { model: { include: { brand: true } } } },
            service: true,
            address: true,
          },
        },
      },
    });
  }

  listEligibleTechnicians(query: EligibleTechniciansQuery) {
    return this.db.technicianProfile.findMany({
      where: {
        active: true,
        approvedAt: { not: null },
        user: {
          is: {
            isActive: true,
            role: { is: { name: UserRole.WORKER } },
            vendorKycApplication: { is: { status: "APPROVED" } },
          },
        },
        skills: {
          some: {
            serviceId: query.serviceId,
            service: { is: { active: true } },
          },
        },
      },
      orderBy: { userId: "asc" },
      select: { userId: true },
    });
  }

  async createRequest(
    userId: string,
    roles: string[],
    input: CreateBookingInput,
  ) {
    if (!roles.includes("USER")) {
      throw new AppError(403, "FORBIDDEN", "User role is required");
    }
    // Validate and normalize the requested appointment against the same slot
    // generator used by the availability API.
    const requestedSlot = input.scheduledAt
      ? new Date(input.scheduledAt)
      : null;
    if (requestedSlot && requestedSlot <= new Date()) {
      throw new AppError(
        400,
        "SLOT_IN_PAST",
        "scheduledAt must be a future slot",
      );
    }
    if (requestedSlot) {
      const localDate = istDateString(requestedSlot);
      const isSlot = slotStartsForDate(localDate).some(
        (slot) => slot.getTime() === requestedSlot.getTime(),
      );
      if (!isSlot) {
        throw new AppError(
          400,
          "INVALID_SLOT",
          "scheduledAt must match an available slot",
        );
      }
    }
    // 2. Device ownership check
    const device = await this.db.userDevice.findFirst({
      where: { id: input.deviceId, userId },
      select: { id: true, modelId: true },
    });
    if (!device)
      throw new AppError(404, "DEVICE_NOT_FOUND", "Device not found");
    // 3. Address ownership check (optional field)
    if (input.addressId) {
      const address = await this.db.address.findFirst({
        where: { id: input.addressId, userId },
        select: { id: true },
      });
      if (!address)
        throw new AppError(404, "ADDRESS_NOT_FOUND", "Address not found");
    }
    // 4. Service active + compatible with device model
    const service = await this.db.repairService.findFirst({
      where: {
        id: input.serviceId,
        active: true,
        category: { active: true },
        compatibility: {
          some: {
            modelId: device.modelId,
            model: { active: true, brand: { active: true } },
          },
        },
      },
      select: { id: true },
    });
    if (!service) {
      throw new AppError(
        400,
        "SERVICE_UNAVAILABLE",
        "Service is not available for this device model",
      );
    }
    return this.db.$transaction(async (tx) => {
      const selectedGrade = input.partGradeId
        ? await tx.partGrade.findFirst({
            where: {
              id: input.partGradeId,
              active: true,
              price: { not: null },
              part: {
                active: true,
                compatibility: {
                  some: {
                    modelId: device.modelId,
                    model: { active: true, brand: { active: true } },
                  },
                },
                serviceMappings: { some: { serviceId: input.serviceId } },
              },
            },
            select: {
              id: true,
              name: true,
              price: true,
              part: { select: { name: true } },
            },
          })
        : null;
      if (input.partGradeId && !selectedGrade) {
        throw new AppError(
          400,
          "GRADE_UNAVAILABLE",
          "The selected grade is unavailable for this service and device model",
        );
      }
      if (selectedGrade && selectedGrade.price === null) {
        throw new AppError(
          400,
          "GRADE_UNAVAILABLE",
          "The selected grade does not have a configured price",
        );
      }
      if (requestedSlot) {
        // Serialize reservation attempts for this service/slot in PostgreSQL.
        // Transaction-scoped advisory locks avoid schema changes and ensure the
        // conflict query and insert form one atomic reservation operation.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.serviceId}:${requestedSlot.toISOString()}`}, 0))`;
        const conflict = await tx.booking.findFirst({
          where: {
            serviceId: input.serviceId,
            status: { not: BookingStatus.CANCELLED },
            scheduledAt: requestedSlot,
          },
          select: { id: true },
        });
        if (conflict) {
          throw new AppError(
            409,
            "SLOT_UNAVAILABLE",
            "The selected time slot is no longer available",
          );
        }
      }
      const booking = await tx.booking.create({
        data: {
          reference: `HK-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          userId: userId,
          deviceId: device.id,
          serviceId: service.id,
          ...(selectedGrade
            ? {
                partGradeId: selectedGrade.id,
                partNameSnapshot: selectedGrade.part.name,
                gradeNameSnapshot: selectedGrade.name,
                gradePriceSnapshot: selectedGrade.price,
              }
            : {}),
          ...(input.addressId ? { addressId: input.addressId } : {}),
          problemDescription: input.problemDescription,
          ...(input.scheduledAt
            ? { scheduledAt: new Date(input.scheduledAt) }
            : {}),
          status: BookingStatus.REQUESTED,
          statusEvents: {
            create: {
              status: BookingStatus.REQUESTED,
              actorUserId: userId,
              note: "User repair request created",
            },
          },
        },
        include: {
          statusEvents: true,
          service: true,
          device: { include: { model: { include: { brand: true } } } },
          address: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "booking.requested",
          entityType: "Booking",
          entityId: booking.id,
        },
      });
      return booking;
    });
  }

  async getForUser(userId: string, bookingId: string) {
    const booking = await this.db.booking.findFirst({
      where: { id: bookingId, userId: userId },
      include: {
        statusEvents: { orderBy: { createdAt: "asc" } },
        assignments: true,
        inspection: { include: { evidence: true } },
        estimates: {
          include: { lines: true, decisions: true },
          orderBy: { version: "desc" },
        },
        payments: {
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            createdAt: true,
          },
        },
        device: { include: { model: { include: { brand: true } } } },
        address: true,
        service: true,
      },
    });
    if (!booking)
      throw new AppError(404, "BOOKING_NOT_FOUND", "Booking not found");
    return booking;
  }

  /** Returns the existing two-hour Asia/Kolkata slots and their availability. */
  async getAvailableSlots(query: AvailabilityQuery) {
    const service = await this.db.repairService.findFirst({
      where: {
        id: query.serviceId,
        active: true,
        category: { active: true },
      },
      select: { id: true },
    });
    if (!service) {
      throw new AppError(
        400,
        "SERVICE_UNAVAILABLE",
        "Service not found or inactive",
      );
    }

    if (query.date < istDateString(new Date())) {
      throw new AppError(
        400,
        "PAST_DATE",
        "Cannot query availability for a past date",
      );
    }

    const dayStart = dateAtLocalMinutes(query.date, 0);
    const dayEnd = dateAtLocalMinutes(query.date, 24 * 60);
    const existingBookings = await this.db.booking.findMany({
      where: {
        serviceId: query.serviceId,
        scheduledAt: { gte: dayStart, lt: dayEnd },
        status: { notIn: [BookingStatus.CANCELLED as BookingStatus] },
      },
      select: { scheduledAt: true },
    });

    const bookedStartsMs = new Set(
      existingBookings
        .filter((b) => b.scheduledAt !== null)
        .map((b) => b.scheduledAt!.getTime()),
    );

    const now = Date.now();
    const slots = slotStartsForDate(query.date).map((slotStartUTC) => {
      const available =
        slotStartUTC.getTime() > now &&
        !bookedStartsMs.has(slotStartUTC.getTime());
      const slotEndUTC = new Date(
        slotStartUTC.getTime() + SLOT_DURATION_MINUTES * 60_000,
      );
      return {
        startAt: slotStartUTC.toISOString(),
        endAt: slotEndUTC.toISOString(),
        status: available ? "AVAILABLE" : "UNAVAILABLE",
        available,
      };
    });

    return { date: query.date, slots };
  }

  async assign(
    bookingId: string,
    actorUserId: string,
    input: AssignBookingInput,
  ) {
    const technician = await this.db.technicianProfile.findFirst({
      where: {
        userId: input.technicianUserId,
        active: true,
        approvedAt: { not: null },
        user: {
          is: {
            isActive: true,
            role: { is: { name: UserRole.WORKER } },
            vendorKycApplication: { is: { status: "APPROVED" } },
          },
        },
      },
      select: { id: true },
    });
    if (!technician) {
      throw new AppError(
        400,
        "TECHNICIAN_INELIGIBLE",
        "Technician is not approved and active",
      );
    }
    return this.db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, serviceId: true },
      });
      if (!booking)
        throw new AppError(404, "BOOKING_NOT_FOUND", "Booking not found");
      const skill = await tx.technicianSkill.findUnique({
        where: {
          technicianId_serviceId: {
            technicianId: technician.id,
            serviceId: booking.serviceId,
          },
        },
        select: { technicianId: true },
      });
      if (!skill) {
        throw new AppError(
          400,
          "TECHNICIAN_SKILL_MISMATCH",
          "Technician does not support this service",
        );
      }
      const changed = await tx.booking.updateMany({
        where: { id: booking.id, status: BookingStatus.REQUESTED },
        data: { status: BookingStatus.ASSIGNED },
      });
      if (changed.count !== 1) {
        throw new AppError(
          409,
          "BOOKING_NOT_ASSIGNABLE",
          "Booking is no longer awaiting assignment",
        );
      }
      const assignment = await tx.repairAssignment.create({
        data: { bookingId: booking.id, technicianId: technician.id },
      });
      await tx.bookingStatusEvent.create({
        data: {
          bookingId: booking.id,
          status: BookingStatus.ASSIGNED,
          actorUserId,
          note: "Technician assignment offered",
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: "booking.assigned",
          entityType: "Booking",
          entityId: booking.id,
          metadata: {
            assignmentId: assignment.id,
            technicianId: technician.id,
          },
        },
      });
      return assignment;
    });
  }

  async createInspection(
    bookingId: string,
    technicianUserId: string,
    input: CreateInspectionInput,
  ) {
    return this.db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, status: true },
      });
      if (!booking)
        throw new AppError(404, "BOOKING_NOT_FOUND", "Booking not found");
      if (booking.status !== BookingStatus.ACCEPTED)
        throw new AppError(
          409,
          "BOOKING_STATE_CONFLICT",
          "Inspection is allowed only after the assignment is accepted",
        );
      const assignment = await tx.repairAssignment.findFirst({
        where: {
          bookingId,
          status: AssignmentStatus.ACCEPTED,
          technician: {
            userId: technicianUserId,
            active: true,
            approvedAt: { not: null },
            user: { is: { isActive: true } },
          },
        },
        select: { id: true },
      });
      if (!assignment)
        throw new AppError(
          404,
          "ASSIGNMENT_NOT_FOUND",
          "Accepted assignment not found",
        );
      const inspection = await tx.repairInspection.create({
        data: {
          bookingId,
          findings: input.findings,
          ...(input.technicianNotes
            ? { technicianNotes: input.technicianNotes }
            : {}),
        },
        include: { evidence: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: technicianUserId,
          action: "booking.inspection.created",
          entityType: "Booking",
          entityId: bookingId,
          metadata: {
            inspectionId: inspection.id,
            assignmentId: assignment.id,
          },
        },
      });
      return inspection;
    });
  }

  async submitEstimate(
    bookingId: string,
    technicianUserId: string,
    input: SubmitEstimateInput,
  ) {
    return this.db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, status: true },
      });
      if (!booking)
        throw new AppError(404, "BOOKING_NOT_FOUND", "Booking not found");
      if (booking.status !== BookingStatus.ACCEPTED)
        throw new AppError(
          409,
          "BOOKING_STATE_CONFLICT",
          "Estimate requires an accepted booking",
        );
      const assignment = await tx.repairAssignment.findFirst({
        where: {
          bookingId,
          status: AssignmentStatus.ACCEPTED,
          technician: {
            userId: technicianUserId,
            active: true,
            approvedAt: { not: null },
            user: { is: { isActive: true } },
          },
        },
        select: { id: true },
      });
      if (!assignment)
        throw new AppError(
          404,
          "ASSIGNMENT_NOT_FOUND",
          "Accepted assignment not found",
        );
      const inspection = await tx.repairInspection.findUnique({
        where: { bookingId },
        select: { id: true },
      });
      if (!inspection)
        throw new AppError(
          409,
          "INSPECTION_REQUIRED",
          "Complete the inspection before submitting an estimate",
        );
      const openEstimate = await tx.repairEstimate.findFirst({
        where: { bookingId, status: EstimateStatus.SUBMITTED },
        select: { id: true },
      });
      if (openEstimate)
        throw new AppError(
          409,
          "ESTIMATE_AWAITING_DECISION",
          "A submitted estimate is already awaiting user decision",
        );
      const latest = await tx.repairEstimate.aggregate({
        where: { bookingId },
        _max: { version: true },
      });
      const version = (latest._max.version ?? 0) + 1;
      const estimate = await tx.repairEstimate.create({
        data: {
          bookingId,
          version,
          status: EstimateStatus.SUBMITTED,
          submittedAt: new Date(),
          lines: {
            create: input.lines.map((line) => ({
              description: line.description,
              quantity: line.quantity,
              unitAmount: line.unitAmount,
            })),
          },
        },
        include: { lines: true, decisions: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: technicianUserId,
          action: "booking.estimate.submitted",
          entityType: "Booking",
          entityId: bookingId,
          metadata: { estimateId: estimate.id, version },
        },
      });
      return estimate;
    });
  }

  async decideEstimate(
    bookingId: string,
    estimateId: string,
    userId: string,
    input: DecideEstimateInput,
  ) {
    return this.db.$transaction(async (tx) => {
      const estimate = await tx.repairEstimate.findFirst({
        where: { id: estimateId, bookingId },
        select: {
          id: true,
          status: true,
          booking: { select: { userId: true } },
        },
      });
      if (!estimate || estimate.booking.userId !== userId)
        throw new AppError(404, "ESTIMATE_NOT_FOUND", "Estimate not found");
      if (estimate.status !== EstimateStatus.SUBMITTED)
        throw new AppError(
          409,
          "ESTIMATE_ALREADY_DECIDED",
          "Estimate is no longer awaiting a decision",
        );
      const status = input.accepted
        ? EstimateStatus.ACCEPTED
        : EstimateStatus.REJECTED;
      const changed = await tx.repairEstimate.updateMany({
        where: { id: estimateId, bookingId, status: EstimateStatus.SUBMITTED },
        data: { status },
      });
      if (changed.count !== 1)
        throw new AppError(
          409,
          "ESTIMATE_ALREADY_DECIDED",
          "Estimate is no longer awaiting a decision",
        );
      const decision = await tx.repairEstimateDecision.create({
        data: {
          estimateId,
          accepted: input.accepted,
          actorUserId: userId,
          ...(input.reason ? { reason: input.reason } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: input.accepted
            ? "booking.estimate.accepted"
            : "booking.estimate.rejected",
          entityType: "Booking",
          entityId: bookingId,
          metadata: { estimateId, decisionId: decision.id },
        },
      });
      return { estimateId, status, decision };
    });
  }

  async decideAssignment(
    bookingId: string,
    technicianUserId: string,
    decision: "accept" | "reject",
  ) {
    return this.db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, status: true },
      });
      if (!booking) {
        throw new AppError(404, "BOOKING_NOT_FOUND", "Booking not found");
      }
      if (booking.status !== BookingStatus.ASSIGNED) {
        throw new AppError(
          409,
          "BOOKING_STATE_CONFLICT",
          "Booking is no longer awaiting an assignment decision",
        );
      }
      const assignment = await tx.repairAssignment.findFirst({
        where: {
          bookingId,
          technician: { userId: technicianUserId },
        },
        select: { id: true, bookingId: true, status: true },
      });
      if (!assignment) {
        throw new AppError(
          404,
          "ASSIGNMENT_NOT_FOUND",
          "Offered assignment not found",
        );
      }
      if (assignment.status !== AssignmentStatus.OFFERED) {
        throw new AppError(
          409,
          "ASSIGNMENT_ALREADY_DECIDED",
          "Assignment is no longer awaiting a decision",
        );
      }

      const assignmentStatus =
        decision === "accept"
          ? AssignmentStatus.ACCEPTED
          : AssignmentStatus.REJECTED;
      const bookingStatus =
        decision === "accept"
          ? BookingStatus.ACCEPTED
          : BookingStatus.REQUESTED;
      const changedAssignment = await tx.repairAssignment.updateMany({
        where: { id: assignment.id, status: AssignmentStatus.OFFERED },
        data: { status: assignmentStatus, decidedAt: new Date() },
      });
      if (changedAssignment.count !== 1) {
        throw new AppError(
          409,
          "ASSIGNMENT_ALREADY_DECIDED",
          "Assignment is no longer awaiting a decision",
        );
      }
      const changedBooking = await tx.booking.updateMany({
        where: { id: bookingId, status: BookingStatus.ASSIGNED },
        data: { status: bookingStatus },
      });
      if (changedBooking.count !== 1) {
        throw new AppError(
          409,
          "BOOKING_STATE_CONFLICT",
          "Booking is no longer awaiting this assignment decision",
        );
      }
      await tx.bookingStatusEvent.create({
        data: {
          bookingId,
          status: bookingStatus,
          actorUserId: technicianUserId,
          note:
            decision === "accept"
              ? "Assigned technician accepted the offer"
              : "Assigned technician rejected the offer; booking returned to requested",
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: technicianUserId,
          action: `booking.assignment.${decision}ed`,
          entityType: "Booking",
          entityId: bookingId,
          metadata: { assignmentId: assignment.id },
        },
      });
      return { assignmentId: assignment.id, assignmentStatus, bookingStatus };
    });
  }
}
