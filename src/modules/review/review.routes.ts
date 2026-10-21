import { Router } from "express";
import { z } from "zod";
import { ReviewController } from "./review.controller";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import upload from "../../middlewares/upload";

const router = Router();
const reviewController = new ReviewController();
const reviewUpload = upload("reviews").fields([
  { name: "images", maxCount: 5 },
]);

const ratingSchema = z.object({
  body: z.object({
    type: z
      .enum(["PRODUCT", "WORKER", "VENDOR", "DELIVERY_PARTNER"])
      .optional(),
    productId: z.string().optional(),
    workerUserId: z.string().optional(),
    vendorUserId: z.string().optional(),
    deliveryPartnerUserId: z.string().optional(),
    orderId: z.string().optional(),
    bookingId: z.string().optional(),
    rating: z.coerce.number().int().min(1).max(5),
    review: z.string().optional(),
    comment: z.string().optional(),
    images: z.any().optional(),
  }),
});

const updateRatingSchema = z.object({
  body: z.object({
    rating: z.coerce.number().int().min(1).max(5).optional(),
    review: z.string().optional(),
    comment: z.string().optional(),
    images: z.any().optional(),
  }),
});

router.get(
  "/product/:productId",
  reviewController.getProductReviews.bind(reviewController),
);
router.get(
  "/worker/:workerUserId",
  reviewController.getWorkerReviews.bind(reviewController),
);
router.get(
  "/vendor/:vendorUserId",
  reviewController.getVendorReviews.bind(reviewController),
);
router.get(
  "/delivery-partner/:deliveryPartnerUserId",
  reviewController.getDeliveryPartnerReviews.bind(reviewController),
);

router.use(requireAuth, requireRole(["USER"]));

router.post(
  "/",
  reviewUpload,
  validateRequest(ratingSchema),
  reviewController.createReview.bind(reviewController),
);
router.post(
  "/product",
  reviewUpload,
  validateRequest(ratingSchema),
  reviewController.createProductReview.bind(reviewController),
);
router.post(
  "/worker",
  reviewUpload,
  validateRequest(ratingSchema),
  reviewController.createWorkerReview.bind(reviewController),
);
router.post(
  "/vendor",
  reviewUpload,
  validateRequest(ratingSchema),
  reviewController.createVendorReview.bind(reviewController),
);
router.post(
  "/delivery-partner",
  reviewUpload,
  validateRequest(ratingSchema),
  reviewController.createDeliveryPartnerReview.bind(reviewController),
);
router.put(
  "/:id",
  reviewUpload,
  validateRequest(updateRatingSchema),
  reviewController.updateReview.bind(reviewController),
);
router.delete("/:id", reviewController.deleteReview.bind(reviewController));

export default router;
