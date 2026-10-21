import { prisma } from "../../config/database";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { z } from "zod";
import { AccountStatus } from "@prisma/client";
import { NotificationService } from "../notification/notification.service";

export interface CreateVendorInput {
  businessName?: string;
  ownerName?: string;
  email?: string;
  phone?: string;
  businessType?: string;
  gstNumber?: string;
  panNumber?: string;
  businessAddress?: string;
  state?: string;
  city?: string;
  pincode?: string;
  monthlySupplyCapacity?: string;
  warehouseDetails?: string;
}

export interface UpdateVendorInput {
  businessName?: string;
  ownerName?: string;
  email?: string;
  phone?: string;
  businessType?: string;
  gstNumber?: string;
  panNumber?: string;
  businessAddress?: string;
  state?: string;
  city?: string;
  pincode?: string;
  monthlySupplyCapacity?: string;
  warehouseDetails?: string;
  status?: AccountStatus;
}

export class AdminVendorService {
  private notificationService = new NotificationService();

  async createVendor(data: CreateVendorInput) {
    // 1. Check duplicate email/phone only if provided
    if (data.email || data.phone) {
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            ...(data.email ? [{ email: data.email }] : []),
            ...(data.phone ? [{ phone: data.phone }] : []),
          ],
        },
      });

      if (existingUser) {
        if (data.email && existingUser.email === data.email) {
          throw new BadRequestError("Email already in use");
        }
        if (data.phone && existingUser.phone === data.phone) {
          throw new BadRequestError("Phone number already in use");
        }
      }
    }

    // 2. Fetch VENDOR role
    const role = await prisma.role.findFirst({ where: { name: "VENDOR" } });
    if (!role) {
      throw new BadRequestError("VENDOR role not found in system");
    }

    // 3. Create User & Profile Records in a transaction
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          ...(data.email && { email: data.email }),
          ...(data.phone && { phone: data.phone }),
          ...(data.ownerName && { firstName: data.ownerName }),
          role: { connect: { id: role.id } },
          status: "ACTIVE" as AccountStatus,
          isEmailVerified: true,
          isPhoneVerified: true,
          NotificationPreference: { create: {} },
        } as any,
      });

      const vendor = await tx.vendorDetails.create({
        data: {
          userId: user.id,
          ...(data.businessName && { companyName: data.businessName }),
          ...(data.gstNumber && { taxId: data.gstNumber }),
          ...(data.businessType && { businessType: data.businessType }),
        } as any,
      });

      const vendorProfile = await tx.vendorProfile.create({
        // @ts-ignore
        data: {
          userId: user.id,
          ...(data.businessName && { businessName: data.businessName }),
          ...(data.ownerName && { ownerName: data.ownerName }),
          ...(data.businessType && { businessType: data.businessType }),
          ...(data.businessAddress && {
            businessAddress: data.businessAddress,
          }),
          ...(data.state && { state: data.state }),
          ...(data.city && { city: data.city }),
          ...(data.pincode && { pincode: data.pincode }),
          ...(data.gstNumber && { gstNumber: data.gstNumber }),
          ...(data.panNumber && { panNumber: data.panNumber }),
          ...(data.monthlySupplyCapacity && {
            monthlySupplyCapacity: data.monthlySupplyCapacity,
          }),
          ...(data.warehouseDetails && {
            warehouseDetails: data.warehouseDetails,
          }),
        },
      });

      return {
        id: vendor.id,
        userId: user.id,
        email: user.email,
        phone: user.phone,
        status: user.status,
        companyName: vendor.companyName,
        profile: vendorProfile,
      };
    });
  }

  async getAllVendors(query: any) {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const skip = (page - 1) * limit;

    const filters: any = {};

    if (query.businessType) {
      filters.businessType = query.businessType;
    }

    // Filter by User's status
    if (query.status) {
      filters.user = { ...filters.user, status: query.status };
    }

    if (query.onboardingStatus === "APPROVED") {
      filters.user = {
        ...filters.user,
        OR: [
          { vendorKYCProfile: { onboardingStatus: "APPROVED" } },
          { vendorKYCProfile: null },
        ],
      };
    } else if (query.onboardingStatus) {
      filters.user = {
        ...filters.user,
        vendorKYCProfile: {
          ...filters.user?.vendorKYCProfile,
          onboardingStatus: query.onboardingStatus,
        },
      };
    }

    const orClauses: any[] = [];
    if (query.search) {
      const searchStr = String(query.search);
      orClauses.push(
        { companyName: { contains: searchStr, mode: "insensitive" } },
        { user: { email: { contains: searchStr, mode: "insensitive" } } },
        { user: { phone: { contains: searchStr, mode: "insensitive" } } },
      );
    }

    // State / City filters are stored in VendorProfile
    const profileFilters: any = {};
    if (query.state) {
      profileFilters.state = { equals: query.state, mode: "insensitive" };
    }
    if (query.city) {
      profileFilters.city = { equals: query.city, mode: "insensitive" };
    }

    if (query.search) {
      // search in ownerName of VendorProfile as well
      profileFilters.ownerName = {
        contains: String(query.search),
        mode: "insensitive",
      };
    }

    if (Object.keys(profileFilters).length > 0) {
      if (query.search) {
        // Search could match either VendorDetails fields or profile ownerName
        filters.OR = [
          ...orClauses,
          {
            user: {
              vendorKYCProfile: {
                ownerName: {
                  contains: String(query.search),
                  mode: "insensitive",
                },
              },
            },
          },
        ];
      } else {
        filters.user = {
          ...filters.user,
          vendorKYCProfile: {
            ...filters.user?.vendorKYCProfile,
            ...profileFilters,
          },
        };
      }
    } else if (orClauses.length > 0) {
      filters.OR = orClauses;
    }

    // Sort order
    let orderBy: any = { createdAt: "desc" };
    if (query.sortBy) {
      orderBy = { [query.sortBy]: query.sortOrder === "asc" ? "asc" : "desc" };
    }

    const [vendors, total] = await Promise.all([
      prisma.vendorDetails.findMany({
        where: filters,
        include: {
          // @ts-ignore
          user: {
            include: {
              vendorKYCProfile: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy,
      }),
      prisma.vendorDetails.count({ where: filters }),
    ]);

    return {
      vendors: vendors.map((v) => ({
        id: v.id,
        userId: v.userId,
        businessName: v.companyName,
        // @ts-ignore
        businessType: v.businessType,
        rating: v.rating,
        totalReviews: v.totalReviews,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
        // @ts-ignore
        status: v.user?.status,
        // @ts-ignore
        email: v.user?.email,
        // @ts-ignore
        phone: v.user?.phone,
        // @ts-ignore
        ownerName: v.user?.vendorKYCProfile?.ownerName,
        // @ts-ignore
        city: v.user?.vendorKYCProfile?.city,
        // @ts-ignore
        state: v.user?.vendorKYCProfile?.state,
        // @ts-ignore
        pincode: v.user?.vendorKYCProfile?.pincode,
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getVendorById(vendorUserId: string) {
    const vendor = await prisma.vendorDetails.findFirst({
      where: { id: vendorUserId },
      include: {
        // @ts-ignore
        user: {
          include: {
            vendorKYCProfile: true,
            Order_Order_vendorUserIdToUser: { orderBy: { createdAt: "desc" } },
            Payment: { orderBy: { createdAt: "desc" } },
            Ticket_Vendor: { orderBy: { createdAt: "desc" } },
            reviews: { orderBy: { createdAt: "desc" } },
          },
        },
      },
    });

    if (!vendor) {
      throw new NotFoundError("VendorDetails not found");
    }

    return {
      id: vendor.id,
      userId: vendor.userId,
      businessName: vendor.companyName,
      // @ts-ignore
      businessType: vendor.businessType,
      rating: vendor.rating,
      totalReviews: vendor.totalReviews,
      createdAt: vendor.createdAt,
      updatedAt: vendor.updatedAt,
      // @ts-ignore
      status: vendor.user?.status,
      // @ts-ignore
      email: vendor.user?.email,
      // @ts-ignore
      phone: vendor.user?.phone,
      // @ts-ignore
      profile: vendor.user?.vendorKYCProfile,
      orders: vendor.user?.Order_Order_vendorUserIdToUser || [],
      payments: vendor.user?.Payment || [],
      complaints: vendor.user?.Ticket_Vendor || [],
      reviews: vendor.user?.reviews || [],
    };
  }

  async updateVendor(vendorUserId: string, data: UpdateVendorInput) {
    const vendor = await prisma.vendorDetails.findFirst({
      where: { id: vendorUserId },
    });

    if (!vendor) {
      throw new NotFoundError("VendorDetails not found");
    }

    // Check duplicate email / phone if being updated
    if (data.email || data.phone) {
      const duplicateUser = await prisma.user.findFirst({
        where: {
          id: { not: vendor.userId },
          OR: [
            ...(data.email ? [{ email: data.email }] : []),
            ...(data.phone ? [{ phone: data.phone }] : []),
          ],
        },
      });

      if (duplicateUser) {
        if (duplicateUser.email === data.email) {
          throw new BadRequestError("Email already in use");
        }
        if (duplicateUser.phone === data.phone) {
          throw new BadRequestError("Phone number already in use");
        }
      }
    }

    return prisma.$transaction(async (tx) => {
      // Update User
      await tx.user.update({
        where: { id: vendor.userId },
        data: {
          ...(data.email && { email: data.email }),
          ...(data.phone && { phone: data.phone }),
          ...(data.ownerName && { firstName: data.ownerName }),
          ...(data.status && { status: data.status }),
        },
      });

      // Update VendorDetails
      await tx.vendorDetails.update({
        where: { id: vendorUserId },
        data: {
          ...(data.businessName && { companyName: data.businessName }),
          ...(data.gstNumber && { taxId: data.gstNumber }),
          ...(data.businessType && { businessType: data.businessType }),
        },
      });

      // Update VendorDetails Profile
      const profileUpdates: any = {};
      if (data.businessName) profileUpdates.businessName = data.businessName;
      if (data.ownerName) profileUpdates.ownerName = data.ownerName;
      if (data.businessType) profileUpdates.businessType = data.businessType;
      if (data.businessAddress)
        profileUpdates.businessAddress = data.businessAddress;
      if (data.state) profileUpdates.state = data.state;
      if (data.city) profileUpdates.city = data.city;
      if (data.pincode) profileUpdates.pincode = data.pincode;
      if (data.gstNumber) profileUpdates.gstNumber = data.gstNumber;
      if (data.panNumber) profileUpdates.panNumber = data.panNumber;
      if (data.monthlySupplyCapacity)
        profileUpdates.monthlySupplyCapacity = data.monthlySupplyCapacity;
      if (data.warehouseDetails)
        profileUpdates.warehouseDetails = data.warehouseDetails;

      if (Object.keys(profileUpdates).length > 0) {
        await tx.vendorProfile.upsert({
          where: { userId: vendor.userId },
          create: {
            userId: vendor.userId,
            ...profileUpdates,
          },
          update: profileUpdates,
        });
      }

      return this.getVendorById(vendorUserId);
    });
  }

  async deleteVendor(vendorUserId: string) {
    const vendor = await prisma.vendorDetails.findFirst({
      where: { id: vendorUserId },
    });

    if (!vendor) {
      throw new NotFoundError("VendorDetails not found");
    }

    return prisma.$transaction(async (tx) => {
      // Soft delete vendor
      await tx.vendorDetails.update({
        where: { id: vendorUserId },
        // @ts-ignore
        data: { deletedAt: new Date() },
      });

      // Deactivate associated user
      await tx.user.update({
        where: { id: vendor.userId },
        // @ts-ignore
        data: { status: "INACTIVE", deletedAt: new Date() },
      });

      return { success: true };
    });
  }

  // --- Document Methods ---

  async addDocument(
    vendorUserId: string,
    documentType: string,
    documentUrl: string,
  ) {
    const vendor = await prisma.vendorDetails.findFirst({
      where: { id: vendorUserId },
    });

    if (!vendor) {
      throw new NotFoundError("VendorDetails not found");
    }

    const allowedTypes = [
      "GST_CERTIFICATE",
      "PAN_CARD",
      "BANK_PROOF",
      "ADDRESS_PROOF",
    ];
    if (!allowedTypes.includes(documentType)) {
      throw new BadRequestError(
        "Invalid document type. Allowed types: GST_CERTIFICATE, PAN_CARD, BANK_PROOF, ADDRESS_PROOF",
      );
    }

    return prisma.vendorDocument.create({
      // @ts-ignore
      data: {
        vendorUserId,
        documentType,
        documentUrl,
      },
    });
  }

  async getDocuments(vendorUserId: string) {
    const vendor = await prisma.vendorDetails.findFirst({
      where: { id: vendorUserId },
    });

    if (!vendor) {
      throw new NotFoundError("VendorDetails not found");
    }

    return prisma.vendorDocument.findMany({
      where: { vendorUserId },
      orderBy: { createdAt: "desc" },
    });
  }

  async deleteDocument(vendorUserId: string, documentId: string) {
    const doc = await prisma.vendorDocument.findFirst({
      where: { id: documentId, vendorUserId },
    });

    if (!doc) {
      throw new NotFoundError("Document not found for this vendor");
    }

    await prisma.vendorDocument.delete({
      where: { id: documentId },
    });

    return { success: true };
  }

  async getOnboardingRequests(query: any = {}) {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(Math.max(1, parseInt(query.limit) || 10), 100);
    const skip = (page - 1) * limit;
    const where: any = {};

    if (query.status)
      where.onboardingStatus = String(query.status).toUpperCase();
    if (query.search) {
      where.OR = [
        { fullName: { contains: String(query.search), mode: "insensitive" } },
        { email: { contains: String(query.search), mode: "insensitive" } },
        {
          businessName: { contains: String(query.search), mode: "insensitive" },
        },
        {
          businessType: { contains: String(query.search), mode: "insensitive" },
        },
      ];
    }

    const [requests, total] = await prisma.$transaction([
      prisma.vendorProfile.findMany({
        where,
        include: { user: { include: { VendorDetails: true } } },
        orderBy: { submittedAt: "desc" } as any,
        skip,
        take: limit,
      }),
      prisma.vendorProfile.count({ where }),
    ]);

    return {
      requests,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getOnboardingRequest(userId: string) {
    const request = await prisma.vendorProfile.findUnique({
      where: { userId },
      include: {
        user: {
          include: {
            VendorDetails: true,
            VendorDocument: true,
          },
        },
      },
    });
    if (!request)
      throw new NotFoundError("Vendor onboarding request not found");
    return request;
  }

  async updateOnboardingRequest(userId: string, data: any) {
    const request = await prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!request)
      throw new NotFoundError("Vendor onboarding request not found");

    return prisma.$transaction(async (tx: any) => {
      if (data.email || data.fullName) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(data.email && { email: data.email }),
            ...(data.fullName && { firstName: data.fullName }),
          },
        });
      }

      if (data.businessName || data.businessType) {
        await tx.vendorDetails.update({
          where: { userId },
          data: {
            ...(data.businessName && { companyName: data.businessName }),
            ...(data.businessType && { businessType: data.businessType }),
          },
        });
      }

      const updated = await tx.vendorProfile.update({
        where: { userId },
        data: {
          ...(data.fullName && {
            fullName: data.fullName,
            ownerName: data.fullName,
          }),
          ...(data.email && { email: data.email }),
          ...(data.gender && { gender: data.gender }),
          ...(data.businessType && { businessType: data.businessType }),
          ...(data.businessName && { businessName: data.businessName }),
          ...(data.state && { state: data.state }),
          ...(data.city && { city: data.city }),
          ...(data.businessAddress && {
            businessAddress: data.businessAddress,
          }),
          ...(data.addressProofUrl && {
            addressProofUrl: data.addressProofUrl,
          }),
        },
      });

      await tx.auditLog.create({
        data: {
          action: "VENDOR_ONBOARDING_ADMIN_EDITED",
          entityType: "VendorProfile",
          entityId: updated.id,
          metadata: data,
        },
      });

      return updated;
    });
  }

  async approveOnboardingRequest(userId: string, adminUserId: string) {
    const request = await prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!request)
      throw new NotFoundError("Vendor onboarding request not found");
    if ((request as any).onboardingStatus === "APPROVED")
      throw new BadRequestError("Vendor onboarding is already approved");

    return prisma.$transaction(async (tx: any) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: "ACTIVE", isEmailVerified: true },
      });

      const profile = await tx.vendorProfile.update({
        where: { userId },
        data: {
          onboardingStatus: "APPROVED",
          rejectionReason: null,
          reviewedAt: new Date(),
          reviewedBy: adminUserId,
        },
      });

      await tx.vendorDetails.update({
        where: { userId },
        data: {
          companyName: profile.businessName,
          businessType: profile.businessType,
        },
      });

      const pushTitle = "Vendor onboarding approved";
      const pushMessage =
        "Your vendor onboarding has been approved. Dashboard access is now enabled.";

      await tx.notification.create({
        data: {
          userId,
          title: pushTitle,
          message: pushMessage,
          type: "IN_APP",
        },
      });

      this.notificationService
        .sendPushNotification(userId, {
          title: pushTitle,
          message: pushMessage,
        })
        .catch((err) => console.error("Push notification failed", err));

      await tx.auditLog.create({
        data: {
          actorId: adminUserId,
          action: "VENDOR_ONBOARDING_APPROVED",
          entityType: "VendorProfile",
          entityId: profile.id,
        },
      });

      return profile;
    });
  }

  async rejectOnboardingRequest(
    userId: string,
    adminUserId: string,
    reason: string,
  ) {
    if (!reason) throw new BadRequestError("Rejection reason is required");
    const request = await prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!request)
      throw new NotFoundError("Vendor onboarding request not found");

    return prisma.$transaction(async (tx: any) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: "PENDING" },
      });

      const profile = await tx.vendorProfile.update({
        where: { userId },
        data: {
          onboardingStatus: "REJECTED",
          rejectionReason: reason,
          reviewedAt: new Date(),
          reviewedBy: adminUserId,
        },
      });

      const pushTitle = "Vendor onboarding rejected";
      const pushMessage = reason;

      await tx.notification.create({
        data: {
          userId,
          title: pushTitle,
          message: pushMessage,
          type: "IN_APP",
        },
      });

      this.notificationService
        .sendPushNotification(userId, {
          title: pushTitle,
          message: pushMessage,
        })
        .catch((err) => console.error("Push notification failed", err));

      await tx.auditLog.create({
        data: {
          actorId: adminUserId,
          action: "VENDOR_ONBOARDING_REJECTED",
          entityType: "VendorProfile",
          entityId: profile.id,
          metadata: { reason },
        },
      });

      return profile;
    });
  }
}

// --- Validation Schemas ---
export const createVendorSchema = z.object({
  body: z.object({
    businessName: z.string().min(1).optional(),
    ownerName: z.string().min(1).optional(),
    email: z.string().email("Invalid email address").optional(),
    phone: z
      .string()
      .min(10, "Phone number must be at least 10 digits")
      .optional(),
    businessType: z.string().min(1).optional(),
    gstNumber: z.string().min(1).optional(),
    panNumber: z.string().min(1).optional(),
    businessAddress: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    pincode: z.string().min(1).optional(),
    monthlySupplyCapacity: z.string().min(1).optional(),
    warehouseDetails: z.string().min(1).optional(),
  }),
});

export const updateVendorSchema = z.object({
  params: z.object({
    vendorUserId: z.string().uuid(),
  }),
  body: z.object({
    businessName: z.string().optional(),
    ownerName: z.string().optional(),
    email: z.string().email("Invalid email address").optional(),
    phone: z
      .string()
      .min(10, "Phone number must be at least 10 digits")
      .optional(),
    businessType: z.string().optional(),
    gstNumber: z.string().optional(),
    panNumber: z.string().optional(),
    businessAddress: z.string().optional(),
    state: z.string().optional(),
    city: z.string().optional(),
    pincode: z.string().optional(),
    monthlySupplyCapacity: z.string().optional(),
    warehouseDetails: z.string().optional(),
    status: z.nativeEnum(AccountStatus).optional(),
  }),
});

export const addDocumentSchema = z.object({
  params: z.object({
    vendorUserId: z.string().uuid(),
  }),
  body: z.object({
    documentType: z.enum([
      "GST_CERTIFICATE",
      "PAN_CARD",
      "BANK_PROOF",
      "ADDRESS_PROOF",
    ]),
  }),
});
