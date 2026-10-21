import { Request, Response } from "express";
import { ReviewService } from "./review.service";

const reviewService = new ReviewService();

export class ReviewController {
  private getUploadedImages(req: Request) {
    const files = req.files as
      | Record<string, Express.Multer.File[]>
      | undefined;
    const images = files?.images || [];
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return images.map((file) => `${baseUrl}/uploads/reviews/${file.filename}`);
  }

  private bodyWithImages(req: Request, type?: string) {
    const uploadedImages = this.getUploadedImages(req);
    return {
      ...req.body,
      type: type || req.body.type,
      images: uploadedImages.length ? uploadedImages : req.body.images,
    };
  }

  async getProductReviews(req: Request, res: Response) {
    try {
      const reviews = await reviewService.getReviews(
        "PRODUCT",
        String(req.params.productId),
      );
      res.status(200).json({ success: true, data: reviews });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getWorkerReviews(req: Request, res: Response) {
    try {
      const reviews = await reviewService.getReviews(
        "WORKER",
        String(req.params.workerUserId),
      );
      res.status(200).json({ success: true, data: reviews });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getVendorReviews(req: Request, res: Response) {
    try {
      const reviews = await reviewService.getReviews(
        "VENDOR",
        String(req.params.vendorUserId),
      );
      res.status(200).json({ success: true, data: reviews });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getDeliveryPartnerReviews(req: Request, res: Response) {
    try {
      const reviews = await reviewService.getReviews(
        "DELIVERY_PARTNER",
        String(req.params.deliveryPartnerUserId),
      );
      res.status(200).json({ success: true, data: reviews });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async createReview(req: Request, res: Response) {
    try {
      const review = await reviewService.upsertReview(
        req.user.userId,
        this.bodyWithImages(req),
      );
      res.status(201).json({
        success: true,
        message: "Review submitted successfully",
        data: review,
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async createProductReview(req: Request, res: Response) {
    try {
      const review = await reviewService.upsertReview(
        req.user.userId,
        this.bodyWithImages(req, "PRODUCT"),
      );
      res.status(201).json({
        success: true,
        message: "Product review submitted successfully",
        data: review,
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async createWorkerReview(req: Request, res: Response) {
    try {
      const review = await reviewService.upsertReview(
        req.user.userId,
        this.bodyWithImages(req, "WORKER"),
      );
      res.status(201).json({
        success: true,
        message: "Worker review submitted successfully",
        data: review,
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async createVendorReview(req: Request, res: Response) {
    try {
      const review = await reviewService.upsertReview(
        req.user.userId,
        this.bodyWithImages(req, "VENDOR"),
      );
      res.status(201).json({
        success: true,
        message: "Vendor review submitted successfully",
        data: review,
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async createDeliveryPartnerReview(req: Request, res: Response) {
    try {
      const review = await reviewService.upsertReview(
        req.user.userId,
        this.bodyWithImages(req, "DELIVERY_PARTNER"),
      );
      res.status(201).json({
        success: true,
        message: "Delivery partner review submitted successfully",
        data: review,
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async updateReview(req: Request, res: Response) {
    try {
      const review = await reviewService.updateReview(
        String(req.params.id),
        req.user.userId,
        this.bodyWithImages(req),
      );
      res.status(200).json({
        success: true,
        message: "Review updated successfully",
        data: review,
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async deleteReview(req: Request, res: Response) {
    try {
      await reviewService.deleteReview(String(req.params.id), req.user.userId);
      res
        .status(200)
        .json({ success: true, message: "Review deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }
}
