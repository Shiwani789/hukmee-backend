import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requireRole } from "../../middlewares/role";
import { vendorKycDocumentUpload } from "../../middlewares/upload";
import { vendorKycController } from "./vendor-identity.controller";
import { validate } from "../../utils/validate";
import {
  adminListSchema,
  applicationParamsSchema,
  applicationReviewSchema,
  addressDetailsSchema,
  bankDetailsSchema,
  documentReviewSchema,
  documentParamsSchema,
  rejectApplicationSchema,
  personalDetailsSchema,
  professionalDetailsSchema,
  uploadIdentitySchema,
} from "../../validation/vendor-identity";

export const adminVendorKycRoutes = Router();
adminVendorKycRoutes.use(authenticate, requireRole("ADMIN", "SUPER_ADMIN"));
adminVendorKycRoutes.get(
  "/",
  validate(adminListSchema),
  vendorKycController.adminList,
);
adminVendorKycRoutes.get(
  "/requests",
  validate(adminListSchema),
  vendorKycController.adminList,
);
adminVendorKycRoutes.get(
  "/:applicationId",
  validate(applicationParamsSchema),
  vendorKycController.adminDetail,
);
adminVendorKycRoutes.get(
  "/requests/:applicationId",
  validate(applicationParamsSchema),
  vendorKycController.adminDetail,
);
adminVendorKycRoutes.post(
  "/requests/:applicationId/approve",
  validate(applicationParamsSchema),
  vendorKycController.approveApplication,
);
adminVendorKycRoutes.post(
  "/requests/:applicationId/reject",
  validate(rejectApplicationSchema),
  vendorKycController.rejectApplication,
);
adminVendorKycRoutes.patch(
  "/documents/:documentId/review",
  validate(documentReviewSchema),
  vendorKycController.adminReviewDocument,
);
adminVendorKycRoutes.patch(
  "/:applicationId/review",
  validate(applicationReviewSchema),
  vendorKycController.adminReviewApplication,
);
adminVendorKycRoutes.get(
  "/documents/:documentId/:side",
  validate(documentParamsSchema),
  vendorKycController.getFile,
);

export const vendorKycRoutes = Router();
vendorKycRoutes.use(authenticate, requireRole("VENDOR", "TECHNICIAN"));
vendorKycRoutes.get("/policy", vendorKycController.policy);
vendorKycRoutes.get("/status", vendorKycController.ownStatus);
vendorKycRoutes.get(
  "/personal-details",
  vendorKycController.getPersonalDetails,
);
vendorKycRoutes.put(
  "/personal-details",
  validate(personalDetailsSchema),
  vendorKycController.savePersonalDetails,
);
vendorKycRoutes.get("/address", vendorKycController.getAddress);
vendorKycRoutes.put(
  "/address",
  validate(addressDetailsSchema),
  vendorKycController.saveAddress,
);
vendorKycRoutes.get("/identity", vendorKycController.getIdentity);
vendorKycRoutes.put(
  "/identity",
  vendorKycDocumentUpload(),
  validate(uploadIdentitySchema),
  vendorKycController.uploadDocument,
);
vendorKycRoutes.get(
  "/professional-details",
  vendorKycController.getProfessionalDetails,
);
vendorKycRoutes.put(
  "/professional-details",
  validate(professionalDetailsSchema),
  vendorKycController.saveProfessionalDetails,
);
vendorKycRoutes.get("/bank-details", vendorKycController.getBankDetails);
vendorKycRoutes.put(
  "/bank-details",
  validate(bankDetailsSchema),
  vendorKycController.saveBankDetails,
);
vendorKycRoutes.post("/submit", vendorKycController.submit);
vendorKycRoutes.get(
  "/documents/:documentId/:side",
  validate(documentParamsSchema),
  vendorKycController.getFile,
);
