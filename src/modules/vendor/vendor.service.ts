import { prisma } from "../../config/database";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import {
  geocodeAddress,
  calculateDrivingDistance,
  calculateShippingCharge,
} from "../../utils/location.util";
import { DeliveryPartnerService } from "../delivery-partner/delivery-partner.service";
import { NotificationService } from "../notification/notification.service";
import { formatPreferredDeliverySlot } from "../order/delivery-slot.service";

export interface CreateVendorDto {
  userId: string;
  companyName: string;
}

export interface UpdateVendorDto {
  firstName?: string;
  lastName?: string;
  phone?: string;
  profileImage?: string;
}

export interface VendorOnboardingDto {
  fullName: string;
  email: string;
  gender: "Male" | "Female" | "Other";
  businessType: string;
  businessName: string;
  state: string;
  city: string;
  businessAddress: string;
  addressProofUrl?: string;
  profileImage?: string;
  latitude?: number;
  longitude?: number;
  serviceRadiusKm?: number;
}

export interface DeliveryPreparationDto {
  orderItemId?: string;
  pickupLocation: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  dropLatitude?: number;
  dropLongitude?: number;
  preferredPickupDateTime: string;
  // Vehicle selection is derived by delivery matching from the complete order.
  vehicleTypeRequired?: never;
  loadType: string;
  estimatedWeight: string;
  additionalNotes?: string;
}

export class VendorService {
  private notificationService = new NotificationService();

  private formatVendorProfile(vendor: any) {
    const profile = vendor.user?.vendorKYCProfile;
    // Generate a formatted vendor ID
    const shortId = vendor.id.split("-")[0].toUpperCase();
    const currentYear = new Date().getFullYear();
    const vendorIdStr = `VND-${currentYear}-${shortId}`;

    return {
      id: vendor.id,
      vendorId: vendorIdStr,
      userId: vendor.userId,
      status: vendor.user?.status || "INACTIVE",
      onboardingStatus: profile?.onboardingStatus || "NOT_REGISTERED",
      rejectionReason: profile?.rejectionReason || null,
      approvedAt:
        profile?.onboardingStatus === "APPROVED" ? profile?.updatedAt : null,
      profileImage: vendor.user?.profileImage || null,
      fullName:
        profile?.fullName ||
        profile?.ownerName ||
        vendor.user?.firstName ||
        null,
      email: profile?.email || vendor.user?.email || null,
      gender: profile?.gender || null,
      businessType: profile?.businessType || vendor.businessType || null,
      businessName: profile?.businessName || vendor.companyName || null,
      companyName: profile?.businessName || vendor.companyName || null,
      state: profile?.state || null,
      city: profile?.city || null,
      businessAddress: profile?.businessAddress || null,
      addressProofUrl: profile?.addressProofUrl || null,
      profile,
    };
  }

  private async ensureApprovedVendor(userId: string) {
    const vendor = await prisma.vendorDetails.findUnique({
      where: { userId },
      include: { user: { include: { vendorKYCProfile: true } } },
    });
    if (!vendor) throw new NotFoundError("Vendor profile not found");

    const profile = (vendor as any).user?.vendorKYCProfile;
    if (
      (vendor as any).user?.status !== "ACTIVE" ||
      profile?.onboardingStatus !== "APPROVED"
    ) {
      throw new BadRequestError(
        "Vendor onboarding is not approved yet. Please complete onboarding or wait for admin approval.",
      );
    }

    return vendor;
  }

  private getProductFirstImage(product: any): string | null {
    if (!product || !product.images) return null;
    let images: any = product.images;
    if (typeof images === "string") {
      try {
        images = JSON.parse(images);
      } catch (e) {
        images = [images];
      }
    }
    if (!Array.isArray(images) || images.length === 0) return null;
    const firstImage = images[0];
    if (!firstImage) return null;
    return this.formatProductImageUrl(firstImage);
  }
  j;

  private getPublicAssetBaseUrl() {
    const configuredBaseUrl =
      process.env.CONSTRUCTO_PUBLIC_BASE_URL || process.env.BASE_URL || "";
    const baseUrl =
      configuredBaseUrl.includes("localhost") ||
      configuredBaseUrl.includes("127.0.0.1")
        ? "https://constructo.technogigz.co.in"
        : configuredBaseUrl || "https://constructo.technogigz.co.in";
    return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  }

  private formatProductImageUrl(
    image: string | null | undefined,
  ): string | null {
    if (!image || typeof image !== "string") return null;
    if (image.startsWith("http://") || image.startsWith("https://"))
      return image;
    const cleanImagePath = image.startsWith("/") ? image : `/${image}`;
    return `${this.getPublicAssetBaseUrl()}${cleanImagePath}`;
  }

  private formatDeliveryRequestState(order: any) {
    const request = order.DeliveryRequest?.[0] || null;
    const delivery = order.DeliveryAssignment || null;
    const hasAcceptedPartner = Boolean(delivery);
    const pendingRequest =
      request?.status === "PENDING" && request.expiresAt > new Date();
    const latestAssignmentAudit = (order.AuditLog || [])[0] || null;
    const adminPending =
      latestAssignmentAudit?.action === "DELIVERY_ASSIGNMENT_PENDING";
    const wasBroadcast =
      latestAssignmentAudit?.action === "DELIVERY_REQUESTS_BROADCAST";
    const requestStatus =
      request?.status === "PENDING" && request.expiresAt <= new Date()
        ? "EXPIRED"
        : request?.status;
    const timelineEntry = [...(order.OrderTimeline || [])]
      .reverse()
      .find((item: any) => item.status === "READY_FOR_PICKUP" && item.metadata);
    const requestDetails =
      timelineEntry?.metadata?.details || timelineEntry?.metadata || {};

    return {
      requestId: request?.id || null,
      isDeliveryPartnerRequested:
        Boolean(request) || hasAcceptedPartner || wasBroadcast,
      status: hasAcceptedPartner
        ? "ACCEPTED"
        : pendingRequest
          ? "WAITING"
          : adminPending
            ? "PENDING_ADMIN_ASSIGNMENT"
            : requestStatus || "NOT_REQUESTED",
      requestedAt: request?.createdAt || null,
      acceptedAt: delivery?.acceptedAt || null,
      canRequestDeliveryPartner: !hasAcceptedPartner && !pendingRequest,
      selectedVehicle: requestDetails.selectedVehicle || null,
      pendingReason: adminPending
        ? (latestAssignmentAudit.metadata as any)?.reason || null
        : null,
      message: hasAcceptedPartner
        ? "Delivery partner accepted"
        : pendingRequest
          ? "Waiting for delivery partner to accept"
          : adminPending
            ? "Delivery assignment is pending admin action"
            : null,
    };
  }

  private formatOrderCard(order: any) {
    const assignments = order.VendorAssignment || [];
    const assignmentIds = assignments
      .map((a: any) => a.orderItemId)
      .filter(Boolean);
    const assignment = assignments[0] || null;
    const items =
      assignmentIds.length > 0
        ? (order.OrderItem || []).filter((item: any) =>
            assignmentIds.includes(item.id),
          )
        : order.OrderItem || [];
    const deliveryRequestStatus = this.formatDeliveryRequestState(order);
    const deliveryVehicleOptions = items
      .filter((item: any) => item.vehicleTypeId || item.vehicleTypeName)
      .map((item: any) => ({
        orderItemId: item.id,
        productName: item.productName || item.Product?.name || "",
        vehicleTypeId: item.vehicleTypeId || null,
        vehicleTypeName: item.vehicleTypeName || null,
        vehicleType:
          item.vehicleTypeId || item.vehicleTypeName
            ? {
                id: item.vehicleTypeId || null,
                name: item.vehicleTypeName || null,
                capacity: item.capacity ?? null,
                capacityUnit: item.capacityUnit || null,
              }
            : null,
        quantity: Number(item.quantity || 0),
        unit: item.unit || item.Product?.unit || "unit",
        isSelected:
          deliveryRequestStatus.selectedVehicle?.orderItemId === item.id,
      }));
    const address = order.shippingAddressSnapshot as any;
    const deliveryAddress =
      address?.fullAddress ||
      [
        address?.addressLine1,
        address?.addressLine2,
        address?.city,
        address?.state,
        address?.pincode,
      ]
        .filter(Boolean)
        .join(" ");
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      assignmentId: assignment?.id || null,
      deliveryAddress,
      deliveryLocation: address
        ? {
            name: address.name || null,
            phone: address.phone || null,
            address: deliveryAddress || null,
            addressLine1: address.addressLine1 || null,
            addressLine2: address.addressLine2 || null,
            city: address.city || null,
            state: address.state || null,
            country: address.country || null,
            pincode: address.pincode || null,
            latitude:
              address.latitude == null ? null : Number(address.latitude),
            longitude:
              address.longitude == null ? null : Number(address.longitude),
          }
        : null,
      pickupLocation: (order as any).User_Order_vendorUserIdToUser
        ?.vendorKYCProfile
        ? {
            name:
              (order as any).User_Order_vendorUserIdToUser.vendorKYCProfile
                .businessName || null,
            address:
              (order as any).User_Order_vendorUserIdToUser.vendorKYCProfile
                .businessAddress || null,
            city:
              (order as any).User_Order_vendorUserIdToUser.vendorKYCProfile
                .city || null,
            state:
              (order as any).User_Order_vendorUserIdToUser.vendorKYCProfile
                .state || null,
            pincode:
              (order as any).User_Order_vendorUserIdToUser.vendorKYCProfile
                .pincode || null,
            latitude:
              (order as any).User_Order_vendorUserIdToUser.vendorKYCProfile
                .latitude ?? null,
            longitude:
              (order as any).User_Order_vendorUserIdToUser.vendorKYCProfile
                .longitude ?? null,
          }
        : null,
      orderedProduct: items
        .map((item: any) => item.Product?.name || "")
        .filter(Boolean)
        .join(", "),
      quantity: items.reduce(
        (sum: number, item: any) => sum + Number(item.quantity || 0),
        0,
      ),
      unit: items[0]?.Product?.unit || "unit",
      productImage: this.getProductFirstImage(items[0]?.Product),
      totalAmount: Number(order.netAmount),
      orderStatus: assignment ? assignment.status : order.status,
      deliveryRequestStatus,
      deliveryVehicleOptions,
      deliveryPartner: this.formatDeliveryPartnerDetails(
        order.DeliveryAssignment,
      ),
      deliverySlot: formatPreferredDeliverySlot(order),
      createdAt: order.createdAt,
      assignment,
      instructions: assignment?.remarks || null,
      pickupOtp:
        assignment?.pickupOtp || order.DeliveryAssignment?.pickupOtp || null,
      items: items.map((item: any) => {
        let productImages: string[] | undefined;
        if (item.Product?.images) {
          let imgs = item.Product.images;
          if (typeof imgs === "string") {
            try {
              imgs = JSON.parse(imgs);
            } catch (e) {
              imgs = [imgs];
            }
          }
          if (Array.isArray(imgs)) {
            productImages = imgs
              .map((img: string) => {
                return this.formatProductImageUrl(img);
              })
              .filter((img): img is string => Boolean(img));
          }
        }

        return {
          id: item.id,
          productId: item.productId,
          productPriceId: item.productPriceId || null,
          name: item.productName || item.Product?.name || "",
          image: productImages?.[0] || this.getProductFirstImage(item.Product),
          images: productImages || [],
          productImage:
            productImages?.[0] || this.getProductFirstImage(item.Product),

          brandName: item.brandName || null,
          vehicleTypeId: item.vehicleTypeId || null,
          vehicleTypeName: item.vehicleTypeName || null,
          vehicleType:
            item.vehicleTypeId || item.vehicleTypeName
              ? {
                  id: item.vehicleTypeId || null,
                  name: item.vehicleTypeName || null,
                  capacity: item.capacity ?? null,
                  capacityUnit: item.capacityUnit || null,
                }
              : null,
          quantity: item.quantity,
          unit: item.unit || item.Product?.unit || "unit",
          unitPrice: Number(item.unitPrice),
          totalPrice: Number(item.totalPrice),
        };
      }),
      payment: (order as any).Payment || null,
      timeline: (order as any).OrderTimeline || [],
      delivery: (order as any).DeliveryAssignment || null,
      tracking: this.buildVendorOrderTracking(order),
    };
  }

  private getVendorDashboardStatus(assignment: any, order: any) {
    if (assignment?.status === "PENDING") return "NEW";
    if (assignment?.status === "ACCEPTED") return "ACCEPTED";
    if (assignment?.status === "REJECTED") {
      return assignment?.rejectionReason === "OUT_OF_STOCK"
        ? "OUT_OF_STOCK"
        : "REJECTED";
    }
    return order?.status || assignment?.status || "PENDING";
  }

  private formatRecentAssignedOrder(assignment: any) {
    const order = assignment.Order || {};
    const items = assignment.orderItemId
      ? (order.OrderItem || []).filter(
          (item: any) => item.id === assignment.orderItemId,
        )
      : order.OrderItem || [];
    const firstItem = items[0] || null;
    const quantity = items.reduce(
      (sum: number, item: any) => sum + Number(item.quantity || 0),
      0,
    );
    const status = this.getVendorDashboardStatus(assignment, order);
    const deliveryDate =
      order.OrderTimeline?.find((item: any) => item.status === "DELIVERED")
        ?.createdAt ||
      order.DeliveryAssignment?.deliveryTime ||
      null;

    return {
      assignmentId: assignment.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      productName:
        firstItem?.Product?.name ||
        items
          .map((item: any) => item.Product?.name)
          .filter(Boolean)
          .join(", "),
      productImage: this.getProductFirstImage(firstItem?.Product),
      quantity,
      unit: firstItem?.Product?.unit || "unit",
      totalAmount: Number(order.netAmount || 0),
      status,
      statusLabel:
        status === "NEW"
          ? "New"
          : status === "ACCEPTED"
            ? "Accepted"
            : status === "OUT_OF_STOCK"
              ? "Out of stock"
              : status.charAt(0) +
                status.slice(1).toLowerCase().replace(/_/g, " "),
      deliveryDate,
      deliverySlot: formatPreferredDeliverySlot(order),
      deliveryRequestStatus: this.formatDeliveryRequestState(order),
      deliveryPartner: this.formatDeliveryPartnerDetails(
        order.DeliveryAssignment,
      ),
      assignedAt: assignment.assignedAt,
      orderStatus: order.status,
      assignmentStatus: assignment.status,
      rejectionReason: assignment.rejectionReason || null,
      instructions: assignment.remarks || null,
      pickupOtp: order.DeliveryAssignment?.pickupOtp || null,
    };
  }

  private formatDeliveryPartnerDetails(delivery: any) {
    if (!delivery) return null;
    const partner = delivery.user || null;
    const details = partner?.DeliveryDetails || null;
    const documents = partner?.KYCApplication?.KYCDocument || [];
    const liveSelfie =
      documents.find((doc: any) =>
        ["SELFIE", "LIVE_SELFIE"].includes(doc.documentType),
      )?.documentUrl || null;
    const profileImage =
      liveSelfie || details?.profilePhotoUrl || partner?.profileImage || null;

    return {
      assignmentId: delivery.id,
      deliveryPartnerUserId: delivery.deliveryPartnerUserId,
      status: delivery.status,
      acceptedAt: delivery.acceptedAt || null,
      reachedPickupAt: delivery.reachedPickupAt || null,
      pickupTime: delivery.pickupTime || null,
      pickedUpAt: delivery.pickupTime || delivery.pickupOtpVerifiedAt || null,
      deliveryTime: delivery.deliveryTime || null,
      distanceKm:
        delivery.distanceKm != null ? Number(delivery.distanceKm) : null,
      etaMinutes: delivery.etaMinutes || null,
      pickupOtp: delivery.pickupOtp || null,
      partner: {
        userId: delivery.deliveryPartnerUserId,
        profileImage,
        name:
          details?.fullName ||
          [partner?.firstName, partner?.lastName].filter(Boolean).join(" ") ||
          null,
        phone: details?.mobileNumber || partner?.phone || null,
        email: details?.email || partner?.email || null,
        rating: details?.rating || 0,
        totalReviews: details?.totalReviews || 0,
        address:
          details?.currentAddress ||
          [details?.city, details?.state, details?.country, details?.pincode]
            .filter(Boolean)
            .join(", ") ||
          null,
        currentAddress: details?.currentAddress || null,
        permanentAddress: details?.permanentAddress || null,
        city: details?.city || null,
        state: details?.state || null,
        pincode: details?.pincode || null,
        vehicle: {
          type: details?.vehicleType || null,
          number: details?.vehicleNumber || null,
          brand: details?.vehicleBrand || null,
          model: details?.vehicleModel || null,
        },
        location: {
          latitude: details?.currentLatitude || null,
          longitude: details?.currentLongitude || null,
          updatedAt: details?.locationUpdatedAt || null,
        },
      },
    };
  }

  private buildVendorOrderTracking(order: any) {
    const timeline = order.OrderTimeline || [];
    const assignment = order.VendorAssignment?.[0] || null;
    const delivery = order.DeliveryAssignment || null;
    const deliveryRequest = order.DeliveryRequest?.[0] || null;
    const findTimeline = (statuses: string[]) =>
      timeline.find((item: any) => statuses.includes(item.status));
    const isCompleted = (statuses: string[]) => statuses.includes(order.status);

    return {
      currentStatus: order.status,
      steps: [
        {
          key: "REQUEST_SENT",
          label: "Request Sent",
          status: "COMPLETED",
          timestamp:
            assignment?.assignedAt ||
            findTimeline(["VENDOR_ASSIGNED"])?.createdAt ||
            order.createdAt,
        },
        {
          key: "VENDOR_ACCEPTED",
          label: "Vendor Accepted",
          status:
            assignment?.status === "ACCEPTED" ||
            [
              "VENDOR_ACCEPTED",
              "PREPARING_ORDER",
              "READY_FOR_PICKUP",
              "DELIVERY_PARTNER_ASSIGNED",
              "PICKED_UP",
              "IN_TRANSIT",
              "OUT_FOR_DELIVERY",
              "DELIVERED",
            ].includes(order.status)
              ? "COMPLETED"
              : assignment?.status === "REJECTED"
                ? "REJECTED"
                : "PENDING",
          timestamp:
            assignment?.acceptedAt ||
            assignment?.rejectedAt ||
            findTimeline(["VENDOR_ACCEPTED", "WAITING_FOR_VENDOR"])
              ?.createdAt ||
            null,
          message:
            assignment?.status === "REJECTED" ? assignment?.remarks : undefined,
          reason: assignment?.rejectionReason || undefined,
        },
        {
          key: "PICKUP_REQUESTED",
          label: "Pickup Requested",
          status: isCompleted([
            "READY_FOR_PICKUP",
            "DELIVERY_PARTNER_ASSIGNED",
            "PICKED_UP",
            "IN_TRANSIT",
            "OUT_FOR_DELIVERY",
            "DELIVERED",
          ])
            ? "COMPLETED"
            : "PENDING",
          timestamp: findTimeline(["READY_FOR_PICKUP"])?.createdAt || null,
          details: findTimeline(["READY_FOR_PICKUP"])?.metadata || null,
        },
        {
          key: "DRIVER_ASSIGNED",
          label: "Driver Assigned",
          status:
            delivery ||
            isCompleted([
              "DELIVERY_PARTNER_ASSIGNED",
              "PICKED_UP",
              "IN_TRANSIT",
              "OUT_FOR_DELIVERY",
              "DELIVERED",
            ])
              ? "COMPLETED"
              : deliveryRequest?.status === "PENDING"
                ? "WAITING"
                : "PENDING",
          timestamp:
            findTimeline(["DELIVERY_PARTNER_ASSIGNED"])?.createdAt ||
            delivery?.createdAt ||
            deliveryRequest?.createdAt ||
            null,
          message:
            deliveryRequest?.status === "PENDING"
              ? "Waiting for delivery partner to accept"
              : undefined,
        },
        {
          key: "PICKED_UP",
          label: "Picked Up",
          status:
            isCompleted([
              "PICKED_UP",
              "IN_TRANSIT",
              "OUT_FOR_DELIVERY",
              "DELIVERED",
            ]) || delivery?.status === "PICKED_UP"
              ? "COMPLETED"
              : "PENDING",
          timestamp:
            delivery?.pickupTime ||
            findTimeline(["PICKED_UP"])?.createdAt ||
            null,
        },
        {
          key: "IN_TRANSIT",
          label: "In Transit",
          status:
            isCompleted(["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"]) ||
            ["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"].includes(
              delivery?.status,
            )
              ? "COMPLETED"
              : "PENDING",
          timestamp: findTimeline(["IN_TRANSIT"])?.createdAt || null,
        },
        {
          key: "DELIVERED",
          label: "Delivered",
          status:
            order.status === "DELIVERED" || delivery?.status === "DELIVERED"
              ? "COMPLETED"
              : "PENDING",
          timestamp:
            delivery?.deliveryTime ||
            findTimeline(["DELIVERED"])?.createdAt ||
            null,
        },
      ],
    };
  }

  async getProfile(userId: string) {
    const [vendor, unreadNotificationCount, wallet, myOrdersCount] =
      await Promise.all([
        prisma.vendorDetails.findUnique({
          where: { userId },
          include: { user: { include: { vendorKYCProfile: true } } },
        }),
        prisma.notification.count({ where: { userId, isRead: false } }),
        prisma.wallet.findUnique({ where: { userId } }),
        prisma.order.count({
          where: { vendorUserId: userId, deletedAt: null },
        }),
      ]);
    if (!vendor) throw new NotFoundError("Vendor profile not found");
    const walletAvailableAmount = wallet
      ? Number(
          (Number(wallet.balance) - Number(wallet.lockedBalance)).toFixed(2),
        )
      : 0;

    return {
      ...this.formatVendorProfile(vendor),
      unreadNotificationCount,
      walletAvailableAmount,
      myOrdersCount,
    };
  }

  async createProfile(data: CreateVendorDto) {
    const existing = await prisma.vendorDetails.findUnique({
      where: { userId: data.userId },
      include: { user: true },
    });
    if (existing) throw new BadRequestError("Vendor profile already exists");
    return prisma.vendorDetails.create({
      data,
      include: { user: true },
    });
  }

  async updateProfile(userId: string, data: UpdateVendorDto) {
    return prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  async submitOnboarding(userId: string, data: VendorOnboardingDto) {
    const vendor = await prisma.vendorDetails.findUnique({
      where: { userId },
      include: { user: { include: { vendorKYCProfile: true } } },
    });
    if (!vendor) throw new NotFoundError("Vendor profile not found");

    const currentStatus = (vendor as any).user?.vendorKYCProfile
      ?.onboardingStatus;
    if (currentStatus === "APPROVED")
      throw new BadRequestError("Vendor onboarding is already approved");
    if (currentStatus === "PENDING")
      throw new BadRequestError(
        "Vendor onboarding request is already submitted and pending admin review",
      );

    return prisma.$transaction(async (tx: any) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: data.email,
          firstName: data.fullName,
          ...(data.profileImage && { profileImage: data.profileImage }),
          status: "PENDING",
        },
      });

      await tx.vendorDetails.update({
        where: { userId },
        data: {
          companyName: data.businessName,
          businessType: data.businessType,
        },
      });

      const profile = await tx.vendorProfile.upsert({
        where: { userId },
        create: {
          userId,
          fullName: data.fullName,
          ownerName: data.fullName,
          email: data.email,
          gender: data.gender,
          businessType: data.businessType,
          businessName: data.businessName,
          state: data.state,
          city: data.city,
          businessAddress: data.businessAddress,
          addressProofUrl: data.addressProofUrl,
          latitude: data.latitude ? Number(data.latitude) : undefined,
          longitude: data.longitude ? Number(data.longitude) : undefined,
          serviceRadiusKm: data.serviceRadiusKm
            ? Number(data.serviceRadiusKm)
            : 50,
          onboardingStatus: "PENDING",
          rejectionReason: null,
          submittedAt: new Date(),
        },
        update: {
          fullName: data.fullName,
          ownerName: data.fullName,
          email: data.email,
          gender: data.gender,
          businessType: data.businessType,
          businessName: data.businessName,
          latitude: data.latitude ? Number(data.latitude) : undefined,
          longitude: data.longitude ? Number(data.longitude) : undefined,
          serviceRadiusKm: data.serviceRadiusKm
            ? Number(data.serviceRadiusKm)
            : 50,
          state: data.state,
          city: data.city,
          businessAddress: data.businessAddress,
          ...(data.addressProofUrl && {
            addressProofUrl: data.addressProofUrl,
          }),
          onboardingStatus: "PENDING",
          rejectionReason: null,
          submittedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "VENDOR_ONBOARDING_SUBMITTED",
          entityType: "VendorProfile",
          entityId: profile.id,
        },
      });

      return {
        status: profile.onboardingStatus,
        message:
          "Your onboarding request has been submitted successfully. Our admin team will review your details and activate your account shortly.",
        profileImage:
          data.profileImage || (vendor as any).user?.profileImage || null,
        profile,
      };
    });
  }

  async getOnboardingStatus(userId: string) {
    const vendor = await this.getProfile(userId);

    // State 1: Not registered yet
    if (vendor.onboardingStatus === "NOT_REGISTERED") {
      return {
        success: false,
        message: "Vendor not registered yet",
        canOnboarding: true,
      };
    }

    // State 2: Registered but not approved yet (Pending/Rejected)
    if (
      vendor.onboardingStatus === "PENDING" ||
      vendor.onboardingStatus === "REJECTED"
    ) {
      return {
        success: false,
        message:
          "Vendor onboarding is not approved yet. Please complete onboarding or wait for admin approval.",
        canOnboarding: false,
      };
    }

    // State 3: Approved
    return {
      success: true,
      message: "Vendor onboarding approved",
      canOnboarding: false,
    };
  }

  async getDashboard(userId: string) {
    const vendor = await this.ensureApprovedVendor(userId);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const processingStatuses = [
      "VENDOR_ACCEPTED",
      "PREPARING_ORDER",
      "READY_FOR_PICKUP",
      "DELIVERY_PARTNER_ASSIGNED",
      "PICKED_UP",
      "IN_TRANSIT",
      "OUT_FOR_DELIVERY",
    ];
    const revenueStatuses = ["DELIVERED", "COMPLETED"];

    const [
      assignedOrders,
      processingOrders,
      acceptedOrders,
      rejectedOrders,
      outOfStockOrders,
      recentAssignments,
      todayRevenue,
      totalRevenue,
    ] = await Promise.all([
      prisma.vendorAssignment.count({
        where: { vendorUserId: vendor.userId, status: "PENDING" },
      }),
      prisma.order.count({
        where: {
          vendorUserId: vendor.userId,
          status: { in: processingStatuses as any },
        },
      }),
      prisma.vendorAssignment.count({
        where: { vendorUserId: vendor.userId, status: "ACCEPTED" },
      }),
      prisma.vendorAssignment.count({
        where: {
          vendorUserId: vendor.userId,
          status: "REJECTED",
          rejectionReason: { not: "OUT_OF_STOCK" },
        },
      }),
      prisma.vendorAssignment.count({
        where: {
          vendorUserId: vendor.userId,
          status: "REJECTED",
          rejectionReason: "OUT_OF_STOCK",
        },
      }),
      prisma.order.findMany({
        where: {
          VendorAssignment: {
            some: {
              vendorUserId: vendor.userId,
              status: { not: "EXPIRED" },
            },
          },
        },
        include: {
          OrderItem: { include: { Product: true } },
          Payment: true,
          OrderTimeline: { orderBy: { createdAt: "asc" } },
          AuditLog: {
            where: {
              action: {
                in: [
                  "DELIVERY_ASSIGNMENT_PENDING",
                  "DELIVERY_REQUESTS_BROADCAST",
                ],
              },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          DeliveryAssignment: {
            include: {
              user: {
                include: {
                  DeliveryDetails: true,
                  KYCApplication: {
                    include: {
                      KYCDocument: {
                        where: {
                          documentType: { in: ["SELFIE", "LIVE_SELFIE"] },
                        },
                        orderBy: { createdAt: "desc" },
                      },
                    },
                  },
                },
              },
            },
          },
          DeliveryRequest: { orderBy: { createdAt: "desc" }, take: 1 },
          VendorAssignment: {
            where: { vendorUserId: vendor.userId },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.order.aggregate({
        where: {
          vendorUserId: vendor.userId,
          status: { in: revenueStatuses as any },
          updatedAt: { gte: start, lte: end },
        },
        _sum: { netAmount: true },
      }),
      prisma.order.aggregate({
        where: {
          vendorUserId: vendor.userId,
          status: { in: revenueStatuses as any },
        },
        _sum: { netAmount: true },
      }),
    ]);

    const todayRevenueAmount = Number(todayRevenue._sum.netAmount || 0);
    const totalRevenueAmount = Number(totalRevenue._sum.netAmount || 0);

    return {
      cards: {
        assignedOrders,
        processingOrders,
        todayRevenue: todayRevenueAmount,
        totalRevenue: totalRevenueAmount,
        acceptedOrders,
        rejectedOrders,
        outOfStockOrders,
      },
      overview: {
        assignedOrders,
        processingOrders,
        todayRevenue: todayRevenueAmount,
        totalRevenue: totalRevenueAmount,
      },
      recentAssignedOrders: recentAssignments.map((order: any) =>
        this.formatOrderCard(order),
      ),
    };
  }

  async getAssignedOrders(userId: string, query: any = {}) {
    const vendor = await this.ensureApprovedVendor(userId);
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
    const skip = (page - 1) * limit;
    const where: any = {};

    if (query.status) {
      let statusStr = String(query.status).toUpperCase();
      if (statusStr === "ACCEPT") statusStr = "ACCEPTED";
      if (statusStr === "REJECT") statusStr = "REJECTED";

      if (["PENDING", "ACCEPTED", "REJECTED"].includes(statusStr)) {
        where.VendorAssignment = {
          some: {
            vendorUserId: vendor.userId,
            status: statusStr as any,
          },
        };
      } else {
        where.vendorUserId = vendor.userId;
        where.status = statusStr;
      }
    } else {
      where.VendorAssignment = {
        some: {
          vendorUserId: vendor.userId,
          status: { not: "EXPIRED" },
        },
      };
    }

    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        include: {
          OrderItem: { include: { Product: true } },
          Payment: true,
          OrderTimeline: { orderBy: { createdAt: "asc" } },
          AuditLog: {
            where: {
              action: {
                in: [
                  "DELIVERY_ASSIGNMENT_PENDING",
                  "DELIVERY_REQUESTS_BROADCAST",
                ],
              },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          DeliveryAssignment: {
            include: {
              user: {
                include: {
                  DeliveryDetails: true,
                  KYCApplication: {
                    include: {
                      KYCDocument: {
                        where: {
                          documentType: { in: ["SELFIE", "LIVE_SELFIE"] },
                        },
                        orderBy: { createdAt: "desc" },
                      },
                    },
                  },
                },
              },
            },
          },
          DeliveryRequest: { orderBy: { createdAt: "desc" }, take: 1 },
          VendorAssignment: {
            where: { vendorUserId: vendor.userId },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    return {
      orders: orders.map((order: any) => this.formatOrderCard(order)),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getOrderDetails(userId: string, orderId: string) {
    const vendor = await this.ensureApprovedVendor(userId);
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        VendorAssignment: {
          some: { vendorUserId: vendor.userId, status: { not: "EXPIRED" } },
        },
      },
      include: {
        User_Order_vendorUserIdToUser: { include: { vendorKYCProfile: true } },
        OrderItem: { include: { Product: true } },
        Payment: true,
        OrderTimeline: { orderBy: { createdAt: "asc" } },
        AuditLog: {
          where: {
            action: {
              in: [
                "DELIVERY_ASSIGNMENT_PENDING",
                "DELIVERY_REQUESTS_BROADCAST",
              ],
            },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        DeliveryRequest: { orderBy: { createdAt: "desc" }, take: 1 },
        VendorAssignment: {
          where: { vendorUserId: vendor.userId },
          orderBy: { createdAt: "desc" },
        },
        DeliveryAssignment: {
          include: {
            user: {
              include: {
                DeliveryDetails: true,
                KYCApplication: {
                  include: {
                    KYCDocument: {
                      where: {
                        documentType: { in: ["SELFIE", "LIVE_SELFIE"] },
                      },
                      orderBy: { createdAt: "desc" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundError("Order not found");
    const delivery = (order as any).DeliveryAssignment;
    const deliveryPartner = this.formatDeliveryPartnerDetails(delivery);
    return this.formatOrderCard(order);
  }

  async markOutOfStock(userId: string, assignmentId: string, reason: string) {
    if (!reason) throw new BadRequestError("Out of stock reason is required");
    const vendor = await this.ensureApprovedVendor(userId);
    const assignment = await prisma.vendorAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment || assignment.vendorUserId !== vendor.userId)
      throw new NotFoundError("Assignment not found");
    if (assignment.status !== "PENDING")
      throw new BadRequestError(
        "Only pending assignments can be marked out of stock",
      );

    return prisma.$transaction(async (tx: any) => {
      const updated = await tx.vendorAssignment.update({
        where: { id: assignmentId },
        data: {
          status: "REJECTED",
          rejectedAt: new Date(),
          rejectionReason: "OUT_OF_STOCK",
          remarks: reason,
        },
      });

      await tx.vendorAssignmentHistory.create({
        data: {
          vendorAssignmentId: assignmentId,
          status: "REJECTED",
          remarks: reason,
          createdBy: vendor.userId,
        },
      });

      await tx.order.update({
        where: { id: assignment.orderId },
        data: { status: "WAITING_FOR_VENDOR", vendorUserId: null },
      });

      await tx.orderTimeline.create({
        data: {
          orderId: assignment.orderId,
          status: "WAITING_FOR_VENDOR",
          title: "Vendor marked out of stock",
          message: reason,
          metadata: { assignmentId },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: vendor.userId,
          action: "VENDOR_OUT_OF_STOCK",
          entityType: "VendorAssignment",
          entityId: assignmentId,
          orderId: assignment.orderId,
          metadata: { reason },
        },
      });

      return updated;
    });
  }

  async submitDeliveryPreparation(
    userId: string,
    orderId: string,
    data: DeliveryPreparationDto,
  ) {
    const vendor = await this.ensureApprovedVendor(userId);
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        VendorAssignment: {
          some: { vendorUserId: vendor.userId, status: { not: "EXPIRED" } },
        },
      },
      include: {
        User_Order_vendorUserIdToUser: { include: { vendorKYCProfile: true } },
        DeliveryAssignment: true,
        DeliveryRequest: { orderBy: { createdAt: "desc" }, take: 1 },
        OrderItem: {
          select: {
            id: true,
            productName: true,
            quantity: true,
            unit: true,
            vehicleTypeId: true,
            vehicleTypeName: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundError("Order not found");
    if ((order as any).DeliveryAssignment) {
      throw new BadRequestError(
        "Delivery partner has already accepted this order",
      );
    }
    if (
      (order as any).DeliveryRequest?.[0]?.status === "PENDING" &&
      (order as any).DeliveryRequest?.[0]?.expiresAt > new Date()
    ) {
      throw new BadRequestError(
        "Delivery partner request is already waiting for acceptance",
      );
    }
    if (
      !["VENDOR_ACCEPTED", "PREPARING_ORDER", "READY_FOR_PICKUP"].includes(
        order.status,
      )
    ) {
      throw new BadRequestError(
        "Delivery preparation can be submitted only after accepting the order",
      );
    }

    const orderItems: any[] = (order as any).OrderItem || [];
    const selectedItem = null;
    const selectedVehicle = null;

    // Geocode & Calculate distance
    let distanceKm = 0;
    let pickupCoords: { latitude: number; longitude: number } | null = null;
    let dropCoords: { latitude: number; longitude: number } | null = null;
    try {
      const dropAddr = order.shippingAddressSnapshot as any;
      const dropStr = dropAddr?.addressLine1
        ? `${dropAddr.addressLine1}, ${dropAddr.city}, ${dropAddr.pincode}`
        : "";

      const pickupStr =
        data.pickupLocation ||
        vendor.user?.vendorKYCProfile?.businessAddress ||
        "";

      pickupCoords =
        data.pickupLatitude != null && data.pickupLongitude != null
          ? { latitude: data.pickupLatitude, longitude: data.pickupLongitude }
          : vendor.user?.vendorKYCProfile?.latitude != null &&
              vendor.user?.vendorKYCProfile?.longitude != null
            ? {
                latitude: Number(vendor.user.vendorKYCProfile.latitude),
                longitude: Number(vendor.user.vendorKYCProfile.longitude),
              }
            : null;

      dropCoords =
        data.dropLatitude != null && data.dropLongitude != null
          ? { latitude: data.dropLatitude, longitude: data.dropLongitude }
          : (order.shippingAddressSnapshot as any)?.latitude != null &&
              (order.shippingAddressSnapshot as any)?.longitude != null
            ? {
                latitude: Number(
                  (order.shippingAddressSnapshot as any).latitude,
                ),
                longitude: Number(
                  (order.shippingAddressSnapshot as any).longitude,
                ),
              }
            : null;

      if (dropStr && pickupStr) {
        if (!pickupCoords) pickupCoords = await geocodeAddress(pickupStr);
        if (!dropCoords) dropCoords = await geocodeAddress(dropStr);

        if (pickupCoords && dropCoords) {
          distanceKm = await calculateDrivingDistance(
            pickupCoords.latitude,
            pickupCoords.longitude,
            dropCoords.latitude,
            dropCoords.longitude,
          );
        }
      }
    } catch (e) {
      console.error("[DeliveryPrep] Distance calc failed:", e);
    }

    // Calculate shipping amount (Base 50 + 15/km)
    const newShippingAmount = calculateShippingCharge(distanceKm);
    const oldShippingAmount = Number(order.shippingAmount);
    const updatedNetAmount =
      Number(order.netAmount) - oldShippingAmount + newShippingAmount;

    const metadataWithDistance = {
      ...data,
      selectedVehicle,
      distanceKm,
      pickupLatitude:
        data.pickupLatitude ?? pickupCoords?.latitude ?? undefined,
      pickupLongitude:
        data.pickupLongitude ?? pickupCoords?.longitude ?? undefined,
      dropLatitude: data.dropLatitude ?? dropCoords?.latitude ?? undefined,
      dropLongitude: data.dropLongitude ?? dropCoords?.longitude ?? undefined,
    };

    const result = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          status: "READY_FOR_PICKUP",
          shippingAmount: newShippingAmount,
          netAmount: updatedNetAmount,
        },
      });

      await tx.orderTimeline.create({
        data: {
          orderId,
          status: "READY_FOR_PICKUP",
          title: "Delivery request submitted",
          message: "Vendor submitted pickup and delivery preparation details",
          metadata: { details: metadataWithDistance },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: vendor.userId,
          action: "DELIVERY_REQUEST_SUBMITTED",
          entityType: "Order",
          entityId: orderId,
          orderId,
          metadata: { details: metadataWithDistance },
        },
      });

      return updated;
    });

    let deliveryAssignmentStatus: any = {
      status: "PENDING_ADMIN_ASSIGNMENT",
      reason: "BROADCAST_NOT_STARTED",
    };
    try {
      const dpService = new DeliveryPartnerService();
      deliveryAssignmentStatus =
        await dpService.broadcastDeliveryRequest(orderId);
    } catch (err) {
      console.error("Failed to init DeliveryPartnerService", err);
    }

    return {
      ...result,
      deliveryRequestStatus: {
        requestId: null,
        status:
          deliveryAssignmentStatus?.status === "REQUESTS_SENT"
            ? "WAITING"
            : "PENDING_ADMIN_ASSIGNMENT",
        requestedAt: new Date(),
        acceptedAt: null,
        canRequestDeliveryPartner: false,
        message:
          deliveryAssignmentStatus?.status === "REQUESTS_SENT"
            ? "Waiting for a nearby delivery partner to accept"
            : "Delivery assignment is pending admin action",
        assignment: deliveryAssignmentStatus,
        selectedVehicle,
      },
      selectedVehicle,
    };
  }

  async getWallet(userId: string) {
    await this.ensureApprovedVendor(userId);
    const wallet = await prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId, balance: 0, lockedBalance: 0 },
    });
    return {
      ...wallet,
      availableBalance: Number(wallet.balance) - Number(wallet.lockedBalance),
    };
  }

  async getEarnings(userId: string) {
    const wallet = await this.getWallet(userId);
    const earnings = await prisma.earning.findMany({
      where: { userId, orderId: { not: null } },
      orderBy: { createdAt: "desc" },
    });

    return {
      wallet,
      totalEarnings: earnings.reduce(
        (sum, earning) => sum + Number(earning.totalAmount),
        0,
      ),
      earnings,
    };
  }

  async requestWithdrawal(userId: string, amount: number) {
    if (!amount || amount <= 0)
      throw new BadRequestError("Withdrawal amount must be greater than zero");

    await this.ensureApprovedVendor(userId);

    return prisma.$transaction(async (tx: any) => {
      const walletRecords =
        await tx.$queryRaw`SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
      if (!walletRecords || walletRecords.length === 0) {
        throw new NotFoundError("Wallet not found");
      }
      const wallet = walletRecords[0];
      const availableBalance =
        Number(wallet.balance) - Number(wallet.lockedBalance);

      if (availableBalance < amount) {
        throw new BadRequestError("Insufficient wallet balance");
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { lockedBalance: { increment: amount } },
      });

      const settlement = await tx.settlement.create({
        data: {
          vendorUserId: userId,
          amount,
          status: "PENDING",
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "DEBIT",
          amount,
          description: "Vendor withdrawal request",
          referenceId: settlement.id,
          status: "PENDING",
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "VENDOR_WITHDRAWAL_REQUESTED",
          entityType: "Settlement",
          entityId: settlement.id,
          metadata: { amount },
        },
      });

      const adminUsers = await tx.user.findMany({
        where: { role: { name: { in: ["ADMIN", "SUPER_ADMIN"] } } },
        select: { id: true },
      });
      if (adminUsers.length) {
        const withdrawMessage = "A vendor has requested wallet withdrawal.";
        await tx.notification.createMany({
          data: adminUsers.map((admin: any) => ({
            userId: admin.id,
            type: "IN_APP",
            title: "Vendor withdrawal requested",
            message: withdrawMessage,
            data: { settlementId: settlement.id, vendorUserId: userId, amount },
          })),
        });

        adminUsers.forEach((admin: any) => {
          this.notificationService
            .sendPushNotification(admin.id, {
              title: "Vendor withdrawal requested",
              message: withdrawMessage,
              data: {
                settlementId: settlement.id,
                vendorUserId: userId,
                amount,
              },
            })
            .catch((err) => console.error("Push notification failed", err));
        });
      }

      return settlement;
    });
  }

  async getWithdrawals(userId: string) {
    await this.ensureApprovedVendor(userId);
    return prisma.settlement.findMany({
      where: { vendorUserId: userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getTransactions(userId: string) {
    await this.ensureApprovedVendor(userId);

    const [earnings, withdrawals] = await Promise.all([
      prisma.earning.findMany({
        where: { userId, orderId: { not: null } },
      }),
      prisma.settlement.findMany({
        where: { vendorUserId: userId },
      }),
    ]);

    const orderIds = earnings.map((e) => e.orderId).filter(Boolean) as string[];
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        orderNumber: true,
        OrderItem: {
          select: { Product: { select: { name: true } } },
        },
      },
    });
    const orderMap = Object.fromEntries(
      orders.map((o) => {
        const materialNames = o.OrderItem.map((item: any) => item.Product?.name)
          .filter(Boolean)
          .join(", ");
        return [o.id, { orderNumber: o.orderNumber, materialNames }];
      }),
    );

    const formattedEarnings = earnings.map((e: any) => ({
      ...e,
      transactionType: "EARNING",
      displayAmount: Number(e.totalAmount || 0),
      orderNumber:
        e.orderId && orderMap[e.orderId]
          ? orderMap[e.orderId].orderNumber
          : null,
      materialNames:
        e.orderId && orderMap[e.orderId]
          ? orderMap[e.orderId].materialNames
          : null,
    }));

    const formattedWithdrawals = withdrawals.map((w: any) => ({
      ...w,
      transactionType: "WITHDRAWAL",
      displayAmount: Number(w.amount || 0),
    }));

    const transactions = [...formattedEarnings, ...formattedWithdrawals].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return transactions;
  }

  async getAdminWithdrawals() {
    return prisma.settlement.findMany({
      where: { vendorUserId: { not: null } },
      include: {
        User_Settlement_vendorUserIdToUser: {
          select: {
            id: true,
            firstName: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateWithdrawalStatus(
    settlementId: string,
    status: any,
    adminId: string,
    referenceNo?: string,
  ) {
    const normalizedStatus = String(status || "").toUpperCase();
    const settlementStatus =
      normalizedStatus === "PAID" || normalizedStatus === "COMPLETED"
        ? "COMPLETED"
        : normalizedStatus === "REJECTED" || normalizedStatus === "FAILED"
          ? "FAILED"
          : normalizedStatus === "PROCESSING"
            ? "PROCESSING"
            : "PENDING";

    return prisma.$transaction(async (tx: any) => {
      const existing = await tx.settlement.findUnique({
        where: { id: settlementId },
      });
      if (!existing || !existing.vendorUserId)
        throw new NotFoundError("Vendor withdrawal request not found");
      if (existing.status === "COMPLETED")
        throw new BadRequestError("Withdrawal is already completed");

      const settlement = await tx.settlement.update({
        where: { id: settlementId },
        data: { status: settlementStatus, referenceNo },
      });

      const transactionStatus =
        settlementStatus === "COMPLETED"
          ? "PAID"
          : settlementStatus === "FAILED"
            ? "REJECTED"
            : "PROCESSING";

      await tx.walletTransaction.updateMany({
        where: { referenceId: settlement.id },
        data: { status: transactionStatus },
      });

      if (settlementStatus === "COMPLETED") {
        const walletRecords =
          await tx.$queryRaw`SELECT * FROM "Wallet" WHERE "userId" = ${settlement.vendorUserId} FOR UPDATE`;
        if (!walletRecords || walletRecords.length === 0) {
          throw new NotFoundError("Wallet not found");
        }
        const wallet = walletRecords[0];
        if (Number(wallet.lockedBalance) < Number(settlement.amount)) {
          throw new BadRequestError(
            "Insufficient locked vendor wallet balance",
          );
        }
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: { decrement: settlement.amount },
            lockedBalance: { decrement: settlement.amount },
          },
        });
      } else if (settlementStatus === "FAILED") {
        const walletRecords =
          await tx.$queryRaw`SELECT * FROM "Wallet" WHERE "userId" = ${settlement.vendorUserId} FOR UPDATE`;
        if (walletRecords && walletRecords.length > 0) {
          const wallet = walletRecords[0];
          if (Number(wallet.lockedBalance) >= Number(settlement.amount)) {
            await tx.wallet.update({
              where: { id: wallet.id },
              data: {
                lockedBalance: { decrement: settlement.amount },
              },
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: `VENDOR_WITHDRAWAL_${settlementStatus}`,
          entityType: "Settlement",
          entityId: settlement.id,
          metadata: { referenceNo, amount: settlement.amount },
        },
      });

      const pushTitle =
        settlementStatus === "COMPLETED"
          ? "Withdrawal released"
          : "Withdrawal updated";
      const pushMessage =
        settlementStatus === "COMPLETED"
          ? "Your vendor wallet withdrawal has been released."
          : `Your vendor wallet withdrawal status is ${settlementStatus}.`;
      const pushData = {
        settlementId: settlement.id,
        status: settlementStatus,
        referenceNo,
      };

      await tx.notification.create({
        data: {
          userId: settlement.vendorUserId,
          type: "IN_APP",
          title: pushTitle,
          message: pushMessage,
          data: pushData,
        },
      });

      this.notificationService
        .sendPushNotification(settlement.vendorUserId, {
          title: pushTitle,
          message: pushMessage,
          data: pushData,
        })
        .catch((err) => console.error("Push notification failed", err));

      return settlement;
    });
  }
}
