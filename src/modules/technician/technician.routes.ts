import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requireRole } from "../../middlewares/role";
import { technicianController } from "./technician.controller";
import { validate } from "../../utils/validate";
import { technicianRouteParamsSchema } from "../../validation/technician";

const router = Router();
router.use(authenticate, requireRole("TECHNICIAN"));
router.get(
  "/profile",
  validate(technicianRouteParamsSchema),
  technicianController.getOwnProfile,
);
router.get(
  "/onboarding/status",
  validate(technicianRouteParamsSchema),
  technicianController.getOwnOnboardingStatus,
);

export default router;
