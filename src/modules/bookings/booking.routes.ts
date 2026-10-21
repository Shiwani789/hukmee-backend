import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/permission";
import { requireRole } from "../../middlewares/role";
import { validate } from "../../utils/validate";
import {
  assignBookingSchema,
  availabilityQuerySchema,
  bookingIdSchema,
  createBookingSchema,
  createInspectionSchema,
  decideEstimateSchema,
  eligibleTechniciansSchema,
  submitEstimateSchema,
} from "../../validation/booking";
import { bookingController } from "./booking.controller";

const router = Router();
router.use(authenticate);

// Booking management operations.
router.get(
  "/eligible-technicians",
  requirePermission("bookings:manage"),
  validate(eligibleTechniciansSchema),
  bookingController.eligibleTechnicians,
);
router.post(
  "/:bookingId/assign",
  requirePermission("bookings:manage"),
  validate(assignBookingSchema),
  bookingController.assign,
);

// Technician operations.
router.get(
  "/assignments",
  requireRole("TECHNICIAN"),
  bookingController.technicianOffers,
);
router.post(
  "/:bookingId/accept",
  requireRole("TECHNICIAN"),
  validate(bookingIdSchema),
  bookingController.acceptAssignment,
);
router.post(
  "/:bookingId/reject",
  requireRole("TECHNICIAN"),
  validate(bookingIdSchema),
  bookingController.rejectAssignment,
);
router.post(
  "/:bookingId/inspection",
  requireRole("TECHNICIAN"),
  validate(createInspectionSchema),
  bookingController.createInspection,
);
router.post(
  "/:bookingId/estimates",
  requireRole("TECHNICIAN"),
  validate(submitEstimateSchema),
  bookingController.submitEstimate,
);

// Customer booking operations.
router.get("/", requireRole("USER"), bookingController.list);
router.get(
  "/availability",
  requireRole("USER"),
  validate(availabilityQuerySchema),
  bookingController.getAvailability,
);
router.post(
  "/",
  requireRole("USER"),
  validate(createBookingSchema),
  bookingController.create,
);
router.get(
  "/:bookingId",
  requireRole("USER"),
  validate(bookingIdSchema),
  bookingController.get,
);
router.post(
  "/:bookingId/estimates/:estimateId/decision",
  requireRole("USER"),
  validate(decideEstimateSchema),
  bookingController.decideEstimate,
);

export default router;
