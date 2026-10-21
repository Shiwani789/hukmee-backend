import { Router } from "express";
import { CmsController } from "./cms.controller";
import { validateRequest } from "../../middlewares/validate.middleware";
import {
  updateCmsSchema,
  cmsTypeParamSchema,
} from "../../middlewares/cms.validation";
import { cacheResponse, invalidateCache } from "../../utils/cache";

const publicRouter = Router();
const adminRouter = Router();
const cmsController = new CmsController();

// ─── PUBLIC ROUTES ─────────────────────────────────────────────────────────────
publicRouter.get(
  "/about",
  cacheResponse({ namespace: "cms", ttlSeconds: 1800 }),
  cmsController.getAboutPage,
);
publicRouter.get(
  "/privacy-policy",
  cacheResponse({ namespace: "cms", ttlSeconds: 1800 }),
  cmsController.getPrivacyPolicyPage,
);
publicRouter.get(
  "/terms-and-conditions",
  cacheResponse({ namespace: "cms", ttlSeconds: 1800 }),
  cmsController.getTermsAndConditionsPage,
);

// ─── ADMIN ROUTES ──────────────────────────────────────────────────────────────
// Admin authorization should be handled in the parent route (e.g., admin.routes.ts)
adminRouter.get("/", cmsController.getAllCmsPages);

adminRouter.get(
  "/:type",
  validateRequest(cmsTypeParamSchema),
  cmsController.getCmsPageByType,
);

adminRouter.put(
  "/:type",
  invalidateCache("cms"),
  validateRequest(updateCmsSchema),
  cmsController.updateCmsPage,
);

export { publicRouter as publicCmsRouter, adminRouter as adminCmsRouter };
