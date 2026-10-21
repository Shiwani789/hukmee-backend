import { z } from "zod";

// ── Helpers ────────────────────────────────────────────────────────────────
// ISO-8601 datetime string that must be in the future at parse time.
// We re-validate on the server during creation for safety.
const futureDatetimeSchema = z.string().datetime({ offset: true });

// ── Create Booking ─────────────────────────────────────────────────────────
export const createBookingSchema = z.object({
  body: z.object({
    deviceId: z.uuid(),
    serviceId: z.uuid(),
    partGradeId: z.uuid().optional(),
    addressId: z.uuid().optional(),
    problemDescription: z.string().trim().min(5).max(2000),
    scheduledAt: futureDatetimeSchema.optional(),
  }),
  params: z.object({}),
  query: z.object({}),
});

// ── Availability Query ─────────────────────────────────────────────────────
// GET /bookings/availability?serviceId=<uuid>&date=YYYY-MM-DD
export const availabilityQuerySchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    serviceId: z.uuid(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD format")
      .refine((v) => {
        const [year, month, day] = v.split("-").map(Number);
        const d = new Date(Date.UTC(year!, month! - 1, day!));
        return (
          d.getUTCFullYear() === year &&
          d.getUTCMonth() === month! - 1 &&
          d.getUTCDate() === day
        );
      }, "date is not a valid calendar date"),
  }),
});

// ── Booking ID Param ───────────────────────────────────────────────────────
export const bookingIdSchema = z.object({
  body: z.object({}),
  params: z.object({ bookingId: z.uuid() }),
  query: z.object({}),
});

// ── Admin Assign ───────────────────────────────────────────────────────────
export const assignBookingSchema = z.object({
  body: z.object({ technicianUserId: z.uuid() }),
  params: z.object({ bookingId: z.uuid() }),
  query: z.object({}),
});

// ── Eligible Technicians Query ─────────────────────────────────────────────
export const eligibleTechniciansSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({ serviceId: z.uuid() }),
});

// ── Inspection ─────────────────────────────────────────────────────────────
const estimateLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z
    .string()
    .regex(/^\d{1,8}(\.\d{1,2})?$/)
    .refine((value) => Number(value) > 0),
  unitAmount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
});

export const createInspectionSchema = z.object({
  body: z.object({
    findings: z.string().trim().min(1).max(10000),
    technicianNotes: z.string().trim().max(5000).optional(),
  }),
  params: z.object({ bookingId: z.uuid() }),
  query: z.object({}),
});

export const submitEstimateSchema = z.object({
  body: z.object({ lines: z.array(estimateLineSchema).min(1).max(100) }),
  params: z.object({ bookingId: z.uuid() }),
  query: z.object({}),
});

export const decideEstimateSchema = z.object({
  body: z.object({
    accepted: z.boolean(),
    reason: z.string().trim().max(2000).optional(),
  }),
  params: z.object({ bookingId: z.uuid(), estimateId: z.uuid() }),
  query: z.object({}),
});

// ── TypeScript inferred types ──────────────────────────────────────────────
export type CreateBookingInput = z.infer<typeof createBookingSchema>["body"];
export type AvailabilityQuery = z.infer<
  typeof availabilityQuerySchema
>["query"];
export type AssignBookingInput = z.infer<typeof assignBookingSchema>["body"];
export type EligibleTechniciansQuery = z.infer<
  typeof eligibleTechniciansSchema
>["query"];
export type CreateInspectionInput = z.infer<
  typeof createInspectionSchema
>["body"];
export type SubmitEstimateInput = z.infer<typeof submitEstimateSchema>["body"];
export type DecideEstimateInput = z.infer<typeof decideEstimateSchema>["body"];
