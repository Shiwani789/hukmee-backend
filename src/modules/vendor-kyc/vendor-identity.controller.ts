import { asyncHandler } from "../../utils/async-handler";
import { AppError } from "../../utils/errors";
import { VendorKycService } from "./vendor-identity.service";
import { authenticatedContext } from "../../utils/auth-context";
import {
  validatedBody,
  validatedParams,
  validatedQuery,
} from "../../utils/validated-request";
import {
  addressDetailsSchema,
  adminListSchema,
  applicationParamsSchema,
  applicationReviewSchema,
  bankDetailsSchema,
  documentParamsSchema,
  documentReviewSchema,
  personalDetailsSchema,
  professionalDetailsSchema,
  rejectApplicationSchema,
  uploadIdentitySchema,
} from "../../validation/vendor-identity";

const service = new VendorKycService();
export class VendorKycController {
  getPersonalDetails = asyncHandler(async (req, res) => {
    res.json({
      data: await service.getStep(
        authenticatedContext(req).userId,
        "personalDetails",
      ),
    });
  });
  getAddress = asyncHandler(async (req, res) => {
    res.json({
      data: await service.getStep(
        authenticatedContext(req).userId,
        "addressDetails",
      ),
    });
  });
  getProfessionalDetails = asyncHandler(async (req, res) => {
    res.json({
      data: await service.getStep(
        authenticatedContext(req).userId,
        "professionalDetails",
      ),
    });
  });
  getBankDetails = asyncHandler(async (req, res) => {
    res.json({
      data: await service.getStep(
        authenticatedContext(req).userId,
        "bankDetails",
      ),
    });
  });
  getIdentity = asyncHandler(async (req, res) => {
    res.json({
      data: await service.getIdentityStep(authenticatedContext(req).userId),
    });
  });
  savePersonalDetails = asyncHandler(async (req, res) => {
    res.json({
      data: await service.saveStep(
        authenticatedContext(req).userId,
        "personalDetails",
        validatedBody(personalDetailsSchema, res),
      ),
    });
  });
  saveAddress = asyncHandler(async (req, res) => {
    res.json({
      data: await service.saveStep(
        authenticatedContext(req).userId,
        "addressDetails",
        validatedBody(addressDetailsSchema, res),
      ),
    });
  });
  saveProfessionalDetails = asyncHandler(async (req, res) => {
    res.json({
      data: await service.saveStep(
        authenticatedContext(req).userId,
        "professionalDetails",
        validatedBody(professionalDetailsSchema, res),
      ),
    });
  });
  saveBankDetails = asyncHandler(async (req, res) => {
    res.json({
      data: await service.saveStep(
        authenticatedContext(req).userId,
        "bankDetails",
        validatedBody(bankDetailsSchema, res),
      ),
    });
  });
  policy = asyncHandler(async (_req, res) => {
    res.json({ data: service.getDocumentPolicy() });
  });
  ownStatus = asyncHandler(async (req, res) => {
    res.json({
      data: await service.getOwnStatus(authenticatedContext(req).userId),
    });
  });
  uploadDocument = asyncHandler(async (req, res) => {
    const input = validatedBody(uploadIdentitySchema, res);
    const uploaded =
      req.files && !Array.isArray(req.files) ? req.files : undefined;
    const data = await service.uploadDocument(
      authenticatedContext(req).userId,
      {
        documentType: input.documentType,
        ...(input.documentNumber !== undefined
          ? { documentNumber: input.documentNumber }
          : {}),
        ...(input.nameOnDocument !== undefined
          ? { nameOnDocument: input.nameOnDocument }
          : {}),
      },
      {
        ...(uploaded?.frontImage?.[0]
          ? { frontImage: uploaded.frontImage[0] }
          : {}),
        ...(uploaded?.backImage?.[0]
          ? { backImage: uploaded.backImage[0] }
          : {}),
      },
    );
    res.status(201).json({ data });
  });
  submit = asyncHandler(async (req, res) => {
    res.json({ data: await service.submit(authenticatedContext(req).userId) });
  });
  getFile = asyncHandler(async (req, res) => {
    const { side, documentId } = validatedParams(documentParamsSchema, res);
    if (side !== "front" && side !== "back")
      throw new AppError(
        404,
        "DOCUMENT_FILE_NOT_FOUND",
        "Document file not found",
      );
    const isAdmin = authenticatedContext(req).roles.some((role) =>
      ["ADMIN", "SUPER_ADMIN"].includes(role),
    );
    const file = await service.getDocumentForAccess(
      documentId,
      authenticatedContext(req).userId,
      isAdmin,
      side,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(file.contentType).send(file.buffer);
  });
  adminList = asyncHandler(async (req, res) => {
    const { status, page, limit } = validatedQuery(adminListSchema, res);
    res.json({
      data: await service.listApplications({
        ...(status !== undefined ? { status } : {}),
        ...(page !== undefined ? { page } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }),
    });
  });
  adminDetail = asyncHandler(async (req, res) => {
    res.json({
      data: await service.getAdminDetail(
        validatedParams(applicationParamsSchema, res).applicationId,
        authenticatedContext(req).userId,
      ),
    });
  });
  adminReviewDocument = asyncHandler(async (req, res) => {
    const input = validatedBody(documentReviewSchema, res);
    res.json({
      data: await service.reviewDocument(
        validatedParams(documentReviewSchema, res).documentId,
        authenticatedContext(req).userId,
        input.status,
        input.feedback,
      ),
    });
  });
  adminReviewApplication = asyncHandler(async (req, res) => {
    const input = validatedBody(applicationReviewSchema, res);
    res.json({
      data: await service.reviewApplication(
        validatedParams(applicationReviewSchema, res).applicationId,
        authenticatedContext(req).userId,
        input.status,
        input.feedback,
      ),
    });
  });
  approveApplication = asyncHandler(async (req, res) => {
    res.json({
      data: await service.reviewApplication(
        validatedParams(applicationParamsSchema, res).applicationId,
        authenticatedContext(req).userId,
        "APPROVED",
      ),
    });
  });
  rejectApplication = asyncHandler(async (req, res) => {
    const input = validatedBody(rejectApplicationSchema, res);
    res.json({
      data: await service.reviewApplication(
        validatedParams(rejectApplicationSchema, res).applicationId,
        authenticatedContext(req).userId,
        "REJECTED",
        input.reason,
      ),
    });
  });
}

export const vendorKycController = new VendorKycController();
