import { Router } from "express";
import { AdminVendorController } from "./admin-vendor.controller";
import { validateRequest } from "../../middlewares/validate.middleware";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware";
import {
  createVendorSchema,
  updateVendorSchema,
  addDocumentSchema,
} from "./admin-vendor.service";
import upload from "../../middlewares/upload";

const router = Router();
const controller = new AdminVendorController();

// Only ADMIN can access these routes (checked at parent router or here)
router.use(requireAuth, requireRole(["ADMIN", "SUPER_ADMIN"]));

router.get("/onboarding/requests", controller.getOnboardingRequests);
router.get("/onboarding/requests/:userId", controller.getOnboardingRequest);
router.put("/onboarding/requests/:userId", controller.updateOnboardingRequest);
router.post(
  "/onboarding/requests/:userId/approve",
  controller.approveOnboardingRequest,
);
router.post(
  "/onboarding/requests/:userId/reject",
  controller.rejectOnboardingRequest,
);

// VendorDetails CRUD Routes
router.post("/", validateRequest(createVendorSchema), controller.createVendor);
router.get("/", controller.getAllVendors);
router.get("/:vendorUserId", controller.getVendorById);
router.put(
  "/:vendorUserId",
  validateRequest(updateVendorSchema),
  controller.updateVendor,
);
router.delete("/:vendorUserId", controller.deleteVendor);

// VendorDetails Document Routes
router.post(
  "/:vendorUserId/documents",
  upload("vendors").single("documentUrl"),
  validateRequest(addDocumentSchema),
  controller.addDocument,
);
router.get("/:vendorUserId/documents", controller.getDocuments);
router.delete(
  "/:vendorUserId/documents/:documentId",
  controller.deleteDocument,
);

export default router;
