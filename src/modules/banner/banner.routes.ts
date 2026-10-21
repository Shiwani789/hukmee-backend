import { Router } from "express";
import { BannerController } from "./banner.controller";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware";
import upload from "../../middlewares/upload";

const router = Router();
const bannerController = new BannerController();

// Public route for fetching active banners
router.get("/", bannerController.getPublicBanners);

// Admin only routes
router.use(requireAuth, requireRole(["ADMIN", "SUPER_ADMIN"]));
router.get("/admin", bannerController.getAdminBanners);
router.get("/:id", bannerController.getBanner);
router.post(
  "/",
  upload("banners").single("image"),
  bannerController.createBanner,
);
router.put(
  "/:id",
  upload("banners").single("image"),
  bannerController.updateBanner,
);
router.delete("/:id", bannerController.deleteBanner);

export default router;
