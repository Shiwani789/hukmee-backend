import { authenticatedContext } from "../../utils/auth-context";
import { asyncHandler } from "../../utils/async-handler";
import { AppError } from "../../utils/errors";
import {
  validatedBody,
  validatedParams,
  validatedQuery,
} from "../../utils/validated-request";
import { BookingService } from "./booking.service";
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

const service = new BookingService();

export class BookingController {
  list = asyncHandler(async (req, res) => {
    if (!authenticatedContext(req).roles.includes("USER")) {
      throw new AppError(403, "FORBIDDEN", "User role is required");
    }
    res.json({
      data: await service.listForUser(authenticatedContext(req).userId),
    });
  });
  create = asyncHandler(async (req, res) => {
    const input = validatedBody(createBookingSchema, res);
    const data = await service.createRequest(
      authenticatedContext(req).userId,
      authenticatedContext(req).roles,
      input,
    );
    res.status(201).json({ data });
  });
  getAvailability = asyncHandler(async (_req, res) => {
    const query = validatedQuery(availabilityQuerySchema, res);
    res.json({ data: await service.getAvailableSlots(query) });
  });
  get = asyncHandler(async (req, res) => {
    const { bookingId } = validatedParams(bookingIdSchema, res);
    res.json({
      data: await service.getForUser(
        authenticatedContext(req).userId,
        bookingId,
      ),
    });
  });
  assign = asyncHandler(async (req, res) => {
    const { bookingId } = validatedParams(assignBookingSchema, res);
    const input = validatedBody(assignBookingSchema, res);
    const data = await service.assign(
      bookingId,
      authenticatedContext(req).userId,
      input,
    );
    res.status(201).json({ data });
  });
  technicianOffers = asyncHandler(async (req, res) => {
    res.json({
      data: await service.listOffersForTechnician(
        authenticatedContext(req).userId,
      ),
    });
  });
  eligibleTechnicians = asyncHandler(async (_req, res) => {
    const query = validatedQuery(eligibleTechniciansSchema, res);
    res.json({ data: await service.listEligibleTechnicians(query) });
  });
  createInspection = asyncHandler(async (req, res) => {
    const { bookingId } = validatedParams(createInspectionSchema, res);
    const input = validatedBody(createInspectionSchema, res);
    const data = await service.createInspection(
      bookingId,
      authenticatedContext(req).userId,
      input,
    );
    res.status(201).json({ data });
  });
  submitEstimate = asyncHandler(async (req, res) => {
    const { bookingId } = validatedParams(submitEstimateSchema, res);
    const input = validatedBody(submitEstimateSchema, res);
    const data = await service.submitEstimate(
      bookingId,
      authenticatedContext(req).userId,
      input,
    );
    res.status(201).json({ data });
  });
  decideEstimate = asyncHandler(async (req, res) => {
    const { bookingId, estimateId } = validatedParams(
      decideEstimateSchema,
      res,
    );
    const input = validatedBody(decideEstimateSchema, res);
    const data = await service.decideEstimate(
      bookingId,
      estimateId,
      authenticatedContext(req).userId,
      input,
    );
    res.json({ data });
  });
  acceptAssignment = asyncHandler(async (req, res) => {
    const { bookingId } = validatedParams(bookingIdSchema, res);
    res.json({
      data: await service.decideAssignment(
        bookingId,
        authenticatedContext(req).userId,
        "accept",
      ),
    });
  });
  rejectAssignment = asyncHandler(async (req, res) => {
    const { bookingId } = validatedParams(bookingIdSchema, res);
    res.json({
      data: await service.decideAssignment(
        bookingId,
        authenticatedContext(req).userId,
        "reject",
      ),
    });
  });
}

export const bookingController = new BookingController();
