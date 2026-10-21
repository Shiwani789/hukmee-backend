import { prisma } from "../../config/database";
import { BadRequestError, NotFoundError } from "../../utils/errors";

type ReviewTypeValue = "PRODUCT" | "WORKER" | "VENDOR" | "DELIVERY_PARTNER";

export interface UpsertReviewDto {
  type: ReviewTypeValue;
  productId?: string;
  orderId?: string;
  bookingId?: string;
  vendorUserId?: string;
  workerUserId?: string;
  deliveryPartnerUserId?: string;
  rating: number;
  review?: string;
  comment?: string;
  images?: string[];
}

const completedOrderStatuses = ["DELIVERED", "COMPLETED"];

export class ReviewService {
  private normalizeImages(images?: unknown): string[] {
    if (!images) return [];
    if (Array.isArray(images)) return images.map(String).filter(Boolean);
    if (typeof images === "string") {
      try {
        const parsed = JSON.parse(images);
        return Array.isArray(parsed)
          ? parsed.map(String).filter(Boolean)
          : [images];
      } catch {
        return [images];
      }
    }
    return [];
  }

  private validateRating(rating: number) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestError("Rating must be between 1 and 5");
    }
  }

  private reviewSelect() {
    return {
      id: true,
      type: true,
      productId: true,
      orderId: true,
      bookingId: true,
      vendorUserId: true,
      workerUserId: true,
      deliveryPartnerUserId: true,
      rating: true,
      comment: true,
      images: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          firstName: true,
          profileImage: true,
        },
      },
    };
  }

  private async ensureProductReviewAllowed(
    userId: string,
    data: UpsertReviewDto,
  ) {
    if (!data.productId || !data.orderId)
      throw new BadRequestError("productId and orderId are required");
    const order = await prisma.order.findFirst({
      where: {
        id: data.orderId,
        userId,
        status: { in: completedOrderStatuses as any },
        OrderItem: { some: { productId: data.productId } },
      },
    });
    if (!order)
      throw new BadRequestError(
        "You can review this product only after purchasing it in a delivered order",
      );
  }

  private async ensureWorkerReviewAllowed(
    userId: string,
    data: UpsertReviewDto,
  ) {
    if (!data.bookingId) throw new BadRequestError("bookingId is required");
    const booking = await prisma.booking.findFirst({
      where: { id: data.bookingId, userId, bookingStatus: "COMPLETED" as any },
    });
    if (!booking)
      throw new BadRequestError(
        "You can review a worker only after your booking is completed",
      );
    if (!booking.workerId)
      throw new BadRequestError("No worker is assigned to this booking");
    data.workerUserId = booking.workerId;
  }

  private async ensureVendorReviewAllowed(
    userId: string,
    data: UpsertReviewDto,
  ) {
    if (!data.orderId) throw new BadRequestError("orderId is required");
    const order = await prisma.order.findFirst({
      where: {
        id: data.orderId,
        userId,
        status: { in: completedOrderStatuses as any },
      },
    });
    if (!order?.vendorUserId)
      throw new BadRequestError("No vendor found for this completed order");
    data.vendorUserId = order.vendorUserId;
  }

  private async ensureDeliveryReviewAllowed(
    userId: string,
    data: UpsertReviewDto,
  ) {
    if (!data.orderId) throw new BadRequestError("orderId is required");
    const order = await prisma.order.findFirst({
      where: {
        id: data.orderId,
        userId,
        status: { in: completedOrderStatuses as any },
        DeliveryAssignment: { status: "DELIVERED" as any },
      },
      include: { DeliveryAssignment: true },
    });
    if (!order?.DeliveryAssignment?.deliveryPartnerUserId) {
      throw new BadRequestError(
        "No delivered delivery partner found for this order",
      );
    }
    data.deliveryPartnerUserId = order.DeliveryAssignment.deliveryPartnerUserId;
  }

  private async validateReviewAccess(userId: string, data: UpsertReviewDto) {
    this.validateRating(Number(data.rating));
    if (data.type === "PRODUCT")
      return this.ensureProductReviewAllowed(userId, data);
    if (data.type === "WORKER")
      return this.ensureWorkerReviewAllowed(userId, data);
    if (data.type === "VENDOR")
      return this.ensureVendorReviewAllowed(userId, data);
    if (data.type === "DELIVERY_PARTNER")
      return this.ensureDeliveryReviewAllowed(userId, data);
    throw new BadRequestError("Invalid review type");
  }

  private uniqueWhere(userId: string, data: UpsertReviewDto): any {
    if (data.type === "PRODUCT") {
      return {
        type_userId_productId_orderId: {
          type: data.type,
          userId,
          productId: data.productId,
          orderId: data.orderId,
        },
      };
    }
    if (data.type === "WORKER") {
      return {
        type_userId_bookingId: {
          type: data.type,
          userId,
          bookingId: data.bookingId,
        },
      };
    }
    if (data.type === "VENDOR") {
      return {
        type_userId_vendorUserId_orderId: {
          type: data.type,
          userId,
          vendorUserId: data.vendorUserId,
          orderId: data.orderId,
        },
      };
    }
    return {
      type_userId_deliveryPartnerUserId_orderId: {
        type: data.type,
        userId,
        deliveryPartnerUserId: data.deliveryPartnerUserId,
        orderId: data.orderId,
      },
    };
  }

  private targetWhere(type: ReviewTypeValue, targetId: string): any {
    if (type === "PRODUCT")
      return { type, productId: targetId, deletedAt: null };
    if (type === "WORKER")
      return { type, workerUserId: targetId, deletedAt: null };
    if (type === "VENDOR")
      return { type, vendorUserId: targetId, deletedAt: null };
    return { type, deliveryPartnerUserId: targetId, deletedAt: null };
  }

  private async recalculateAggregate(
    type: ReviewTypeValue,
    targetId: string,
    tx: any = prisma,
  ) {
    const where = this.targetWhere(type, targetId);
    const [aggregate, total] = await Promise.all([
      tx.review.aggregate({ where, _avg: { rating: true } }),
      tx.review.count({ where }),
    ]);
    const average = Number((aggregate._avg.rating || 0).toFixed(2));

    if (type === "PRODUCT") {
      await tx.product.update({
        where: { id: targetId },
        data: { averageRating: average, totalRatings: total },
      });
    } else if (type === "WORKER") {
      await tx.workerDetails.update({
        where: { userId: targetId },
        data: { rating: average, totalReviews: total },
      });
    } else if (type === "VENDOR") {
      await tx.vendorDetails.update({
        where: { userId: targetId },
        data: { rating: average, totalReviews: total },
      });
    } else {
      await tx.deliveryDetails.update({
        where: { userId: targetId },
        data: { rating: average, totalReviews: total },
      });
    }
  }

  private targetIdFromReview(review: any): string {
    return (
      review.productId ||
      review.workerUserId ||
      review.vendorUserId ||
      review.deliveryPartnerUserId
    );
  }

  async upsertReview(userId: string, data: UpsertReviewDto) {
    await this.validateReviewAccess(userId, data);
    const payload = {
      type: data.type,
      userId,
      productId: data.type === "PRODUCT" ? data.productId : undefined,
      orderId: ["PRODUCT", "VENDOR", "DELIVERY_PARTNER"].includes(data.type)
        ? data.orderId
        : undefined,
      bookingId: data.type === "WORKER" ? data.bookingId : undefined,
      vendorUserId: data.type === "VENDOR" ? data.vendorUserId : undefined,
      workerUserId: data.type === "WORKER" ? data.workerUserId : undefined,
      deliveryPartnerUserId:
        data.type === "DELIVERY_PARTNER"
          ? data.deliveryPartnerUserId
          : undefined,
      rating: Number(data.rating),
      comment: data.review ?? data.comment,
      images: this.normalizeImages(data.images),
      deletedAt: null,
    };

    return prisma.$transaction(async (tx: any) => {
      const review = await tx.review.upsert({
        where: this.uniqueWhere(userId, data),
        create: payload,
        update: {
          rating: payload.rating,
          comment: payload.comment,
          images: payload.images,
          deletedAt: null,
        },
        select: this.reviewSelect(),
      });
      await this.recalculateAggregate(
        data.type,
        this.targetIdFromReview(review),
        tx,
      );
      return review;
    });
  }

  async updateReview(
    reviewId: string,
    userId: string,
    data: Partial<UpsertReviewDto>,
  ) {
    const existing = await prisma.review.findUnique({
      where: { id: reviewId },
    });
    if (!existing || existing.userId !== userId || existing.deletedAt) {
      throw new NotFoundError("Review not found or unauthorized");
    }
    if (data.rating !== undefined) this.validateRating(Number(data.rating));

    return prisma.$transaction(async (tx: any) => {
      const review = await tx.review.update({
        where: { id: reviewId },
        data: {
          rating: data.rating !== undefined ? Number(data.rating) : undefined,
          comment: data.review ?? data.comment,
          images:
            data.images !== undefined
              ? this.normalizeImages(data.images)
              : undefined,
        },
        select: this.reviewSelect(),
      });
      await this.recalculateAggregate(
        existing.type as ReviewTypeValue,
        this.targetIdFromReview(existing),
        tx,
      );
      return review;
    });
  }

  async deleteReview(reviewId: string, userId: string) {
    const existing = await prisma.review.findUnique({
      where: { id: reviewId },
    });
    if (!existing || existing.userId !== userId || existing.deletedAt) {
      throw new NotFoundError("Review not found or unauthorized");
    }
    return prisma.$transaction(async (tx: any) => {
      await tx.review.update({
        where: { id: reviewId },
        data: { deletedAt: new Date() },
      });
      await this.recalculateAggregate(
        existing.type as ReviewTypeValue,
        this.targetIdFromReview(existing),
        tx,
      );
    });
  }

  async getReviews(type: ReviewTypeValue, targetId: string) {
    const where = this.targetWhere(type, targetId);
    const [reviews, aggregate, total, grouped] = await Promise.all([
      prisma.review.findMany({
        where,
        select: this.reviewSelect(),
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.review.aggregate({ where, _avg: { rating: true } }),
      prisma.review.count({ where }),
      prisma.review.groupBy({
        by: ["rating"],
        where,
        _count: { rating: true },
      }),
    ]);
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<
      number,
      number
    >;
    grouped.forEach((item: any) => {
      distribution[item.rating] = item._count.rating;
    });
    return {
      averageRating: Number((aggregate._avg.rating || 0).toFixed(2)),
      totalRatings: total,
      ratingDistribution: distribution,
      latestReviews: reviews,
    };
  }

  getProductReviews(productId: string) {
    return this.getReviews("PRODUCT", productId);
  }
}
