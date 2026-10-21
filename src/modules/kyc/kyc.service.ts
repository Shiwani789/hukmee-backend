import { z } from "zod";
import { prisma } from "../../config/database";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { env } from "../../config/env";
import { NotificationService } from "../notification/notification.service";
import { geocodeAddress } from "../../utils/location.util";

const formatDoc = (doc: any) => doc?.documentUrl || null;
const sectionTypes = [
  "PERSONAL_INFO",
  "BANK_INFO",
  "SKILLS_EXPERIENCE",
  "IDENTITY_DOCUMENTS",
  "LIVE_SELFIE",
  "VEHICLE_DOCUMENTS",
  "AVAILABILITY",
];

export interface CreateWorkerKYCDto {
  fullName: string;
  fatherName: string;
  dateOfBirth: string;
  gender: string;
  language?: string;
  phone: string;
  email: string;
  address: string;
  state: string;
  city: string;
  pincode: string;
  skillId?: string;
  skillCategory: string;
  experienceYears: number;
  description?: string;
}

export interface CreateVendorKYCDto {
  businessName: string;
  ownerName: string;
  businessType: string;
  businessAddress: string;
  state: string;
  city: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
  monthlySupplyCapacity?: string;
  warehouseDetails?: string;
}

export interface UpdateDeliveryPartnerBasicDetailsDto {
  fullName: string;
  mobileNumber?: string;
  email?: string;
  dateOfBirth?: string;
  gender?: string;
  language?: string;
  currentAddress?: string;
  permanentAddress?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  about?: string;
  profilePhotoUrl?: string;
}

export interface UpdateDeliveryPartnerBankDetailsDto {
  accountHolderName?: string;
  accountNumber?: string;
  confirmAccountNumber?: string;
  ifscCode?: string;
  bankName?: string;
  branchName?: string;
  bankPassbookUrl?: string;
}

export interface UpdateDeliveryPartnerVehicleDocumentsDto {
  vehicleType?: string;
  maxLoadKg?: number;
  vehicleNumber?: string;
  brand?: string;
  vehicleBrand?: string;
  model?: string;
  vehicleModel?: string;
  rcNumber?: string;
  vehiclePhotoUrl?: string;
  rcUrl?: string;
  insuranceUrl?: string;
  pollutionCertificateUrl?: string;
  fitnessCertificateUrl?: string;
}

export interface UploadDocumentDto {
  documentType: string;
  documentUrl: string;
  documentNumber?: string;
}

export interface UpdateDeliveryPartnerIdentityDocumentsDto {
  aadhaarNumber?: string;
  panNumber?: string;
  drivingLicenseNo?: string;
  aadhaarFrontUrl?: string;
  aadhaarBackUrl?: string;
  panImageUrl?: string;
  drivingLicenseFrontUrl?: string;
  drivingLicenseBackUrl?: string;
}

export interface AdminDocumentDecisionDto {
  rejectionReason?: string;
}

export interface AdminKYCDecisionDto {
  reason?: string;
}

export class KYCService {
  private notificationService = new NotificationService();

  private vendorRequiredDocuments = [
    "GST_CERTIFICATE",
    "PAN_CARD",
    "BANK_PROOF",
    "ADDRESS_PROOF",
  ];
  private workerRequiredDocuments = [
    "AADHAAR_CARD",
    "PAN_CARD",
    "ADDRESS_PROOF",
    "LIVE_SELFIE",
  ];
  private deliveryPartnerRequiredDocuments = [
    "AADHAAR_FRONT",
    "AADHAAR_BACK",
    "PAN_CARD",
    "DRIVING_LICENSE_FRONT",
    "DRIVING_LICENSE_BACK",
    "BANK_PASSBOOK",
    "SELFIE",
    "VEHICLE_PHOTO",
    "RC",
    "INSURANCE",
    "POLLUTION_CERTIFICATE",
  ];

  private async ensureEditableKYC(
    userId: string,
    type: "WORKER" | "VENDOR" | "DELIVERY_PARTNER",
  ) {
    const kyc = await prisma.kYCApplication.upsert({
      where: { userId },
      update: {},
      // @ts-ignore
      create: { userId, type, status: "PENDING" },
    });

    if (kyc.status === "APPROVED" || kyc.status === "UNDER_REVIEW") {
      throw new BadRequestError(
        `KYC cannot be edited while status is ${kyc.status}`,
      );
    }

    return kyc;
  }

  async ensureSectionEditable(userId: string, sectionType: string) {
    const kyc = await prisma.kYCApplication.findUnique({
      where: { userId },
      // @ts-ignore
      include: { KYCSectionVerification: true, KYCDocument: true },
    });
    if (!kyc) return;
    (kyc as any).documents = (kyc as any).KYCDocument;

    const normalized = sectionType.replace(/-/g, "_").toUpperCase();

    // Check section verifications
    // @ts-ignore
    const verif = (kyc as any).KYCSectionVerification.find(
      (v: any) => v.sectionType === normalized,
    );
    if (verif) {
      if (verif.status === "APPROVED") {
        throw new BadRequestError(
          `This section has already been verified and approved.`,
        );
      }
      // Commented out for testing/flexibility:
      // if (verif.status === 'PENDING') {
      //   throw new BadRequestError(`Your documents for this section are under review. You cannot edit them.`);
      // }
      if (verif.status === "REJECTED") {
        return; // Rejected section is editable!
      }
    }

    // Determine document types for this section
    let docTypes: string[] = [];
    if (normalized === "PERSONAL_INFO") {
      docTypes = ["ADDRESS_PROOF"];
    } else if (normalized === "BANK_INFO") {
      docTypes = ["BANK_PASSBOOK"];
    } else if (normalized === "SKILLS_EXPERIENCE") {
      docTypes = [
        "EXPERIENCE_CERTIFICATE",
        "ITI_CERTIFICATE",
        "NSDC_CERTIFICATE",
        "GOVT_CERTIFICATE",
        "OTHER_CERTIFICATE",
      ];
    } else if (normalized === "IDENTITY_DOCUMENTS") {
      docTypes = [
        "IDENTITY_FRONT",
        "IDENTITY_BACK",
        "PAN_CARD",
        "POLICE_CERTIFICATE",
        "AADHAAR_FRONT",
        "AADHAAR_BACK",
        "DRIVING_LICENSE_FRONT",
        "DRIVING_LICENSE_BACK",
      ];
    } else if (normalized === "LIVE_SELFIE") {
      docTypes = ["LIVE_SELFIE"];
    }

    if (docTypes.length > 0) {
      // @ts-ignore
      const sectionDocs = kyc.documents.filter((d) =>
        docTypes.includes(d.documentType),
      );
      const anyRejected = sectionDocs.some((d: any) => d.status === "REJECTED");
      if (anyRejected) {
        return;
      }

      // @ts-ignore
      const anyApproved = sectionDocs.some((d) => d.status === "APPROVED");
      if (anyApproved && verif?.status !== "REJECTED") {
        throw new BadRequestError(
          `This section has already been verified and approved.`,
        );
      }

      // Commented out for testing/flexibility:
      // // @ts-ignore
      //   const anyPending = sectionDocs.some(d => d.status === 'PENDING');
      //   if (anyPending) {
      //     throw new BadRequestError(`Your documents for this section are under review. You cannot edit them.`);
      //   }
    }

    if (kyc.status === "APPROVED") {
      throw new BadRequestError(
        `This section cannot be edited because your KYC has already been approved.`,
      );
    }
    // Commented out for testing/flexibility:
    // if (kyc.status === 'UNDER_REVIEW') {
    //   throw new BadRequestError(`This section cannot be edited because your KYC is currently under review.`);
    // }
  }

  private async resetSectionVerification(kycId: string, sectionType: string) {
    const normalized = sectionType.replace(/-/g, "_").toUpperCase();
    const validEnums = sectionTypes;
    if (validEnums.includes(normalized)) {
      await prisma.kYCSectionVerification.upsert({
        where: { kycId_sectionType: { kycId, sectionType: normalized as any } },
        update: {
          status: "PENDING",
          remark: null,
          verifiedBy: null,
          verifiedAt: null,
        },
        // @ts-ignore
        create: {
          kycId,
          sectionType: normalized as any,
          status: "PENDING",
          remark: null,
        },
      });
    }
  }

  private async touchEditableKYC(
    userId: string,
    type: "WORKER" | "VENDOR" | "DELIVERY_PARTNER",
  ) {
    const kyc = await prisma.kYCApplication.upsert({
      where: { userId },
      update: {
        status: "PENDING",
        submittedAt: null,
        verifiedBy: null,
        rejectionReason: null,
        rejectedAt: null,
      },
      // @ts-ignore
      create: { userId, type, status: "PENDING" },
    });

    if (kyc.status === "APPROVED" || kyc.status === "UNDER_REVIEW") {
      throw new BadRequestError(
        `KYC cannot be edited while status is ${kyc.status}`,
      );
    }

    return kyc;
  }

  private async resolveWorkerSkill(data: {
    skillId?: string;
    skillCategory?: string;
  }) {
    if (data.skillId) {
      const skill = await prisma.skill.findUnique({
        where: { id: data.skillId },
      });
      if (!skill) throw new NotFoundError("Selected skill not found");
      return skill;
    }

    if (data.skillCategory) {
      const skill = await prisma.skill.findUnique({
        where: { name: data.skillCategory },
      });
      if (!skill) throw new NotFoundError("Selected skill not found");
      return skill;
    }

    throw new BadRequestError("Skill selection is required");
  }

  private normalizeSkillServiceIds(value: any): string[] {
    if (value === undefined || value === null || value === "") return [];
    if (Array.isArray(value)) {
      return [
        ...new Set(value.map((item) => String(item).trim()).filter(Boolean)),
      ];
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return [
            ...new Set(
              parsed.map((item) => String(item).trim()).filter(Boolean),
            ),
          ];
        }
      } catch (error) {
        // Accept comma-separated multipart values too.
      }
      return [
        ...new Set(
          trimmed
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ];
    }
    return [];
  }

  private async syncWorkerSkillServices(
    tx: any,
    userId: string,
    skillId: string,
    skillServiceIds: string[],
  ) {
    await tx.workerSkill.upsert({
      where: {
        workerUserId_skillId: {
          workerUserId: userId,
          skillId,
        },
      },
      update: {},
      create: {
        workerUserId: userId,
        skillId,
      },
    });

    if (skillServiceIds.length === 0) return;

    const skillServices = await tx.skillService.findMany({
      where: {
        id: { in: skillServiceIds },
        skillId,
        isActive: true,
      },
      select: { id: true },
    });

    if (skillServices.length !== skillServiceIds.length) {
      throw new BadRequestError(
        "One or more selected services are invalid, inactive, or do not belong to the selected skill",
      );
    }

    await tx.workerSkillService.updateMany({
      where: {
        workerUserId: userId,
        skillService: { skillId },
        skillServiceId: { notIn: skillServiceIds },
        isActive: true,
      },
      data: { isActive: false },
    });

    for (const skillService of skillServices) {
      await tx.workerSkillService.upsert({
        where: {
          workerUserId_skillServiceId: {
            workerUserId: userId,
            skillServiceId: skillService.id,
          },
        },
        update: { isActive: true },
        create: {
          workerUserId: userId,
          skillServiceId: skillService.id,
          isActive: true,
        },
      });
    }
  }

  private normalizeFiles(files: any) {
    const result: Record<string, string> = {};
    if (!files) return result;
    Object.entries(files).forEach(([key, value]: [string, any]) => {
      const file = Array.isArray(value) ? value[0] : value;
      if (file?.filename) {
        result[key] = `${env.BASE_URL}/uploads/kyc/${file.filename}`;
      } else if (file?.path) {
        // fallback: extract just the filename from absolute path
        const filename = file.path.split("/").pop();
        result[key] = `${env.BASE_URL}/uploads/kyc/${filename}`;
      }
    });
    return result;
  }

  private validateVendorProfile(profile: any) {
    const missing: string[] = [];
    [
      "businessName",
      "ownerName",
      "businessType",
      "businessAddress",
      "state",
      "city",
      "pincode",
    ].forEach((field) => {
      if (!profile?.[field]) missing.push(field);
    });

    ["bankAccountName", "bankAccountNumber", "bankIfscCode"].forEach(
      (field) => {
        if (!profile?.[field]) missing.push(field);
      },
    );

    return missing;
  }

  private validateWorkerProfile(profile: any) {
    const missing: string[] = [];

    [
      "fullName",
      "dateOfBirth",
      "gender",
      "language",
      "state",
      "city",
      "pincode",
    ].forEach((field) => {
      if (!profile?.[field]) missing.push(field);
    });

    if (!profile?.addressLine1 && !profile?.address) {
      missing.push("address");
    }

    ["bankAccountName", "bankAccountNumber", "bankIfscCode"].forEach(
      (field) => {
        if (!profile?.[field]) missing.push(field);
      },
    );

    [
      "skillCategory",
      "experienceYears",
      "dailyWageExpectation",
      "availabilityMode",
      "workingRadiusKm",
    ].forEach((field) => {
      if (
        profile?.[field] === null ||
        profile?.[field] === undefined ||
        profile?.[field] === ""
      )
        missing.push(field);
    });

    return missing;
  }

  private async validateDeliveryPartnerProfile(userId: string, kyc: any) {
    const missing: string[] = [];
    const profile = await prisma.deliveryDetails.findUnique({
      where: { userId },
    });

    ["fullName", "mobileNumber", "gender"].forEach((field) => {
      if (!profile?.[field as keyof typeof profile]) missing.push(field);
    });

    if (!profile?.vehicleType || profile.vehicleType === "NOT_PROVIDED")
      missing.push("vehicleType");
    if (!profile?.vehicleNumber || profile.vehicleNumber.startsWith("PENDING-"))
      missing.push("vehicleNumber");

    ["accountHolderName", "accountNumber", "ifscCode"].forEach((field) => {
      if (!kyc?.[field]) missing.push(field);
    });

    return missing;
  }

  private getMissingVendorDocuments(documents: any[]) {
    const approvedOrPendingTypes = new Set(
      documents
        .filter((doc) => doc.status !== "REJECTED")
        .map((doc) => doc.documentType),
    );
    return this.vendorRequiredDocuments.filter(
      (documentType) => !approvedOrPendingTypes.has(documentType),
    );
  }

  private getMissingWorkerDocuments(documents: any[]) {
    const activeTypes = new Set(
      documents
        .filter((doc) => doc.status !== "REJECTED")
        .map((doc) => doc.documentType),
    );

    // IDENTITY_FRONT and AADHAAR_CARD are treated as equivalent for identity document check
    if (activeTypes.has("IDENTITY_FRONT")) {
      activeTypes.add("AADHAAR_CARD");
    }

    return this.workerRequiredDocuments.filter(
      (documentType) => !activeTypes.has(documentType),
    );
  }

  private getMissingDeliveryPartnerDocuments(documents: any[]) {
    const activeTypes = new Set(
      documents
        .filter((doc) => doc.status !== "REJECTED")
        .map((doc) => doc.documentType),
    );

    if (activeTypes.has("DRIVING_LICENSE")) {
      activeTypes.add("DRIVING_LICENSE_FRONT");
      activeTypes.add("DRIVING_LICENSE_BACK");
    }

    return this.deliveryPartnerRequiredDocuments.filter(
      (documentType) => !activeTypes.has(documentType),
    );
  }

  private async activateWorkerDashboard(tx: any, userId: string) {
    const profile = await tx.workerProfile.findUnique({ where: { userId } });
    if (!profile)
      throw new BadRequestError("WorkerDetails profile is incomplete");

    const skill = await tx.skill.findUnique({
      where: { name: profile.skillCategory || "Others" },
    });
    if (!skill)
      throw new BadRequestError("Selected worker skill is no longer available");

    const existingWorker = await tx.workerDetails.findUnique({
      where: { userId },
    });
    const workerData = {
      experienceYrs: profile.experienceYears || 0,
      hourlyRate: profile.dailyWageExpectation || 0,
      isAvailable: true,
      radiusKm: profile.workingRadiusKm || 10,
      location:
        [profile.city, profile.state].filter(Boolean).join(", ") || null,
    };

    if (existingWorker) {
      const worker = await tx.workerDetails.update({
        where: { userId },
        data: workerData,
      });

      await tx.workerSkill.upsert({
        where: {
          workerId_skillId: { workerUserId: worker.id, skillId: skill.id },
        },
        update: {},
        create: { workerUserId: worker.id, skillId: skill.id },
      });

      return worker;
    }

    return tx.workerDetails.create({
      data: {
        userId,
        ...workerData,
        skills: {
          create: [{ skillId: skill.id }],
        },
      },
    });
  }

  async createWorkerKYC(userId: string, data: CreateWorkerKYCDto) {
    const skill = await this.resolveWorkerSkill(data);

    const { skillId, ...profileData } = data;
    const workerProfile = await prisma.workerProfile.upsert({
      where: { userId },
      update: { ...profileData, skillCategory: skill.name },
      // @ts-ignore
      create: { userId, ...profileData, skillCategory: skill.name },
    });

    const kycApplication = await prisma.kYCApplication.upsert({
      where: { userId },
      update: {
        type: "WORKER",
        status: "PENDING",
        submittedAt: null,
        verifiedBy: null,
        rejectionReason: null,
        rejectedAt: null,
      },
      // @ts-ignore
      create: { userId, type: "WORKER", status: "PENDING" },
      include: {
        // @ts-ignore
        user: {
          select: {
            id: true,
            firstName: true,

            email: true,
            phone: true,
          },
        },
        KYCDocument: true,
      },
    });

    return {
      ...kycApplication,
      workerProfile,
    };
  }

  async createVendorKYC(userId: string, data: CreateVendorKYCDto) {
    const existing = await prisma.kYCApplication.findUnique({
      where: { userId },
    });
    if (existing) throw new BadRequestError("KYC Application already exists");

    const vendorProfile = await prisma.vendorProfile.create({
      // @ts-ignore
      data: { userId, ...data },
    });

    const kycApplication = await prisma.kYCApplication.create({
      // @ts-ignore
      data: { userId, type: "VENDOR", status: "PENDING" },
      include: {
        // @ts-ignore
        user: {
          select: {
            id: true,
            firstName: true,

            email: true,
            phone: true,
          },
        },
        KYCDocument: true,
      },
    });

    return {
      ...kycApplication,
      vendorProfile,
    };
  }

  async resolveUserId(workerIdOrKycId: string): Promise<string> {
    if (!workerIdOrKycId) return workerIdOrKycId;
    const user = await prisma.user.findUnique({
      where: { id: workerIdOrKycId },
      select: { id: true },
    });
    if (user) return user.id;

    const kyc = await prisma.kYCApplication.findUnique({
      where: { id: workerIdOrKycId },
      select: { userId: true },
    });
    if (kyc) return kyc.userId;

    const profile = await prisma.workerProfile.findUnique({
      where: { id: workerIdOrKycId },
      select: { userId: true },
    });
    if (profile) return profile.userId;

    return workerIdOrKycId;
  }

  async getWorkerProfile(userId: string) {
    const resolvedUserId = await this.resolveUserId(userId);
    const profile = await prisma.workerProfile.findUnique({
      where: { userId: resolvedUserId },
    });
    const user = await prisma.user.findUnique({
      where: { id: resolvedUserId },
      // @ts-ignore
      select: { firstName: true, email: true, phone: true },
    });

    return {
      ...(profile || {}),
      // @ts-ignore
      fullName:
        profile?.fullName ||
        `${user?.firstName || ""} ${user?.lastName || ""}`.trim() ||
        null,
      email: profile?.email || user?.email || null,
      phone: profile?.phone || user?.phone || null,
    } as any;
  }

  async updateWorkerBasicDetails(userId: string, data: any) {
    await this.ensureEditableKYC(userId, "WORKER");
    await this.ensureSectionEditable(userId, "PERSONAL_INFO");

    const profile = await prisma.workerProfile.upsert({
      where: { userId },
      update: {
        fullName: data.fullName,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        gender: data.gender,
        language: data.language,
        phone: data.phone,
        email: data.email,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        state: data.state,
        city: data.city,
        pincode: data.pincode,
        about: data.about,
      },
      // @ts-ignore
      create: {
        userId,
        fullName: data.fullName,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        gender: data.gender,
        language: data.language,
        phone: data.phone,
        email: data.email,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        state: data.state,
        city: data.city,
        pincode: data.pincode,
        about: data.about,
      },
    });

    const kyc = await this.touchEditableKYC(userId, "WORKER");
    await this.resetSectionVerification(kyc.id, "PERSONAL_INFO");

    return profile;
  }

  async getDeliveryPartnerBasicDetails(userId: string) {
    let profile = await prisma.deliveryDetails.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundError("Delivery partner profile not found");
    const hasRegisteredCoordinates =
      profile.registeredLatitude != null &&
      profile.registeredLongitude != null &&
      Number.isFinite(Number(profile.registeredLatitude)) &&
      Number.isFinite(Number(profile.registeredLongitude)) &&
      !(
        Number(profile.registeredLatitude) === 0 &&
        Number(profile.registeredLongitude) === 0
      );
    if (!hasRegisteredCoordinates) {
      const address = [
        profile.currentAddress,
        profile.city,
        profile.state,
        profile.pincode,
        profile.country,
      ]
        .filter(
          (part): part is string =>
            typeof part === "string" && part.trim().length > 0,
        )
        .map((part) => part.trim().replace(/\s+/g, " "))
        .join(", ");
      if (address) {
        const coordinates = await geocodeAddress(address);
        if (
          coordinates &&
          Number.isFinite(coordinates.latitude) &&
          Number.isFinite(coordinates.longitude) &&
          !(coordinates.latitude === 0 && coordinates.longitude === 0)
        ) {
          profile = await prisma.deliveryDetails.update({
            where: { userId },
            data: {
              registeredLatitude: coordinates.latitude,
              registeredLongitude: coordinates.longitude,
            },
          });
        }
      }
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, email: true, phone: true } as any,
    });

    const kyc = await prisma.kYCApplication.findUnique({
      where: { userId },
      include: {
        KYCDocument: { orderBy: { createdAt: "desc" } },
        KYCSectionVerification: true,
      },
    });
    const personalInfoVerification = kyc?.KYCSectionVerification?.find(
      (section: any) => section.sectionType === "PERSONAL_INFO",
    );
    const sectionStatus = personalInfoVerification?.status || "PENDING";

    return {
      fullName: profile.fullName || user?.firstName || null,
      mobileNumber: profile.mobileNumber || (user as any)?.phone || null,
      email: profile.email || user?.email || null,
      dateOfBirth: profile.dateOfBirth,
      gender: profile.gender,
      language: profile.language,
      currentAddress: profile.currentAddress,
      permanentAddress: profile.permanentAddress,
      city: profile.city,
      state: profile.state,
      country: profile.country,
      pincode: profile.pincode,
      addressLatitude: profile.registeredLatitude,
      addressLongitude: profile.registeredLongitude,
      profilePhoto:
        profile.profilePhotoUrl ||
        formatDoc(
          kyc?.KYCDocument?.find(
            (d: any) => d.documentType === "PROFILE_PHOTO",
          ),
        ),
      profilePhotoUrl:
        profile.profilePhotoUrl ||
        formatDoc(
          kyc?.KYCDocument?.find(
            (d: any) => d.documentType === "PROFILE_PHOTO",
          ),
        ),
      kycStatus: sectionStatus,
      verification: {
        status: sectionStatus,
        remark: personalInfoVerification?.remark || null,
      },
      documents: kyc?.KYCDocument || [],
      sections: kyc?.KYCSectionVerification || [],
    };
  }

  async updateDeliveryPartnerBasicDetails(
    userId: string,
    data: UpdateDeliveryPartnerBasicDetailsDto,
  ) {
    await this.ensureEditableKYC(userId, "DELIVERY_PARTNER");
    await this.ensureSectionEditable(userId, "PERSONAL_INFO");

    const existingProfile = await prisma.deliveryDetails.findUnique({
      where: { userId },
    });
    if ((data.latitude === undefined) !== (data.longitude === undefined)) {
      throw new BadRequestError(
        "Latitude and longitude must be provided together",
      );
    }
    if (
      data.latitude !== undefined &&
      data.longitude !== undefined &&
      (!Number.isFinite(data.latitude) ||
        data.latitude < -90 ||
        data.latitude > 90 ||
        !Number.isFinite(data.longitude) ||
        data.longitude < -180 ||
        data.longitude > 180 ||
        (data.latitude === 0 && data.longitude === 0))
    ) {
      throw new BadRequestError("Latitude or longitude is invalid");
    }
    const nextAddress = {
      currentAddress:
        data.currentAddress ||
        data.address ||
        existingProfile?.currentAddress ||
        "",
      city: data.city || existingProfile?.city || "",
      state: data.state || existingProfile?.state || "",
      pincode: data.pincode || existingProfile?.pincode || "",
      country: data.country || existingProfile?.country || "",
    };
    for (const key of Object.keys(nextAddress) as Array<
      keyof typeof nextAddress
    >) {
      nextAddress[key] = nextAddress[key].trim().replace(/\s+/g, " ");
    }
    const addressChanged = [
      "currentAddress",
      "city",
      "state",
      "pincode",
      "country",
    ].some(
      (key) =>
        nextAddress[key as keyof typeof nextAddress].toLowerCase() !==
        String(existingProfile?.[key as keyof typeof existingProfile] || "")
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase(),
    );
    const addressParts = [
      nextAddress.currentAddress,
      nextAddress.city,
      nextAddress.state,
      nextAddress.pincode,
      nextAddress.country,
    ].filter(Boolean);
    const hasSavedCoordinates =
      existingProfile?.registeredLatitude != null &&
      existingProfile?.registeredLongitude != null &&
      Number.isFinite(Number(existingProfile.registeredLatitude)) &&
      Number.isFinite(Number(existingProfile.registeredLongitude)) &&
      !(
        Number(existingProfile.registeredLatitude) === 0 &&
        Number(existingProfile.registeredLongitude) === 0
      );
    const hasSubmittedCoordinates =
      data.latitude !== undefined && data.longitude !== undefined;
    const shouldGeocode =
      !hasSubmittedCoordinates &&
      addressParts.length > 0 &&
      (addressChanged || !hasSavedCoordinates);
    const geocodedAddress = shouldGeocode
      ? await geocodeAddress(addressParts.join(", "))
      : null;
    const addressCoordinates =
      geocodedAddress &&
      Number.isFinite(geocodedAddress.latitude) &&
      Number.isFinite(geocodedAddress.longitude) &&
      !(geocodedAddress.latitude === 0 && geocodedAddress.longitude === 0)
        ? geocodedAddress
        : null;

    const profile = await prisma.deliveryDetails.upsert({
      where: { userId },
      update: {
        fullName: data.fullName,
        mobileNumber: data.mobileNumber,
        email: data.email,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        gender: data.gender,
        currentAddress: nextAddress.currentAddress,
        permanentAddress: data.permanentAddress,
        city: nextAddress.city,
        state: nextAddress.state,
        country: nextAddress.country,
        pincode: nextAddress.pincode,
        profilePhotoUrl: data.profilePhotoUrl,
        ...(hasSubmittedCoordinates
          ? {
              registeredLatitude: data.latitude,
              registeredLongitude: data.longitude,
            }
          : shouldGeocode && {
              registeredLatitude:
                addressCoordinates?.latitude ??
                (addressChanged || !hasSavedCoordinates
                  ? null
                  : (existingProfile?.registeredLatitude ?? null)),
              registeredLongitude:
                addressCoordinates?.longitude ??
                (addressChanged || !hasSavedCoordinates
                  ? null
                  : (existingProfile?.registeredLongitude ?? null)),
            }),
        rejectionReason: null,
      },
      create: {
        userId,
        vehicleType: "NOT_PROVIDED",
        vehicleNumber: `PENDING-${userId}`,
        drivingLicense: "PENDING",
        fullName: data.fullName,
        mobileNumber: data.mobileNumber,
        email: data.email,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        gender: data.gender,
        currentAddress: nextAddress.currentAddress,
        permanentAddress: data.permanentAddress,
        city: nextAddress.city,
        state: nextAddress.state,
        country: nextAddress.country,
        pincode: nextAddress.pincode,
        profilePhotoUrl: data.profilePhotoUrl,
        registeredLatitude: hasSubmittedCoordinates
          ? data.latitude
          : (addressCoordinates?.latitude ?? null),
        registeredLongitude: hasSubmittedCoordinates
          ? data.longitude
          : (addressCoordinates?.longitude ?? null),
        kycStatus: "PENDING",
      },
    });

    const kyc = await this.touchEditableKYC(userId, "DELIVERY_PARTNER");
    await this.resetSectionVerification(kyc.id, "PERSONAL_INFO");

    return profile;
  }

  async getDeliveryPartnerIdentityDocuments(userId: string) {
    const status = await this.getMyKYCStatus(userId);
    const documents = (status as any).documents || [];
    const sections = await this.getDeliveryPartnerKYCSections(userId);
    const sec = sections.find(
      (s: any) => s.sectionType === "IDENTITY_DOCUMENTS",
    );
    const sectionStatus = sec?.status || "PENDING";

    return {
      kycStatus: sectionStatus,
      aadhaarNumber:
        documents.find((d: any) => d.documentType === "AADHAAR_FRONT")
          ?.documentNumber || null,
      panNumber:
        documents.find((d: any) => d.documentType === "PAN_CARD")
          ?.documentNumber || null,
      drivingLicenseNo:
        documents.find((d: any) => d.documentType === "DRIVING_LICENSE_FRONT")
          ?.documentNumber || null,
      aadhaarFront: formatDoc(
        documents.find((d: any) => d.documentType === "AADHAAR_FRONT"),
      ),
      frontAadhaarCard: formatDoc(
        documents.find((d: any) => d.documentType === "AADHAAR_FRONT"),
      ),
      aadhaarBack: formatDoc(
        documents.find((d: any) => d.documentType === "AADHAAR_BACK"),
      ),
      backAadhaarCard: formatDoc(
        documents.find((d: any) => d.documentType === "AADHAAR_BACK"),
      ),
      panCard: formatDoc(
        documents.find((d: any) => d.documentType === "PAN_CARD"),
      ),
      drivingLicenseFront: formatDoc(
        documents.find((d: any) => d.documentType === "DRIVING_LICENSE_FRONT"),
      ),
      frontDrivingLicense: formatDoc(
        documents.find((d: any) => d.documentType === "DRIVING_LICENSE_FRONT"),
      ),
      drivingLicenseBack: formatDoc(
        documents.find((d: any) => d.documentType === "DRIVING_LICENSE_BACK"),
      ),
      backDrivingLicense: formatDoc(
        documents.find((d: any) => d.documentType === "DRIVING_LICENSE_BACK"),
      ),
      verification: {
        status: sectionStatus,
        remark: sec?.remark || null,
      },
    };
  }

  async updateDeliveryPartnerIdentityDocuments(
    userId: string,
    data: UpdateDeliveryPartnerIdentityDocumentsDto,
    files: any,
  ) {
    await this.ensureEditableKYC(userId, "DELIVERY_PARTNER");
    await this.ensureSectionEditable(userId, "IDENTITY_DOCUMENTS");

    const uploaded = this.normalizeFiles(files);
    const baseUpload = {
      aadhaarFront: uploaded.aadhaarFront || data.aadhaarFrontUrl,
      aadhaarBack: uploaded.aadhaarBack || data.aadhaarBackUrl,
      panImage: uploaded.panImage || data.panImageUrl,
      drivingLicenseFront:
        uploaded.drivingLicenseFront || data.drivingLicenseFrontUrl,
      drivingLicenseBack:
        uploaded.drivingLicenseBack || data.drivingLicenseBackUrl,
    };

    const createOrUpdate = async (
      documentType: string,
      url?: string,
      number?: string,
    ) => {
      if (!url) return;
      const kyc = await prisma.kYCApplication.upsert({
        where: { userId },
        create: { userId, type: "DELIVERY_PARTNER" as any, status: "PENDING" },
        update: {},
      });

      const existingDoc = await prisma.kYCDocument.findFirst({
        where: { kycId: kyc.id, documentType },
      });
      if (existingDoc) {
        await prisma.kYCDocument.update({
          where: { id: existingDoc.id },
          data: {
            documentUrl: url,
            documentNumber: number,
            status: "PENDING",
            rejectionReason: null,
          },
        });
      } else {
        await prisma.kYCDocument.create({
          data: {
            kycId: kyc.id,
            documentType,
            documentUrl: url,
            documentNumber: number,
            status: "PENDING",
          },
        });
      }
    };

    await createOrUpdate(
      "AADHAAR_FRONT",
      baseUpload.aadhaarFront,
      data.aadhaarNumber,
    );
    await createOrUpdate(
      "AADHAAR_BACK",
      baseUpload.aadhaarBack,
      data.aadhaarNumber,
    );
    await createOrUpdate("PAN_CARD", baseUpload.panImage, data.panNumber);
    await createOrUpdate(
      "DRIVING_LICENSE_FRONT",
      baseUpload.drivingLicenseFront,
      data.drivingLicenseNo,
    );
    await createOrUpdate(
      "DRIVING_LICENSE_BACK",
      baseUpload.drivingLicenseBack,
      data.drivingLicenseNo,
    );

    return this.getDeliveryPartnerIdentityDocuments(userId);
  }

  async getDeliveryPartnerBankDetails(userId: string) {
    const profile = await prisma.deliveryDetails.findUnique({
      where: { userId },
    });
    const status = await this.getMyKYCStatus(userId);
    const documents = (status as any).documents || [];
    const sections = await this.getDeliveryPartnerKYCSections(userId);
    const sec = sections.find((s: any) => s.sectionType === "BANK_INFO");
    const sectionStatus = sec?.status || "PENDING";
    const kyc = await prisma.kYCApplication.findUnique({ where: { userId } });

    return {
      accountHolderName:
        kyc?.accountHolderName || profile?.accountHolderName || null,
      accountNumber: kyc?.accountNumber || profile?.accountNumber || null,
      confirmAccountNumber:
        kyc?.accountNumber || profile?.accountNumber || null,
      ifscCode: kyc?.ifscCode || profile?.ifscCode || null,
      bankName: kyc?.bankName || profile?.bankName || null,
      branchName: kyc?.bankName || profile?.bankName || null,
      bankPassbook: formatDoc(
        documents.find((d: any) => d.documentType === "BANK_PASSBOOK"),
      ),
      bankPassbookUrl: formatDoc(
        documents.find((d: any) => d.documentType === "BANK_PASSBOOK"),
      ),
      kycStatus: sectionStatus,
      verification: {
        status: sectionStatus,
        remark: sec?.remark || null,
      },
    };
  }

  async updateDeliveryPartnerBankDetails(
    userId: string,
    data: UpdateDeliveryPartnerBankDetailsDto,
    files?: any,
  ) {
    await this.ensureEditableKYC(userId, "DELIVERY_PARTNER");
    await this.ensureSectionEditable(userId, "BANK_INFO");

    const uploaded = this.normalizeFiles(files);
    const kyc = await prisma.kYCApplication.upsert({
      where: { userId },
      create: {
        userId,
        type: "DELIVERY_PARTNER" as any,
        status: "PENDING",
        accountHolderName: data.accountHolderName,
        accountNumber: data.accountNumber,
        ifscCode: data.ifscCode,
        bankName: data.bankName || data.branchName,
      },
      update: {
        status: "PENDING",
        submittedAt: null,
        accountHolderName: data.accountHolderName,
        accountNumber: data.accountNumber,
        ifscCode: data.ifscCode,
        bankName: data.bankName || data.branchName,
      },
    });

    await prisma.deliveryDetails.upsert({
      where: { userId },
      update: {
        accountHolderName: data.accountHolderName,
        accountNumber: data.accountNumber,
        ifscCode: data.ifscCode,
        bankName: data.bankName || data.branchName,
        kycStatus: "PENDING",
      },
      create: {
        userId,
        vehicleType: "NOT_PROVIDED",
        vehicleNumber: `PENDING-${userId}`,
        drivingLicense: "PENDING",
        accountHolderName: data.accountHolderName,
        accountNumber: data.accountNumber,
        ifscCode: data.ifscCode,
        bankName: data.bankName || data.branchName,
        kycStatus: "PENDING",
      },
    });

    const bankPassbookUrl = uploaded.bankPassbook || data.bankPassbookUrl;
    if (bankPassbookUrl) {
      await this.uploadDocument(userId, {
        documentType: "BANK_PASSBOOK",
        documentUrl: bankPassbookUrl,
      });
    }

    await this.resetSectionVerification(kyc.id, "BANK_INFO");
    return this.getDeliveryPartnerBankDetails(userId);
  }

  async getDeliveryPartnerLiveSelfie(userId: string) {
    const status = await this.getMyKYCStatus(userId);
    const documents = (status as any).documents || [];
    const sections = await this.getDeliveryPartnerKYCSections(userId);
    const sec = sections.find((s: any) => s.sectionType === "LIVE_SELFIE");
    const sectionStatus = sec?.status || "PENDING";

    return {
      kycStatus: sectionStatus,
      liveSelfie: formatDoc(
        documents.find((d: any) => d.documentType === "SELFIE"),
      ),
      selfie: formatDoc(
        documents.find((d: any) => d.documentType === "SELFIE"),
      ),
      verification: {
        status: sectionStatus,
        remark: sec?.remark || null,
      },
    };
  }

  async updateDeliveryPartnerLiveSelfie(
    userId: string,
    files?: any,
    selfieUrl?: string,
  ) {
    await this.ensureEditableKYC(userId, "DELIVERY_PARTNER");
    await this.ensureSectionEditable(userId, "LIVE_SELFIE");

    const uploaded = this.normalizeFiles(files);
    const url = uploaded.liveSelfie || uploaded.selfie || selfieUrl;
    if (url)
      await this.uploadDocument(userId, {
        documentType: "SELFIE",
        documentUrl: url,
      });
    const kyc = await this.touchEditableKYC(userId, "DELIVERY_PARTNER");
    await this.resetSectionVerification(kyc.id, "LIVE_SELFIE");
    return this.getDeliveryPartnerLiveSelfie(userId);
  }

  async getDeliveryPartnerVehicleDocuments(userId: string) {
    const profile = await prisma.deliveryDetails.findUnique({
      where: { userId },
    });
    const status = await this.getMyKYCStatus(userId);
    const documents = (status as any).documents || [];
    const sections = await this.getDeliveryPartnerKYCSections(userId);
    const sec = sections.find(
      (s: any) => s.sectionType === "VEHICLE_DOCUMENTS",
    );
    const sectionStatus = sec?.status || "PENDING";

    return {
      vehicleType: profile?.vehicleType || null,
      maxLoadKg: profile?.maxLoadKg ?? null,
      vehicleNumber: profile?.vehicleNumber || null,
      brand: profile?.vehicleBrand || null,
      vehicleBrand: profile?.vehicleBrand || null,
      model: profile?.vehicleModel || null,
      vehicleModel: profile?.vehicleModel || null,
      rcNumber: profile?.rcNumber || null,
      vehiclePhoto:
        profile?.vehiclePhotoUrl ||
        formatDoc(
          documents.find((d: any) => d.documentType === "VEHICLE_PHOTO"),
        ),
      vehiclePhotoUrl:
        profile?.vehiclePhotoUrl ||
        formatDoc(
          documents.find((d: any) => d.documentType === "VEHICLE_PHOTO"),
        ),
      rcBook: formatDoc(documents.find((d: any) => d.documentType === "RC")),
      rcUrl: formatDoc(documents.find((d: any) => d.documentType === "RC")),
      insuranceCertificate: formatDoc(
        documents.find((d: any) => d.documentType === "INSURANCE"),
      ),
      insuranceUrl: formatDoc(
        documents.find((d: any) => d.documentType === "INSURANCE"),
      ),
      pollutionCertificate: formatDoc(
        documents.find((d: any) => d.documentType === "POLLUTION_CERTIFICATE"),
      ),
      pollutionCertificateUrl: formatDoc(
        documents.find((d: any) => d.documentType === "POLLUTION_CERTIFICATE"),
      ),
      fitnessCertificate: formatDoc(
        documents.find((d: any) => d.documentType === "FITNESS_CERTIFICATE"),
      ),
      fitnessCertificateUrl: formatDoc(
        documents.find((d: any) => d.documentType === "FITNESS_CERTIFICATE"),
      ),
      kycStatus: sectionStatus,
      verification: {
        status: sectionStatus,
        remark: sec?.remark || null,
      },
    };
  }

  async updateDeliveryPartnerVehicleDocuments(
    userId: string,
    data: UpdateDeliveryPartnerVehicleDocumentsDto,
    files?: any,
  ) {
    await this.ensureEditableKYC(userId, "DELIVERY_PARTNER");
    await this.ensureSectionEditable(userId, "VEHICLE_DOCUMENTS");

    if (data.vehicleType) {
      const vehicleTypeExists = await prisma.vehicleType.findUnique({
        where: { id: data.vehicleType },
      });
      if (!vehicleTypeExists) {
        throw new BadRequestError("Invalid Vehicle Type selected");
      }
    }

    const uploaded = this.normalizeFiles(files);
    await prisma.deliveryDetails.upsert({
      where: { userId },
      update: {
        vehicleType: data.vehicleType,
        maxLoadKg: data.maxLoadKg,
        vehicleNumber: data.vehicleNumber,
        vehicleBrand: data.vehicleBrand || data.brand,
        vehicleModel: data.vehicleModel || data.model,
        rcNumber: data.rcNumber,
        vehiclePhotoUrl: uploaded.vehiclePhoto || data.vehiclePhotoUrl,
        kycStatus: "PENDING",
      },
      create: {
        userId,
        vehicleType: data.vehicleType || "NOT_PROVIDED",
        maxLoadKg: data.maxLoadKg,
        vehicleNumber: data.vehicleNumber || `PENDING-${userId}`,
        drivingLicense: "PENDING",
        vehicleBrand: data.vehicleBrand || data.brand,
        vehicleModel: data.vehicleModel || data.model,
        rcNumber: data.rcNumber,
        vehiclePhotoUrl: uploaded.vehiclePhoto || data.vehiclePhotoUrl,
        kycStatus: "PENDING",
      },
    });

    const docs: Array<[string, string | undefined]> = [
      ["VEHICLE_PHOTO", uploaded.vehiclePhoto || data.vehiclePhotoUrl],
      ["RC", uploaded.rcBook || uploaded.rc || data.rcUrl],
      [
        "INSURANCE",
        uploaded.insuranceCertificate ||
          uploaded.insurance ||
          data.insuranceUrl,
      ],
      [
        "POLLUTION_CERTIFICATE",
        uploaded.pollutionCertificate || data.pollutionCertificateUrl,
      ],
      [
        "FITNESS_CERTIFICATE",
        uploaded.fitnessCertificate || data.fitnessCertificateUrl,
      ],
    ];
    for (const [documentType, documentUrl] of docs) {
      if (documentUrl)
        await this.uploadDocument(userId, {
          documentType,
          documentUrl,
          documentNumber: documentType === "RC" ? data.rcNumber : undefined,
        });
    }

    const kyc = await this.touchEditableKYC(userId, "DELIVERY_PARTNER");
    await this.resetSectionVerification(kyc.id, "VEHICLE_DOCUMENTS");
    return this.getDeliveryPartnerVehicleDocuments(userId);
  }

  async updateWorkerBankDetails(userId: string, data: any) {
    await this.ensureEditableKYC(userId, "WORKER");
    await this.ensureSectionEditable(userId, "BANK_INFO");

    const profile = await prisma.workerProfile.upsert({
      where: { userId },
      update: {
        bankAccountName: data.bankAccountName,
        bankAccountNumber: data.bankAccountNumber,
        bankIfscCode: data.bankIfscCode,
      },
      // @ts-ignore
      create: {
        userId,
        bankAccountName: data.bankAccountName,
        bankAccountNumber: data.bankAccountNumber,
        bankIfscCode: data.bankIfscCode,
      },
    });

    const kyc = await this.touchEditableKYC(userId, "WORKER");
    await this.resetSectionVerification(kyc.id, "BANK_INFO");

    return profile;
  }

  async updateWorkerAddress(userId: string, data: any) {
    await this.ensureEditableKYC(userId, "WORKER");

    const profile = await prisma.workerProfile.upsert({
      where: { userId },
      update: {
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        state: data.state,
        city: data.city,
        pincode: data.pincode,
      },
      // @ts-ignore
      create: {
        userId,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        state: data.state,
        city: data.city,
        pincode: data.pincode,
      },
    });

    await this.touchEditableKYC(userId, "WORKER");

    return profile;
  }

  async updateWorkerExperience(userId: string, data: any) {
    await this.ensureEditableKYC(userId, "WORKER");
    await this.ensureSectionEditable(userId, "SKILLS_EXPERIENCE");
    const skill =
      data.skillId || data.skillCategory
        ? await this.resolveWorkerSkill(data)
        : null;
    const skillServiceIds = this.normalizeSkillServiceIds(data.skillServiceIds);
    if (skillServiceIds.length > 0 && !skill) {
      throw new BadRequestError(
        "Skill selection is required when selecting services",
      );
    }

    const profile = await prisma.$transaction(async (tx) => {
      const updatedProfile = await tx.workerProfile.upsert({
        where: { userId },
        update: {
          skillCategory: skill?.name,
          experienceYears: data.experienceYears
            ? parseInt(data.experienceYears, 10)
            : undefined,
          description: data.previousCompany || undefined,
          dailyWageExpectation: data.dailyWageExpectation
            ? parseInt(data.dailyWageExpectation, 10)
            : undefined,
        },
        // @ts-ignore
        create: {
          userId,
          skillCategory: skill?.name,
          experienceYears: data.experienceYears
            ? parseInt(data.experienceYears, 10)
            : undefined,
          description: data.previousCompany || undefined,
          dailyWageExpectation: data.dailyWageExpectation
            ? parseInt(data.dailyWageExpectation, 10)
            : undefined,
        },
      });

      if (skill) {
        await this.syncWorkerSkillServices(
          tx,
          userId,
          skill.id,
          skillServiceIds,
        );
      }

      return updatedProfile;
    });

    const kyc = await this.touchEditableKYC(userId, "WORKER");
    await this.resetSectionVerification(kyc.id, "SKILLS_EXPERIENCE");

    await prisma.workerDetails.updateMany({
      where: { userId },
      data: {
        ...(profile.experienceYears !== null &&
          profile.experienceYears !== undefined && {
            experienceYrs: profile.experienceYears,
          }),
        ...(profile.dailyWageExpectation !== null &&
          profile.dailyWageExpectation !== undefined && {
            hourlyRate: profile.dailyWageExpectation,
          }),
      },
    });

    return profile;
  }

  async getWorkerSelectedSkillServices(userId: string) {
    return prisma.workerSkillService.findMany({
      where: {
        workerUserId: userId,
        isActive: true,
      },
      include: {
        skillService: {
          include: { skill: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateWorkerSkillSelection(userId: string, data: any) {
    await this.ensureEditableKYC(userId, "WORKER");
    const skill = await this.resolveWorkerSkill(data);

    const profile = await prisma.workerProfile.upsert({
      where: { userId },
      update: {
        skillCategory: skill.name,
      },
      // @ts-ignore
      create: {
        userId,
        skillCategory: skill.name,
      },
    });

    await this.touchEditableKYC(userId, "WORKER");
    await prisma.workerDetails.updateMany({
      where: { userId },
      data: {
        ...(profile.experienceYears !== null &&
          profile.experienceYears !== undefined && {
            experienceYrs: profile.experienceYears,
          }),
        ...(profile.dailyWageExpectation !== null &&
          profile.dailyWageExpectation !== undefined && {
            hourlyRate: profile.dailyWageExpectation,
          }),
        ...(profile.workingRadiusKm !== null &&
          profile.workingRadiusKm !== undefined && {
            radiusKm: profile.workingRadiusKm,
          }),
      },
    });

    return profile;
  }

  async updateWorkerAvailability(userId: string, data: any) {
    await this.ensureEditableKYC(userId, "WORKER");
    await this.ensureSectionEditable(userId, "AVAILABILITY");

    const profile = await prisma.workerProfile.upsert({
      where: { userId },
      update: {
        availabilityMode: data.availabilityMode,
        immediateJoining: data.immediateJoining,
        workingRadiusKm: data.workingRadiusKm,
      },
      // @ts-ignore
      create: {
        userId,
        availabilityMode: data.availabilityMode,
        immediateJoining: data.immediateJoining,
        workingRadiusKm: data.workingRadiusKm,
      },
      select: {
        id: true,
        userId: true,
        availabilityMode: true,
        immediateJoining: true,
        workingRadiusKm: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const kyc = await this.touchEditableKYC(userId, "WORKER");
    await this.resetSectionVerification(kyc.id, "AVAILABILITY");

    return {
      ...profile,
      kycStatus: kyc.status,
    };
  }

  async updateWorkerPoliceVerification(userId: string, data: any) {
    await this.ensureEditableKYC(userId, "WORKER");

    const profile = await prisma.workerProfile.upsert({
      where: { userId },
      update: {
        policeVerificationOpt: data.policeVerificationOpt,
      },
      // @ts-ignore
      create: {
        userId,
        policeVerificationOpt: data.policeVerificationOpt,
      },
    });

    await this.touchEditableKYC(userId, "WORKER");
    return profile;
  }

  async updateWorkerOnboarding(userId: string, data: any) {
    await this.ensureEditableKYC(userId, "WORKER");
    const skill =
      data.skillId || data.skillCategory
        ? await this.resolveWorkerSkill(data)
        : null;

    const profile = await prisma.workerProfile.upsert({
      where: { userId },
      update: {
        fullName: data.fullName,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        gender: data.gender,
        language: data.language,
        phone: data.phone,
        email: data.email,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        state: data.state,
        city: data.city,
        pincode: data.pincode,
        bankAccountName: data.bankAccountName,
        bankAccountNumber: data.bankAccountNumber,
        bankIfscCode: data.bankIfscCode,
        policeVerificationOpt: data.policeVerificationOpt,
        skillCategory: skill?.name,
        experienceYears: data.experienceYears
          ? parseInt(data.experienceYears, 10)
          : undefined,
        description: data.previousCompany || undefined,
        dailyWageExpectation: data.dailyWageExpectation
          ? parseInt(data.dailyWageExpectation, 10)
          : undefined,
        availabilityMode: data.availabilityMode,
        immediateJoining: data.immediateJoining,
        workingRadiusKm: data.workingRadiusKm,
      },
      // @ts-ignore
      create: {
        userId,
        fullName: data.fullName,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        gender: data.gender,
        language: data.language,
        phone: data.phone,
        email: data.email,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        state: data.state,
        city: data.city,
        pincode: data.pincode,
        bankAccountName: data.bankAccountName,
        bankAccountNumber: data.bankAccountNumber,
        bankIfscCode: data.bankIfscCode,
        policeVerificationOpt: data.policeVerificationOpt,
        skillCategory: skill?.name,
        experienceYears: data.experienceYears
          ? parseInt(data.experienceYears, 10)
          : undefined,
        description: data.previousCompany || undefined,
        dailyWageExpectation: data.dailyWageExpectation
          ? parseInt(data.dailyWageExpectation, 10)
          : undefined,
        availabilityMode: data.availabilityMode,
        immediateJoining: data.immediateJoining,
        workingRadiusKm: data.workingRadiusKm,
      },
    });

    await this.touchEditableKYC(userId, "WORKER");
    return profile;
  }

  async updateVendorBusinessDetails(userId: string, data: any) {
    await this.ensureEditableKYC(userId, "VENDOR");

    const profile = await prisma.vendorProfile.upsert({
      where: { userId },
      update: {
        businessName: data.businessName,
        ownerName: data.ownerName,
        businessType: data.businessType,
        language: data.language,
        businessAddress: data.businessAddress,
        state: data.state,
        city: data.city,
        pincode: data.pincode,
        latitude: data.latitude,
        longitude: data.longitude,
        monthlySupplyCapacity: data.monthlySupplyCapacity,
        warehouseDetails: data.warehouseDetails,
      },
      // @ts-ignore
      create: {
        userId,
        businessName: data.businessName,
        ownerName: data.ownerName,
        businessType: data.businessType,
        language: data.language,
        businessAddress: data.businessAddress,
        state: data.state,
        city: data.city,
        pincode: data.pincode,
        latitude: data.latitude,
        longitude: data.longitude,
        monthlySupplyCapacity: data.monthlySupplyCapacity,
        warehouseDetails: data.warehouseDetails,
      },
    });

    await this.touchEditableKYC(userId, "VENDOR");

    return profile;
  }

  async updateVendorBankDetails(userId: string, data: any) {
    await this.ensureEditableKYC(userId, "VENDOR");

    const profile = await prisma.vendorProfile.upsert({
      where: { userId },
      update: {
        bankAccountName: data.bankAccountName,
        bankAccountNumber: data.bankAccountNumber,
        bankIfscCode: data.bankIfscCode,
      },
      // @ts-ignore
      create: {
        userId,
        bankAccountName: data.bankAccountName,
        bankAccountNumber: data.bankAccountNumber,
        bankIfscCode: data.bankIfscCode,
      },
    });

    await this.touchEditableKYC(userId, "VENDOR");

    return profile;
  }

  async updateVendorAddress(userId: string, data: any) {
    await this.ensureEditableKYC(userId, "VENDOR");

    const profile = await prisma.vendorProfile.upsert({
      where: { userId },
      update: {
        businessAddress: data.businessAddress,
        state: data.state,
        city: data.city,
        pincode: data.pincode,
        warehouseDetails: data.warehouseDetails,
      },
      // @ts-ignore
      create: {
        userId,
        businessAddress: data.businessAddress,
        state: data.state,
        city: data.city,
        pincode: data.pincode,
        warehouseDetails: data.warehouseDetails,
      },
    });

    await this.touchEditableKYC(userId, "VENDOR");

    return profile;
  }

  async updateVendorExperience(userId: string, data: any) {
    await this.ensureEditableKYC(userId, "VENDOR");

    const profile = await prisma.vendorProfile.upsert({
      where: { userId },
      update: {
        yearsInBusiness: data.yearsInBusiness,
        previousProjects: data.previousProjects || undefined,
      },
      // @ts-ignore
      create: {
        userId,
        yearsInBusiness: data.yearsInBusiness,
        previousProjects: data.previousProjects || undefined,
      },
    });

    await this.touchEditableKYC(userId, "VENDOR");

    return profile;
  }

  async uploadDocument(userId: string, data: UploadDocumentDto) {
    const kyc = await prisma.kYCApplication.findUnique({ where: { userId } });
    if (!kyc) throw new NotFoundError("KYC Application not found");

    let sectionType = "PERSONAL_INFO";
    if (
      [
        "IDENTITY_FRONT",
        "IDENTITY_BACK",
        "PAN_CARD",
        "POLICE_CERTIFICATE",
      ].includes(data.documentType)
    ) {
      sectionType = "IDENTITY_DOCUMENTS";
    } else if (data.documentType === "LIVE_SELFIE") {
      sectionType = "LIVE_SELFIE";
    } else if (data.documentType === "BANK_PASSBOOK") {
      sectionType = "BANK_INFO";
    } else if (
      [
        "EXPERIENCE_CERTIFICATE",
        "ITI_CERTIFICATE",
        "NSDC_CERTIFICATE",
        "GOVT_CERTIFICATE",
        "OTHER_CERTIFICATE",
      ].includes(data.documentType)
    ) {
      sectionType = "SKILLS_EXPERIENCE";
    }

    await this.ensureSectionEditable(userId, sectionType);

    const doc = await prisma.kYCDocument.findFirst({
      where: { kycId: kyc.id, documentType: data.documentType },
    });

    const savedDoc = doc
      ? await prisma.kYCDocument.update({
          where: { id: doc.id },
          data: {
            documentUrl: data.documentUrl,
            status: "PENDING",
            rejectionReason: null,
            verifiedBy: null,
            verifiedAt: null,
          },
        })
      : await prisma.kYCDocument.create({
          // @ts-ignore
          data: {
            kycId: kyc.id,
            documentType: data.documentType,
            documentUrl: data.documentUrl,
            documentNumber: data.documentNumber,
            status: "PENDING",
          },
        });

    await prisma.kYCApplication.update({
      where: { id: kyc.id },
      data: { status: "PENDING", submittedAt: null },
    });

    await this.resetSectionVerification(kyc.id, sectionType);

    return savedDoc;
  }

  async getMyKYCStatus(userId: string) {
    const resolvedUserId = await this.resolveUserId(userId);
    const kyc = await prisma.kYCApplication.findUnique({
      where: { userId: resolvedUserId },
      include: {
        KYCDocument: { orderBy: { createdAt: "desc" } },
        KYCSectionVerification: true,
        user: { include: { vendorKYCProfile: true, workerKYCProfile: true } },
        KYCVerificationLog: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    if (!kyc) {
      return {
        status: "NOT_STARTED",
        requiredDocuments: this.workerRequiredDocuments,
        missingDocuments: this.workerRequiredDocuments,
      };
    }

    (kyc as any).documents = (kyc as any).KYCDocument;

    let requiredDocuments = this.workerRequiredDocuments;
    let missingDocuments: string[] = [];

    if (kyc.type === "VENDOR") {
      requiredDocuments = this.vendorRequiredDocuments;
      // @ts-ignore
      missingDocuments = this.getMissingVendorDocuments(kyc.documents);
    } else if (kyc.type === "DELIVERY_PARTNER") {
      requiredDocuments = this.deliveryPartnerRequiredDocuments;
      // @ts-ignore
      missingDocuments = this.getMissingDeliveryPartnerDocuments(kyc.documents);
    } else {
      // @ts-ignore
      missingDocuments = this.getMissingWorkerDocuments(kyc.documents);
    }

    return {
      ...kyc,
      sectionVerifications: (kyc as any).KYCSectionVerification,
      KYCSectionVerification: undefined,
      requiredDocuments,
      missingDocuments,
    };
  }

  async getWorkerKYCProgress(userId: string) {
    const resolvedUserId = await this.resolveUserId(userId);
    const sections = await this.getWorkerKYCSections(resolvedUserId);
    const kyc = await prisma.kYCApplication.findUnique({
      where: { userId: resolvedUserId },
      select: { id: true, status: true, submittedAt: true },
    });
    const selectedSkillServices =
      await this.getWorkerSelectedSkillServices(resolvedUserId);

    const hasValue = (value: any) =>
      value !== null && value !== undefined && String(value).trim() !== "";
    const hasAnyDocument = (sectionType: string) => {
      const section = sections.find((item) => item.sectionType === sectionType);
      return Boolean(section?.uploadedFiles?.length);
    };
    const getSection = (sectionType: string) =>
      sections.find((item) => item.sectionType === sectionType);
    const hasRequiredData = (sectionType: string, fields: string[]) => {
      const section = getSection(sectionType);
      const data = (section?.data || {}) as Record<string, any>;
      return fields.every((field) => hasValue(data[field]));
    };
    const personalInfoCompleted = hasRequiredData("PERSONAL_INFO", [
      "fullName",
      "dateOfBirth",
      "gender",
      "phone",
      "state",
      "city",
      "pincode",
    ]);
    const bankInfoCompleted = hasRequiredData("BANK_INFO", [
      "bankAccountName",
      "bankAccountNumber",
      "bankIfscCode",
    ]);
    const skillsExperienceCompleted =
      hasRequiredData("SKILLS_EXPERIENCE", [
        "skillCategory",
        "experienceYears",
      ]) && selectedSkillServices.length > 0;
    const identityDocumentsCompleted = hasAnyDocument("IDENTITY_DOCUMENTS");
    const liveSelfieCompleted = hasAnyDocument("LIVE_SELFIE");
    const availabilityCompleted = hasRequiredData("AVAILABILITY", [
      "availabilityMode",
      "workingRadiusKm",
    ]);
    const baseSteps = [
      {
        stepKey: "CREATE_KYC",
        sectionType: "CREATE_KYC",
        title: "Create KYC",
        screenRoute: "/workers/kyc/create",
        isCompleted: Boolean(kyc),
      },
      {
        stepKey: "PERSONAL_INFO",
        sectionType: "PERSONAL_INFO",
        title: "Personal Info",
        screenRoute: "/workers/kyc/personal-info",
        isCompleted: personalInfoCompleted,
      },
      {
        stepKey: "BANK_INFO",
        sectionType: "BANK_INFO",
        title: "Bank Info",
        screenRoute: "/workers/kyc/bank-info",
        isCompleted: bankInfoCompleted,
      },
      {
        stepKey: "SKILLS_EXPERIENCE",
        sectionType: "SKILLS_EXPERIENCE",
        title: "Skills Experience",
        screenRoute: "/workers/kyc/skills-experience",
        isCompleted: skillsExperienceCompleted,
      },
      {
        stepKey: "IDENTITY_DOCUMENTS",
        sectionType: "IDENTITY_DOCUMENTS",
        title: "Identity Documents",
        screenRoute: "/workers/kyc/identity-documents",
        isCompleted: identityDocumentsCompleted,
      },
      {
        stepKey: "LIVE_SELFIE",
        sectionType: "LIVE_SELFIE",
        title: "Live Selfie",
        screenRoute: "/workers/kyc/live-selfie",
        isCompleted: liveSelfieCompleted,
      },
      {
        stepKey: "AVAILABILITY",
        sectionType: "AVAILABILITY",
        title: "Availability",
        screenRoute: "/workers/kyc/availability",
        isCompleted: availabilityCompleted,
      },
      {
        stepKey: "SUBMIT_KYC",
        sectionType: "SUBMIT_KYC",
        title: "Submit KYC",
        screenRoute: "/workers/kyc/submit",
        isCompleted:
          Boolean(kyc?.submittedAt) ||
          ["UNDER_REVIEW", "APPROVED"].includes(String(kyc?.status || "")),
      },
    ];

    const progressSections = baseSteps.map((item, index) => {
      const section = getSection(item.sectionType);
      return {
        ...item,
        order: index + 1,
        status: section?.status || "PENDING",
        remark: section?.remark || null,
        uploadedFileCount: section?.uploadedFiles?.length || 0,
        updatedAt: section?.updatedAt || null,
        canOpen: index === 0 || baseSteps[index - 1]?.isCompleted === true,
      };
    });

    const completedCount = progressSections.filter(
      (section) => section.isCompleted,
    ).length;
    const nextSection =
      progressSections.find((section) => !section.isCompleted) || null;
    const stepStatus = progressSections.reduce(
      (acc: Record<string, boolean>, section) => {
        acc[section.stepKey] = section.isCompleted;
        return acc;
      },
      {},
    );

    return {
      totalSections: progressSections.length,
      completedSections: completedCount,
      pendingSections: progressSections.length - completedCount,
      isCompleted: completedCount === progressSections.length,
      nextSection,
      nextStep: nextSection,
      pendingStep: nextSection,
      stepStatus,
      sections: progressSections,
    };
  }

  async getDeliveryPartnerKYCProgress(userId: string) {
    const resolvedUserId = await this.resolveUserId(userId);
    const sections = await this.getDeliveryPartnerKYCSections(resolvedUserId);
    const kyc = await prisma.kYCApplication.findUnique({
      where: { userId: resolvedUserId },
      select: { id: true, status: true, submittedAt: true },
    });

    const hasValue = (value: any) =>
      value !== null && value !== undefined && String(value).trim() !== "";
    const getSection = (sectionType: string) =>
      sections.find((item) => item.sectionType === sectionType);
    const hasAnyDocument = (sectionType: string) =>
      Boolean(getSection(sectionType)?.uploadedFiles?.length);
    const hasRequiredData = (sectionType: string, fields: string[]) => {
      const section = getSection(sectionType);
      const data = (section?.data || {}) as Record<string, any>;
      return fields.every((field) => hasValue(data[field]));
    };

    const personalInfoCompleted = hasRequiredData("PERSONAL_INFO", [
      "fullName",
      "dateOfBirth",
      "gender",
      "phone",
      "currentAddress",
      "city",
      "state",
      "pincode",
    ]);
    const identityDocumentsCompleted = hasAnyDocument("IDENTITY_DOCUMENTS");
    const bankInfoCompleted =
      hasRequiredData("BANK_INFO", [
        "accountHolderName",
        "accountNumber",
        "ifscCode",
      ]) ||
      hasRequiredData("BANK_INFO", [
        "bankAccountName",
        "bankAccountNumber",
        "bankIfscCode",
      ]);
    const liveSelfieCompleted = hasAnyDocument("LIVE_SELFIE");
    const vehicleDocumentsCompleted =
      hasRequiredData("VEHICLE_DOCUMENTS", ["vehicleType", "vehicleNumber"]) &&
      hasAnyDocument("VEHICLE_DOCUMENTS");

    const baseSteps = [
      {
        stepKey: "PERSONAL_INFO",
        sectionType: "PERSONAL_INFO",
        title: "Personal Info",
        screenRoute: "/delivery-partners/kyc/personal-info",
        isCompleted: personalInfoCompleted,
      },
      {
        stepKey: "IDENTITY_DOCUMENTS",
        sectionType: "IDENTITY_DOCUMENTS",
        title: "Identity Documents",
        screenRoute: "/delivery-partners/kyc/identity-documents",
        isCompleted: identityDocumentsCompleted,
      },
      {
        stepKey: "BANK_INFO",
        sectionType: "BANK_INFO",
        title: "Bank Info",
        screenRoute: "/delivery-partners/kyc/bank-info",
        isCompleted: bankInfoCompleted,
      },
      {
        stepKey: "LIVE_SELFIE",
        sectionType: "LIVE_SELFIE",
        title: "Live Selfie",
        screenRoute: "/delivery-partners/kyc/live-selfie",
        isCompleted: liveSelfieCompleted,
      },
      {
        stepKey: "VEHICLE_DOCUMENTS",
        sectionType: "VEHICLE_DOCUMENTS",
        title: "Vehicle Documents",
        screenRoute: "/delivery-partners/kyc/vehicle-documents",
        isCompleted: vehicleDocumentsCompleted,
      },
      {
        stepKey: "SUBMIT_KYC",
        sectionType: "SUBMIT_KYC",
        title: "Submit KYC",
        screenRoute: "/delivery-partners/kyc/submit",
        isCompleted:
          Boolean(kyc?.submittedAt) ||
          ["UNDER_REVIEW", "APPROVED"].includes(String(kyc?.status || "")),
      },
    ];

    const progressSections = baseSteps.map((item, index) => {
      const section = getSection(item.sectionType);
      return {
        ...item,
        order: index + 1,
        status: section?.status || "PENDING",
        remark: section?.remark || null,
        uploadedFileCount: section?.uploadedFiles?.length || 0,
        updatedAt: section?.updatedAt || null,
        canOpen: index === 0 || baseSteps[index - 1]?.isCompleted === true,
      };
    });

    const completedCount = progressSections.filter(
      (section) => section.isCompleted,
    ).length;
    const nextSection =
      progressSections.find((section) => !section.isCompleted) || null;
    const stepStatus = progressSections.reduce(
      (acc: Record<string, boolean>, section) => {
        acc[section.stepKey] = section.isCompleted;
        return acc;
      },
      {},
    );

    return {
      totalSections: progressSections.length,
      completedSections: completedCount,
      pendingSections: progressSections.length - completedCount,
      isCompleted: completedCount === progressSections.length,
      nextSection,
      nextStep: nextSection,
      pendingStep: nextSection,
      stepStatus,
      sections: progressSections,
    };
  }

  async submitWorkerKYC(userId: string) {
    const kyc = await prisma.kYCApplication.findUnique({
      where: { userId },
      include: {
        // @ts-ignore
        KYCDocument: true,
        user: { include: { workerKYCProfile: true } },
      },
    });
    if (!kyc || kyc.type !== "WORKER")
      throw new NotFoundError("WorkerDetails KYC Application not found");
    (kyc as any).documents = (kyc as any).KYCDocument;
    if (kyc.status === "APPROVED")
      throw new BadRequestError("KYC is already approved");
    if (kyc.status === "UNDER_REVIEW")
      throw new BadRequestError("KYC is already under review");

    // @ts-ignore
    const missingProfileFields = this.validateWorkerProfile(
      kyc.user.workerKYCProfile,
    );
    // @ts-ignore
    const missingDocuments = this.getMissingWorkerDocuments(kyc.documents);

    if (missingProfileFields.length || missingDocuments.length) {
      throw new BadRequestError(
        `KYC incomplete. Missing profile fields: ${missingProfileFields.join(", ") || "none"}. Missing documents: ${missingDocuments.join(", ") || "none"}`,
      );
    }

    const updated = await prisma.kYCApplication.update({
      where: { id: kyc.id },
      data: {
        status: "UNDER_REVIEW",
        submittedAt: new Date(),
        rejectionReason: null,
      },
    });

    return {
      ...updated,
      requiredDocuments: this.workerRequiredDocuments,
      missingDocuments: [],
    };
  }

  async submitDeliveryPartnerKYC(userId: string) {
    const kyc = await prisma.kYCApplication.findUnique({
      where: { userId },
      include: {
        KYCDocument: true,
      },
    });
    if (!kyc || kyc.type !== "DELIVERY_PARTNER")
      throw new NotFoundError("Delivery partner KYC Application not found");
    (kyc as any).documents = (kyc as any).KYCDocument;
    if (kyc.status === "APPROVED")
      throw new BadRequestError("KYC is already approved");
    if (kyc.status === "UNDER_REVIEW")
      throw new BadRequestError("KYC is already under review");

    const missingProfileFields = await this.validateDeliveryPartnerProfile(
      userId,
      kyc,
    );
    const missingDocuments = this.getMissingDeliveryPartnerDocuments(
      (kyc as any).documents,
    );

    if (missingProfileFields.length || missingDocuments.length) {
      throw new BadRequestError(
        `KYC incomplete. Missing profile fields: ${missingProfileFields.join(", ") || "none"}. Missing documents: ${missingDocuments.join(", ") || "none"}`,
      );
    }

    const updated = await prisma.kYCApplication.update({
      where: { id: kyc.id },
      data: {
        status: "UNDER_REVIEW",
        submittedAt: new Date(),
        rejectionReason: null,
      },
    });

    await prisma.deliveryDetails.updateMany({
      where: { userId },
      data: { kycStatus: "UNDER_REVIEW" as any, rejectionReason: null },
    });

    return {
      ...updated,
      requiredDocuments: this.deliveryPartnerRequiredDocuments,
      missingDocuments: [],
    };
  }

  async submitVendorKYC(userId: string) {
    const kyc = await prisma.kYCApplication.findUnique({
      where: { userId },
      include: {
        // @ts-ignore
        KYCDocument: true,
        user: { include: { vendorKYCProfile: true } },
      },
    });
    if (!kyc || kyc.type !== "VENDOR")
      throw new NotFoundError("VendorDetails KYC Application not found");
    (kyc as any).documents = (kyc as any).KYCDocument;
    if (kyc.status === "APPROVED")
      throw new BadRequestError("KYC is already approved");
    if (kyc.status === "UNDER_REVIEW")
      throw new BadRequestError("KYC is already under review");

    // @ts-ignore
    const missingProfileFields = this.validateVendorProfile(
      kyc.user.vendorKYCProfile,
    );
    // @ts-ignore
    const missingDocuments = this.getMissingVendorDocuments(kyc.documents);

    if (missingProfileFields.length || missingDocuments.length) {
      throw new BadRequestError(
        `KYC incomplete. Missing profile fields: ${missingProfileFields.join(", ") || "none"}. Missing documents: ${missingDocuments.join(", ") || "none"}`,
      );
    }

    const updated = await prisma.kYCApplication.update({
      where: { id: kyc.id },
      data: {
        status: "UNDER_REVIEW",
        submittedAt: new Date(),
        rejectionReason: null,
      },
    });

    return {
      ...updated,
      requiredDocuments: this.vendorRequiredDocuments,
      missingDocuments: [],
    };
  }

  async getAllKYCApplications(filters: any) {
    const query: any = { where: {} };
    if (filters.type) query.where.type = filters.type;
    if (filters.status) query.where.status = filters.status;

    // Simple pagination
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 10;
    query.skip = (page - 1) * limit;
    query.take = limit;
    query.orderBy = { createdAt: "desc" };

    return prisma.kYCApplication.findMany({
      ...query,
      include: {
        user: { select: { firstName: true, email: true, phone: true } },
      },
    });
  }

  async getAllVendors(filters: any) {
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 10;

    const vendors = await prisma.user.findMany({
      where: {
        // @ts-ignore
        role: { name: "VENDOR" },
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        firstName: true,
        // @ts-ignore

        email: true,
        phone: true,
        status: true,
        createdAt: true,
        vendorKYCProfile: true,
        KYCApplication: {
          include: {
            KYCDocument: true,
          },
        },
      },
    });

    return vendors.map((v) => ({
      // @ts-ignore
      id: v.KYCApplication?.id || v.id,
      userId: v.id,
      // @ts-ignore
      businessName:
        v.vendorProfile?.companyName ||
        v.vendorKYCProfile?.businessName ||
        `${v.firstName || ""} ${v.lastName || ""}`.trim() ||
        "Vendor",
      // @ts-ignore
      ownerName:
        v.vendorKYCProfile?.ownerName ||
        `${v.firstName || ""} ${v.lastName || ""}`.trim(),
      email: v.email,
      phone: v.phone,
      accountStatus: v.status,
      // @ts-ignore
      kycStatus: v.KYCApplication?.status || "NOT_STARTED",
      createdAt: v.createdAt,
      // @ts-ignore
      vendorProfile: v.vendorProfile || v.vendorKYCProfile,
      // @ts-ignore
      kycApplication: v.KYCApplication,
    }));
  }

  async getAllWorkers(filters: any) {
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 10;

    const workers = await prisma.user.findMany({
      where: {
        // @ts-ignore
        role: { name: "WORKER" },
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        firstName: true,
        // @ts-ignore

        email: true,
        phone: true,
        status: true,
        createdAt: true,
        workerKYCProfile: true,
        KYCApplication: {
          include: {
            KYCDocument: true,
          },
        },
      },
    });

    return workers.map((w) => ({
      // @ts-ignore
      id: w.KYCApplication?.id || w.id,
      userId: w.id,
      // @ts-ignore
      fullName:
        w.workerKYCProfile?.fullName ||
        `${w.firstName || ""} ${w.lastName || ""}`.trim() ||
        "Worker",
      // @ts-ignore
      skillCategory: w.workerKYCProfile?.skillCategory || "General Worker",
      email: w.email,
      phone: w.phone,
      accountStatus: w.status,
      // @ts-ignore
      kycStatus: w.KYCApplication?.status || "NOT_STARTED",
      createdAt: w.createdAt,
      // @ts-ignore
      workerProfile: w.workerKYCProfile,
      // @ts-ignore
      kycApplication: w.KYCApplication,
      // @ts-ignore
      profilePic:
        w.KYCApplication?.KYCDocument?.find(
          (d: any) =>
            d.documentType === "LIVE_SELFIE" || d.documentType === "SELFIE",
        )?.documentUrl || null,
    }));
  }

  async getKYCDetails(kycId: string) {
    const kyc = await prisma.kYCApplication.findUnique({
      where: { id: kycId },
      include: {
        // @ts-ignore
        user: { include: { workerKYCProfile: true, vendorKYCProfile: true } },
        KYCDocument: true,
        KYCVerificationLog: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!kyc) throw new NotFoundError("KYC not found");
    return kyc;
  }

  async approveDocument(documentId: string, adminId: string) {
    const doc = await prisma.kYCDocument.update({
      where: { id: documentId },
      data: { status: "APPROVED", verifiedBy: adminId, verifiedAt: new Date() },
    });

    await prisma.kYCVerificationLog.create({
      // @ts-ignore
      data: {
        kycId: doc.kycId,
        adminId,
        action: "DOCUMENT_APPROVED",
        newStatus: "APPROVED",
        comment: "",
        documentId,
      },
    });

    // Check if all docs are approved to auto-approve KYC
    await this.checkAndAutoUpdateKYCStatus(doc.kycId, adminId);
    return doc;
  }

  async rejectDocument(documentId: string, adminId: string, reason: string) {
    const doc = await prisma.kYCDocument.update({
      where: { id: documentId },
      data: {
        status: "REJECTED",
        rejectionReason: reason,
        verifiedBy: adminId,
        verifiedAt: new Date(),
      },
    });

    await prisma.kYCVerificationLog.create({
      // @ts-ignore
      data: {
        kycId: doc.kycId,
        adminId,
        action: "DOCUMENT_REJECTED",
        newStatus: "REJECTED",
        comment: reason,
        documentId,
      },
    });

    await prisma.kYCApplication.update({
      where: { id: doc.kycId },
      data: { status: "CORRECTION_REQUIRED", verifiedBy: adminId },
    });

    return doc;
  }

  async approveKYC(kycId: string, adminId: string) {
    const kyc = await prisma.kYCApplication.findUnique({
      where: { id: kycId },
      // @ts-ignore
      include: { KYCDocument: true },
    });
    if (!kyc) throw new NotFoundError("KYC not found");

    const requiredDocuments =
      kyc.type === "VENDOR"
        ? this.vendorRequiredDocuments
        : this.workerRequiredDocuments;
    const missingDocuments = requiredDocuments.filter(
      (documentType) =>
        // @ts-ignore
        !kyc.documents.some(
          (doc) =>
            doc.documentType === documentType && doc.status === "APPROVED",
        ),
    );
    if (missingDocuments.length) {
      throw new BadRequestError(
        `Missing approved documents: ${missingDocuments.join(", ")}`,
      );
    }

    // @ts-ignore
    const pendingDocs = kyc.documents.filter((d) => d.status !== "APPROVED");
    if (pendingDocs.length > 0) {
      throw new BadRequestError(
        "All submitted documents must be approved before approving KYC",
      );
    }

    const updated = await prisma.$transaction(async (tx: any) => {
      const application = await tx.kYCApplication.update({
        where: { id: kycId },
        data: {
          status: "APPROVED",
          verifiedBy: adminId,
          approvedAt: new Date(),
          rejectionReason: null,
        },
      });

      await tx.user.update({
        where: { id: kyc.userId },
        data: { status: "ACTIVE" },
      });

      if (kyc.type === "WORKER") {
        await this.activateWorkerDashboard(tx, kyc.userId);
      }

      return application;
    });

    await prisma.kYCVerificationLog.create({
      // @ts-ignore
      data: {
        kycId,
        adminId,
        action: "KYC_APPROVED",
        newStatus: "APPROVED",
        comment: "KYC fully approved",
      },
    });

    await this.notificationService.sendNotification({
      userId: kyc.userId,
      type: "KYC_APPROVED",
      title: "KYC Approved",
      message: "Your KYC has been approved.",
      referenceId: kycId,
      referenceType: "KYC",
    });

    await this.notificationService.sendNotificationToRoles(
      ["ADMIN", "SUPER_ADMIN"],
      {
        type: "KYC_APPROVED",
        title: "KYC Approved",
        message: `A ${kyc.type.toLowerCase()} KYC has been approved.`,
        referenceId: kycId,
        referenceType: "KYC",
        eventKey: `ADMIN_KYC_APPROVED:KYC:${kycId}`,
      },
    );

    return updated;
  }

  async rejectKYC(kycId: string, adminId: string, reason: string) {
    const kyc = await prisma.kYCApplication.findUnique({
      where: { id: kycId },
    });
    if (!kyc) throw new NotFoundError("KYC not found");

    const updated = await prisma.$transaction(async (tx: any) => {
      const application = await tx.kYCApplication.update({
        where: { id: kycId },
        data: {
          status: "REJECTED",
          verifiedBy: adminId,
          rejectionReason: reason,
          rejectedAt: new Date(),
        },
      });

      await tx.user.update({
        where: { id: kyc.userId },
        data: { status: "PENDING" },
      });

      return application;
    });

    await prisma.kYCVerificationLog.create({
      // @ts-ignore
      data: {
        kycId,
        adminId,
        action: "KYC_REJECTED",
        newStatus: "REJECTED",
        comment: reason,
      },
    });

    await this.notificationService.sendNotification({
      userId: kyc.userId,
      type: "KYC_REJECTED",
      title: "KYC Rejected",
      message: reason || "Your KYC has been rejected.",
      referenceId: kycId,
      referenceType: "KYC",
    });

    await this.notificationService.sendNotificationToRoles(
      ["ADMIN", "SUPER_ADMIN"],
      {
        type: "KYC_REJECTED",
        title: "KYC Rejected",
        message: `A ${kyc.type.toLowerCase()} KYC has been rejected.`,
        referenceId: kycId,
        referenceType: "KYC",
        eventKey: `ADMIN_KYC_REJECTED:KYC:${kycId}`,
      },
    );

    return updated;
  }

  async requestCorrection(
    kycId: string,
    adminId: string,
    reason: string = "Please upload corrected documents",
  ) {
    const updated = await prisma.kYCApplication.update({
      where: { id: kycId },
      data: {
        status: "CORRECTION_REQUIRED",
        verifiedBy: adminId,
        rejectionReason: reason,
      },
    });

    await prisma.kYCVerificationLog.create({
      // @ts-ignore
      data: {
        kycId,
        adminId,
        action: "CORRECTION_REQUESTED",
        newStatus: "CORRECTION_REQUIRED",
        comment: reason,
      },
    });

    return updated;
  }

  private async checkAndAutoUpdateKYCStatus(kycId: string, adminId: string) {
    const kyc = await prisma.kYCApplication.findUnique({
      where: { id: kycId },
      // @ts-ignore
      include: { KYCDocument: true },
    });
    if (kyc) {
      (kyc as any).documents = (kyc as any).KYCDocument;
      // @ts-ignore
      const anyRejected = kyc.documents.some((d) => d.status === "REJECTED");

      if (anyRejected) {
        await prisma.kYCApplication.update({
          where: { id: kycId },
          data: { status: "CORRECTION_REQUIRED", verifiedBy: adminId },
        });
      }
    }
  }

  // --- Admin Section Verification Methods ---

  async getWorkerKYCSections(workerUserId: string) {
    const resolvedUserId = await this.resolveUserId(workerUserId);
    let kyc = await prisma.kYCApplication.findFirst({
      where: {
        OR: [{ userId: resolvedUserId }, { id: workerUserId }],
      },
    });
    if (!kyc) {
      const user = await prisma.user.findUnique({
        where: { id: resolvedUserId },
      });
      if (!user) throw new NotFoundError("WorkerDetails not found");

      kyc = await prisma.kYCApplication.create({
        // @ts-ignore
        data: {
          userId: resolvedUserId,
          type: "WORKER",
          status: "PENDING",
        },
      });
    }

    const profile = await this.getWorkerProfile(resolvedUserId);
    const documents = await prisma.kYCDocument.findMany({
      where: { kycId: kyc.id },
    });
    const verifications = await prisma.kYCSectionVerification.findMany({
      where: { kycId: kyc.id },
    });

    const getVerif = (type: any) =>
      verifications.find((v) => v.sectionType === type) || {
        status: "NOT_SUBMITTED",
        remark: null,
        updatedAt: kyc.createdAt,
      };

    const getDocsStatus = (types: string[]) => {
      const docs = documents.filter((d) => types.includes(d.documentType));
      if (docs.length === 0)
        return {
          status: "NOT_SUBMITTED",
          remark: null,
          updatedAt: kyc.createdAt,
        };
      const anyRejected = docs.find((d) => d.status === "REJECTED");
      if (anyRejected)
        return {
          status: "REJECTED",
          remark: anyRejected.rejectionReason,
          updatedAt: anyRejected.updatedAt || kyc.updatedAt,
        };
      const allApproved = docs.every((d) => d.status === "APPROVED");
      if (allApproved)
        return {
          status: "APPROVED",
          remark: null,
          updatedAt: docs[0].updatedAt || kyc.updatedAt,
        };
      return { status: "PENDING", remark: null, updatedAt: kyc.createdAt };
    };

    return [
      {
        id: "PERSONAL_INFO",
        sectionType: "PERSONAL_INFO",
        data: {
          fullName: profile.fullName,
          dateOfBirth: profile.dateOfBirth,
          gender: profile.gender,
          phone: profile.phone,
          email: profile.email,
          addressLine1: profile.addressLine1,
          addressLine2: profile.addressLine2,
          state: profile.state,
          city: profile.city,
          pincode: profile.pincode,
        },
        uploadedFiles: documents.filter(
          (d) => d.documentType === "ADDRESS_PROOF",
        ),
        status: getVerif("PERSONAL_INFO").status,
        remark: getVerif("PERSONAL_INFO").remark,
        updatedAt: getVerif("PERSONAL_INFO").updatedAt,
      },
      {
        id: "BANK_INFO",
        sectionType: "BANK_INFO",
        data: {
          bankAccountName: profile.bankAccountName,
          bankAccountNumber: profile.bankAccountNumber,
          bankIfscCode: profile.bankIfscCode,
        },
        uploadedFiles: documents.filter(
          (d) => d.documentType === "BANK_PASSBOOK",
        ),
        status: getVerif("BANK_INFO").status,
        remark: getVerif("BANK_INFO").remark,
        updatedAt: getVerif("BANK_INFO").updatedAt,
      },
      {
        id: "SKILLS_EXPERIENCE",
        sectionType: "SKILLS_EXPERIENCE",
        data: {
          skillCategory: profile.skillCategory,
          experienceYears: profile.experienceYears,
          previousCompany: profile.previousCompany,
        },
        uploadedFiles: documents.filter((d) =>
          [
            "EXPERIENCE_CERTIFICATE",
            "ITI_CERTIFICATE",
            "NSDC_CERTIFICATE",
            "GOVT_CERTIFICATE",
            "OTHER_CERTIFICATE",
          ].includes(d.documentType),
        ),
        status: getVerif("SKILLS_EXPERIENCE").status,
        remark: getVerif("SKILLS_EXPERIENCE").remark,
        updatedAt: getVerif("SKILLS_EXPERIENCE").updatedAt,
      },
      {
        id: "IDENTITY_DOCUMENTS",
        sectionType: "IDENTITY_DOCUMENTS",
        data: {
          identityNumber:
            documents.find((d: any) => d.documentType === "IDENTITY_FRONT")
              ?.documentNumber || null,
          panNumber:
            documents.find((d: any) => d.documentType === "PAN_CARD")
              ?.documentNumber || null,
          aadhaarNumber:
            documents.find((d: any) => d.documentType === "AADHAAR_FRONT")
              ?.documentNumber || null,
          drivingLicenseNo:
            documents.find(
              (d: any) => d.documentType === "DRIVING_LICENSE_FRONT",
            )?.documentNumber || null,
        },
        uploadedFiles: documents.filter((d) =>
          [
            "IDENTITY_FRONT",
            "IDENTITY_BACK",
            "PAN_CARD",
            "POLICE_CERTIFICATE",
            "AADHAAR_FRONT",
            "AADHAAR_BACK",
            "DRIVING_LICENSE_FRONT",
            "DRIVING_LICENSE_BACK",
          ].includes(d.documentType),
        ),
        status: getDocsStatus([
          "IDENTITY_FRONT",
          "IDENTITY_BACK",
          "PAN_CARD",
          "POLICE_CERTIFICATE",
          "AADHAAR_FRONT",
          "AADHAAR_BACK",
          "DRIVING_LICENSE_FRONT",
          "DRIVING_LICENSE_BACK",
        ]).status,
        remark: getDocsStatus([
          "IDENTITY_FRONT",
          "IDENTITY_BACK",
          "PAN_CARD",
          "POLICE_CERTIFICATE",
          "AADHAAR_FRONT",
          "AADHAAR_BACK",
          "DRIVING_LICENSE_FRONT",
          "DRIVING_LICENSE_BACK",
        ]).remark,
        updatedAt: getDocsStatus([
          "IDENTITY_FRONT",
          "IDENTITY_BACK",
          "PAN_CARD",
          "POLICE_CERTIFICATE",
          "AADHAAR_FRONT",
          "AADHAAR_BACK",
          "DRIVING_LICENSE_FRONT",
          "DRIVING_LICENSE_BACK",
        ]).updatedAt,
      },
      {
        id: "LIVE_SELFIE",
        sectionType: "LIVE_SELFIE",
        data: {},
        uploadedFiles: documents.filter(
          (d) => d.documentType === "LIVE_SELFIE",
        ),
        status: getDocsStatus(["LIVE_SELFIE"]).status,
        remark: getDocsStatus(["LIVE_SELFIE"]).remark,
        updatedAt: getDocsStatus(["LIVE_SELFIE"]).updatedAt,
      },
      {
        id: "AVAILABILITY",
        sectionType: "AVAILABILITY",
        data: {
          availabilityMode: profile.availabilityMode,
          immediateJoining: profile.immediateJoining,
          workingRadiusKm: profile.workingRadiusKm,
        },
        uploadedFiles: [],
        status: getVerif("AVAILABILITY").status,
        remark: getVerif("AVAILABILITY").remark,
        updatedAt: getVerif("AVAILABILITY").updatedAt,
      },
    ];
  }

  async verifyKYCSection(
    workerUserId: string,
    sectionType: any,
    status: any,
    remark: string | null,
    adminId: string,
  ) {
    const resolvedUserId = await this.resolveUserId(workerUserId);
    let kyc = await prisma.kYCApplication.findFirst({
      where: {
        OR: [{ userId: resolvedUserId }, { id: workerUserId }],
      },
    });

    if (!kyc) {
      const user = await prisma.user.findUnique({
        where: { id: resolvedUserId },
        include: { role: true },
      });
      if (!user) throw new NotFoundError("User not found");
      const userRole = (user as any).role?.name || "WORKER";

      kyc = await prisma.kYCApplication.create({
        // @ts-ignore
        data: {
          userId: resolvedUserId,
          type: userRole,
          status: "PENDING",
        },
      });
    }

    const formattedSectionType = sectionType.replace(/-/g, "_").toUpperCase();

    if (
      formattedSectionType === "IDENTITY_DOCUMENTS" ||
      formattedSectionType === "LIVE_SELFIE" ||
      formattedSectionType === "VEHICLE_DOCUMENTS"
    ) {
      let docTypes: string[] = [];
      if (formattedSectionType === "IDENTITY_DOCUMENTS") {
        docTypes = [
          "IDENTITY_FRONT",
          "IDENTITY_BACK",
          "PAN_CARD",
          "POLICE_CERTIFICATE",
          "AADHAAR_FRONT",
          "AADHAAR_BACK",
          "DRIVING_LICENSE_FRONT",
          "DRIVING_LICENSE_BACK",
          "DRIVING_LICENSE",
        ];
      } else if (formattedSectionType === "LIVE_SELFIE") {
        docTypes = ["LIVE_SELFIE", "SELFIE"];
      } else if (formattedSectionType === "VEHICLE_DOCUMENTS") {
        docTypes = [
          "VEHICLE_PHOTO",
          "RC",
          "INSURANCE",
          "POLLUTION_CERTIFICATE",
          "FITNESS_CERTIFICATE",
        ];
      }

      await prisma.kYCDocument.updateMany({
        where: {
          kycId: kyc.id,
          documentType: { in: docTypes },
        },
        data: {
          status: status === "APPROVED" ? "APPROVED" : "REJECTED",
          rejectionReason: status === "REJECTED" ? remark : null,
          verifiedBy: adminId,
          verifiedAt: new Date(),
        },
      });

      await prisma.kYCVerificationLog.create({
        // @ts-ignore
        data: {
          kycId: kyc.id,
          adminId,
          action: `SECTION_VERIFIED_${formattedSectionType}`,
          newStatus: status,
          comment: remark,
        },
      });

      await this.recalculateKYCStatus(kyc.id, adminId);

      return {
        id: formattedSectionType,
        kycId: kyc.id,
        sectionType: formattedSectionType,
        status,
        remark,
        verifiedBy: adminId,
        verifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const verif = await prisma.kYCSectionVerification.upsert({
      where: {
        kycId_sectionType: { kycId: kyc.id, sectionType: formattedSectionType },
      },
      update: { status, remark, verifiedBy: adminId, verifiedAt: new Date() },
      // @ts-ignore
      create: {
        kycId: kyc.id,
        sectionType: formattedSectionType,
        status,
        remark,
        verifiedBy: adminId,
        verifiedAt: new Date(),
      },
    });

    let docTypes: string[] = [];
    if (formattedSectionType === "PERSONAL_INFO") {
      docTypes = ["ADDRESS_PROOF"];
    } else if (formattedSectionType === "BANK_INFO") {
      docTypes = ["BANK_PASSBOOK"];
    } else if (formattedSectionType === "SKILLS_EXPERIENCE") {
      docTypes = [
        "EXPERIENCE_CERTIFICATE",
        "ITI_CERTIFICATE",
        "NSDC_CERTIFICATE",
        "GOVT_CERTIFICATE",
        "OTHER_CERTIFICATE",
      ];
    }

    if (docTypes.length > 0) {
      await prisma.kYCDocument.updateMany({
        where: {
          kycId: kyc.id,
          documentType: { in: docTypes },
        },
        data: {
          status: status === "APPROVED" ? "APPROVED" : "REJECTED",
          rejectionReason: status === "REJECTED" ? remark : null,
          verifiedBy: adminId,
          verifiedAt: new Date(),
        },
      });
    }

    await prisma.kYCVerificationLog.create({
      // @ts-ignore
      data: {
        kycId: kyc.id,
        adminId,
        action: `SECTION_VERIFIED_${formattedSectionType}`,
        newStatus: status,
        comment: remark,
      },
    });

    await this.recalculateKYCStatus(kyc.id, adminId);
    return verif;
  }

  async verifyBulkKYCSections(
    workerUserId: string,
    sectionTypes: any[],
    status: any,
    remark: string | null,
    adminId: string,
  ) {
    for (const sectionType of sectionTypes) {
      await this.verifyKYCSection(
        workerUserId,
        sectionType,
        status,
        remark,
        adminId,
      );
    }
  }

  async verifyAllKYCSections(
    workerUserId: string,
    status: any,
    remark: string | null,
    adminId: string,
  ) {
    // Detect user role to choose correct section list
    const resolvedUserId = await this.resolveUserId(workerUserId);
    const user = await prisma.user.findUnique({
      where: { id: resolvedUserId },
      include: { role: true },
    });
    const roleName = (user as any)?.role?.name || "";

    let allSections: string[];
    if (roleName === "DELIVERY_PARTNER") {
      allSections = [
        "PERSONAL_INFO",
        "BANK_INFO",
        "IDENTITY_DOCUMENTS",
        "LIVE_SELFIE",
        "VEHICLE_DOCUMENTS",
      ];
    } else {
      allSections = [
        "PERSONAL_INFO",
        "BANK_INFO",
        "SKILLS_EXPERIENCE",
        "IDENTITY_DOCUMENTS",
        "LIVE_SELFIE",
        "AVAILABILITY",
      ];
    }
    await this.verifyBulkKYCSections(
      workerUserId,
      allSections,
      status,
      remark,
      adminId,
    );
  }

  async getDeliveryPartnerKYCSections(userId: string) {
    const resolvedUserId = await this.resolveUserId(userId);
    let kyc = await prisma.kYCApplication.findFirst({
      where: {
        OR: [{ userId: resolvedUserId }, { id: userId }],
      },
    });
    if (!kyc) {
      kyc = await prisma.kYCApplication.create({
        // @ts-ignore
        data: {
          userId: resolvedUserId,
          type: "DELIVERY_PARTNER",
          status: "PENDING",
        },
      });
    }

    const profile = await prisma.deliveryDetails.findUnique({
      where: { userId: resolvedUserId },
    });
    if (!profile) throw new NotFoundError("Delivery partner profile not found");

    const documents = await prisma.kYCDocument.findMany({
      where: { kycId: kyc.id },
    });
    const verifications = await prisma.kYCSectionVerification.findMany({
      where: { kycId: kyc.id },
    });

    const getVerif = (type: any) =>
      verifications.find((v) => v.sectionType === type) || {
        status: "NOT_SUBMITTED",
        remark: null,
        updatedAt: kyc.createdAt,
      };

    const getDocsStatus = (types: string[]) => {
      const docs = documents.filter((d) => types.includes(d.documentType));
      if (docs.length === 0)
        return {
          status: "NOT_SUBMITTED",
          remark: null,
          updatedAt: kyc.createdAt,
        };
      const anyRejected = docs.find((d) => d.status === "REJECTED");
      if (anyRejected)
        return {
          status: "REJECTED",
          remark: anyRejected.rejectionReason,
          updatedAt: anyRejected.updatedAt || kyc.updatedAt,
        };
      const allApproved = docs.every((d) => d.status === "APPROVED");
      if (allApproved)
        return {
          status: "APPROVED",
          remark: null,
          updatedAt: docs[0].updatedAt || kyc.updatedAt,
        };
      return { status: "PENDING", remark: null, updatedAt: kyc.createdAt };
    };

    return [
      {
        id: "PERSONAL_INFO",
        sectionType: "PERSONAL_INFO",
        data: {
          fullName: profile.fullName,
          dateOfBirth: profile.dateOfBirth,
          gender: profile.gender,
          phone: profile.mobileNumber,
          email: profile.email,
          currentAddress: profile.currentAddress,
          permanentAddress: profile.permanentAddress,
          city: profile.city,
          state: profile.state,
          country: profile.country,
          pincode: profile.pincode,
        },
        uploadedFiles: documents.filter(
          (d) => d.documentType === "PROFILE_PHOTO",
        ),
        status: getVerif("PERSONAL_INFO").status,
        remark: getVerif("PERSONAL_INFO").remark,
        updatedAt: getVerif("PERSONAL_INFO").updatedAt,
      },
      {
        id: "BANK_INFO",
        sectionType: "BANK_INFO",
        data: {
          bankAccountName: kyc.accountHolderName,
          bankAccountNumber: kyc.accountNumber,
          confirmAccountNumber: kyc.accountNumber,
          bankIfscCode: kyc.ifscCode,
          ifscCode: kyc.ifscCode,
          bankName: kyc.bankName,
          branchName: kyc.bankName,
        },
        uploadedFiles: documents.filter(
          (d) => d.documentType === "BANK_PASSBOOK",
        ),
        status: getVerif("BANK_INFO").status,
        remark: getVerif("BANK_INFO").remark,
        updatedAt: getVerif("BANK_INFO").updatedAt,
      },
      {
        id: "IDENTITY_DOCUMENTS",
        sectionType: "IDENTITY_DOCUMENTS",
        data: {
          aadhaarNumber: kyc.aadhaarNumber,
          panNumber: kyc.panNumber,
          drivingLicenseNo: kyc.drivingLicenseNo,
        },
        uploadedFiles: documents.filter((d) =>
          [
            "AADHAAR_FRONT",
            "AADHAAR_BACK",
            "PAN_CARD",
            "DRIVING_LICENSE_FRONT",
            "DRIVING_LICENSE_BACK",
            "DRIVING_LICENSE",
          ].includes(d.documentType),
        ),
        status: getDocsStatus([
          "AADHAAR_FRONT",
          "AADHAAR_BACK",
          "PAN_CARD",
          "DRIVING_LICENSE_FRONT",
          "DRIVING_LICENSE_BACK",
          "DRIVING_LICENSE",
        ]).status,
        remark: getDocsStatus([
          "AADHAAR_FRONT",
          "AADHAAR_BACK",
          "PAN_CARD",
          "DRIVING_LICENSE_FRONT",
          "DRIVING_LICENSE_BACK",
          "DRIVING_LICENSE",
        ]).remark,
        updatedAt: getDocsStatus([
          "AADHAAR_FRONT",
          "AADHAAR_BACK",
          "PAN_CARD",
          "DRIVING_LICENSE_FRONT",
          "DRIVING_LICENSE_BACK",
          "DRIVING_LICENSE",
        ]).updatedAt,
      },
      {
        id: "LIVE_SELFIE",
        sectionType: "LIVE_SELFIE",
        data: {},
        uploadedFiles: documents.filter((d) => d.documentType === "SELFIE"),
        status: getDocsStatus(["SELFIE"]).status,
        remark: getDocsStatus(["SELFIE"]).remark,
        updatedAt: getDocsStatus(["SELFIE"]).updatedAt,
      },
      {
        id: "VEHICLE_DOCUMENTS",
        sectionType: "VEHICLE_DOCUMENTS",
        data: {
          vehicleType: profile.vehicleType,
          vehicleNumber: profile.vehicleNumber,
          brand: profile.vehicleBrand,
          model: profile.vehicleModel,
          rcNumber: profile.rcNumber,
        },
        uploadedFiles: documents.filter((d) =>
          [
            "VEHICLE_PHOTO",
            "RC",
            "INSURANCE",
            "POLLUTION_CERTIFICATE",
            "FITNESS_CERTIFICATE",
          ].includes(d.documentType),
        ),
        status: getDocsStatus([
          "VEHICLE_PHOTO",
          "RC",
          "INSURANCE",
          "POLLUTION_CERTIFICATE",
          "FITNESS_CERTIFICATE",
        ]).status,
        remark: getDocsStatus([
          "VEHICLE_PHOTO",
          "RC",
          "INSURANCE",
          "POLLUTION_CERTIFICATE",
          "FITNESS_CERTIFICATE",
        ]).remark,
        updatedAt: getDocsStatus([
          "VEHICLE_PHOTO",
          "RC",
          "INSURANCE",
          "POLLUTION_CERTIFICATE",
          "FITNESS_CERTIFICATE",
        ]).updatedAt,
      },
    ];
  }

  private async recalculateKYCStatus(kycId: string, adminId: string) {
    const kyc = await prisma.kYCApplication.findUnique({
      where: { id: kycId },
    });
    const verifications = await prisma.kYCSectionVerification.findMany({
      where: { kycId },
    });
    const documents = await prisma.kYCDocument.findMany({ where: { kycId } });

    // Pick the right sections list based on KYC type
    const kycType = (kyc as any)?.type || "WORKER";
    let allSections: string[];
    if (kycType === "DELIVERY_PARTNER") {
      allSections = ["PERSONAL_INFO", "BANK_INFO"];
    } else {
      allSections = [
        "PERSONAL_INFO",
        "BANK_INFO",
        "SKILLS_EXPERIENCE",
        "AVAILABILITY",
      ];
    }

    // Check document-based sections separately for delivery partners
    let docSectionsApproved = true;
    let docSectionsRejected = false;
    if (kycType === "DELIVERY_PARTNER") {
      const docSectionMap: Record<string, string[]> = {
        IDENTITY_DOCUMENTS: [
          "AADHAAR_FRONT",
          "AADHAAR_BACK",
          "PAN_CARD",
          "DRIVING_LICENSE_FRONT",
          "DRIVING_LICENSE_BACK",
          "DRIVING_LICENSE",
        ],
        LIVE_SELFIE: ["LIVE_SELFIE", "SELFIE"],
        VEHICLE_DOCUMENTS: [
          "VEHICLE_PHOTO",
          "RC",
          "INSURANCE",
          "POLLUTION_CERTIFICATE",
          "FITNESS_CERTIFICATE",
        ],
      };
      for (const [, docTypes] of Object.entries(docSectionMap)) {
        const sectionDocs = documents.filter((d) =>
          docTypes.includes(d.documentType),
        );
        if (sectionDocs.length > 0) {
          if (sectionDocs.some((d) => (d as any).status === "REJECTED"))
            docSectionsRejected = true;
          if (!sectionDocs.every((d) => (d as any).status === "APPROVED"))
            docSectionsApproved = false;
        } else {
          docSectionsApproved = false;
        }
      }
    }

    const hasRejected =
      verifications.some((v) => v.status === "REJECTED") || docSectionsRejected;
    const sectionVerifApproved = allSections.every((sec) =>
      verifications.some(
        (v) => v.sectionType === sec && v.status === "APPROVED",
      ),
    );
    const allApproved =
      sectionVerifApproved &&
      (kycType === "DELIVERY_PARTNER" ? docSectionsApproved : true);

    let newStatus = undefined;
    if (hasRejected) {
      newStatus = "REJECTED";
    } else if (allApproved) {
      newStatus = "APPROVED";
    }

    if (newStatus) {
      await prisma.kYCApplication.update({
        where: { id: kycId },
        data: { status: newStatus as any, verifiedBy: adminId },
      });

      // Sync kycStatus on DeliveryDetails (WorkerDetails has no kycStatus field)
      if (kycType === "DELIVERY_PARTNER") {
        await prisma.deliveryDetails.updateMany({
          where: { userId: kyc!.userId },
          data: { kycStatus: newStatus as any },
        });
      }

      if (newStatus === "APPROVED") {
        await prisma.user.update({
          where: { id: kyc!.userId },
          data: { status: "ACTIVE" },
        });
      } else if (newStatus === "REJECTED") {
        await prisma.user.update({
          where: { id: kyc!.userId },
          data: { status: "PENDING" },
        });
      }
    }
  }
}

// --- VALIDATION SCHEMAS ---
export const createWorkerKYCSchema = z.object({
  body: z
    .object({
      fullName: z.string().min(1, "Full name is required"),
      fatherName: z.string().min(1, "Father name is required"),
      dateOfBirth: z.string().refine((date) => !isNaN(Date.parse(date)), {
        message: "Invalid date",
      }),
      gender: z.string(),
      language: z.string().min(1, "Language is required").optional(),
      phone: z.string().min(10, "Valid phone required"),
      email: z.string().email(),
      address: z.string().min(1, "Address is required"),
      state: z.string().min(1, "State is required"),
      city: z.string().min(1, "City is required"),
      pincode: z.string().min(6, "Valid pincode required"),
      skillId: z.string().optional(),
      skillCategory: z.string().optional(),
      experienceYears: z.number().nonnegative(),
      description: z.string().optional(),
    })
    .refine((data) => data.skillId || data.skillCategory, {
      message: "Skill selection is required",
      path: ["skillId"],
    }),
});

export const createVendorKYCSchema = z.object({
  body: z.object({
    businessName: z.string().min(1, "Business name is required"),
    ownerName: z.string().min(1, "Owner name is required"),
    businessType: z.string(),
    businessAddress: z.string().min(1, "Address is required"),
    state: z.string().min(1, "State is required"),
    city: z.string().min(1, "City is required"),
    pincode: z.string().min(6, "Valid pincode required"),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    monthlySupplyCapacity: z.string().optional(),
    warehouseDetails: z.string().optional(),
  }),
});

export const uploadDocumentSchema = z.object({
  body: z.object({
    documentType: z.string().min(1, "Document type is required"),
    documentUrl: z.string().min(1, "Document URL is required").optional(),
    documentNumber: z.string().optional(),
  }),
});

export const rejectDocumentSchema = z.object({
  body: z.object({
    rejectionReason: z.string().min(1, "Rejection reason is required"),
  }),
});

export const rejectKYCSchema = z.object({
  body: z.object({
    reason: z.string().min(1, "Reason is required"),
  }),
});

export const requestCorrectionSchema = z.object({
  body: z.object({
    reason: z.string().min(1, "Reason is required"),
  }),
});

export const updateWorkerBasicDetailsSchema = z.object({
  body: z.object({
    fullName: z.string().min(1, "Full name is required"),
    dateOfBirth: z
      .string()
      .refine((date) => !isNaN(Date.parse(date)), { message: "Invalid date" }),
    gender: z.string().min(1, "Gender is required"),
    language: z.string().min(1, "Language is required"),
    phone: z.string().min(10, "Valid phone required").optional(),
    email: z.string().email().optional(),
    address: z.string().trim().max(500).optional(),
    state: z.string().optional(),
    city: z.string().optional(),
    pincode: z.string().optional(),
    about: z.string().optional(),
  }),
});

export const updateDeliveryPartnerBasicDetailsSchema = z.object({
  body: z
    .object({
      fullName: z.string().min(1, "Full name is required"),
      email: z.string().email().optional(),
      mobileNumber: z
        .string()
        .min(10, "Valid mobile number required")
        .optional(),
      dateOfBirth: z
        .string()
        .refine((date) => !isNaN(Date.parse(date)), { message: "Invalid date" })
        .optional(),
      gender: z.string().min(1, "Gender is required").optional(),
      language: z.string().optional(),
      currentAddress: z.string().trim().max(500).optional(),
      permanentAddress: z.string().trim().max(500).optional(),
      address: z.string().optional(),
      city: z.string().trim().max(100).optional(),
      state: z.string().trim().max(100).optional(),
      country: z.string().trim().max(100).optional(),
      pincode: z.string().trim().min(3).max(12).optional(),
      latitude: z.number().finite().min(-90).max(90).optional(),
      longitude: z.number().finite().min(-180).max(180).optional(),
      about: z.string().optional(),
      profilePhotoUrl: z.string().optional(),
    })
    .refine(
      (data) =>
        (data.latitude === undefined) === (data.longitude === undefined),
      {
        message: "Latitude and longitude must be provided together",
        path: ["latitude"],
      },
    )
    .refine((data) => !(data.latitude === 0 && data.longitude === 0), {
      message: "Latitude and longitude cannot both be zero",
      path: ["latitude"],
    }),
});

export const updateDeliveryPartnerIdentityDocumentsSchema = z.object({
  body: z.object({
    aadhaarNumber: z.string().optional(),
    panNumber: z.string().optional(),
    drivingLicenseNo: z.string().optional(),
    aadhaarFrontUrl: z.string().optional(),
    aadhaarBackUrl: z.string().optional(),
    panImageUrl: z.string().optional(),
    drivingLicenseFrontUrl: z.string().optional(),
    drivingLicenseBackUrl: z.string().optional(),
  }),
});

export const updateDeliveryPartnerBankDetailsSchema = z.object({
  body: z
    .object({
      accountHolderName: z.string().min(1, "Account holder name is required"),
      accountNumber: z.string().min(1, "Account number is required"),
      confirmAccountNumber: z.string().optional(),
      ifscCode: z.string().min(1, "IFSC code is required"),
      bankName: z.string().optional(),
      branchName: z.string().optional(),
      bankPassbookUrl: z.string().optional(),
    })
    .refine(
      (data) =>
        !data.confirmAccountNumber ||
        data.confirmAccountNumber === data.accountNumber,
      {
        message: "Confirm account number must match account number",
        path: ["confirmAccountNumber"],
      },
    ),
});

export const updateDeliveryPartnerVehicleDocumentsSchema = z.object({
  body: z.object({
    vehicleType: z.string().optional(),
    maxLoadKg: z.number().finite().positive().optional(),
    vehicleNumber: z.string().optional(),
    rcUrl: z.string().optional(),
    insuranceUrl: z.string().optional(),
    pollutionCertificateUrl: z.string().optional(),
  }),
});

export const updateWorkerBankDetailsSchema = z.object({
  body: z.object({
    bankAccountName: z.string().min(1, "Account holder name is required"),
    bankAccountNumber: z.string().min(1, "Account number is required"),
    bankIfscCode: z.string().min(1, "IFSC code is required"),
  }),
});

export const updateWorkerAddressSchema = z.object({
  body: z.object({
    address: z.string().min(1, "Address is required"),
    state: z.string().min(1, "State is required"),
    city: z.string().min(1, "City is required"),
    pincode: z.string().min(6, "Valid pincode required"),
  }),
});

export const updateWorkerExperienceSchema = z.object({
  body: z.object({
    skillId: z.string().optional(),
    skillCategory: z.string().optional(),
    skillServiceIds: z.preprocess((val) => {
      if (val === undefined || val === null || val === "") return undefined;
      if (Array.isArray(val)) return val;
      if (typeof val === "string") {
        const trimmed = val.trim();
        if (!trimmed) return undefined;
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed;
        } catch (error) {
          // Comma-separated multipart values are accepted.
        }
        return trimmed
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return val;
    }, z.array(z.string()).optional()),
    experienceYears: z.preprocess(
      (val) => Number(val),
      z.number().nonnegative(),
    ),
    previousCompany: z.string().optional(),
    dailyWageExpectation: z
      .preprocess((val) => Number(val), z.number().min(0))
      .optional(),
  }),
});

export const updateWorkerSkillSelectionSchema = z.object({
  body: z
    .object({
      skillId: z.string().optional(),
      skillCategory: z.string().optional(),
    })
    .refine((data) => data.skillId || data.skillCategory, {
      message: "Skill selection is required",
      path: ["skillId"],
    }),
});

export const updateWorkerAvailabilitySchema = z.object({
  body: z.object({
    availabilityMode: z.enum(["FULL_TIME", "PART_TIME"]),
    immediateJoining: z.preprocess(
      (val) => val === "true" || val === true,
      z.boolean(),
    ),
    workingRadiusKm: z.preprocess(
      (val) => Number(val),
      z.number().int().positive(),
    ),
  }),
});

export const updateWorkerPoliceVerificationSchema = z.object({
  body: z.object({
    policeVerificationOpt: z.enum(["UPLOAD", "PLATFORM"]),
  }),
});

export const updateWorkerOnboardingSchema = z.object({
  body: z.object({
    fullName: z.string().min(1, "Full name is required").optional(),
    dateOfBirth: z
      .string()
      .refine((date) => !isNaN(Date.parse(date)), { message: "Invalid date" })
      .optional(),
    gender: z.string().min(1, "Gender is required").optional(),
    language: z.string().min(1, "Language is required").optional(),
    phone: z.string().min(10, "Valid phone required").optional(),
    email: z.string().email().optional(),
    address: z.string().min(1, "Address is required").optional(),
    state: z.string().min(1, "State is required").optional(),
    city: z.string().min(1, "City is required").optional(),
    pincode: z.string().min(6, "Valid pincode required").optional(),
    bankAccountName: z
      .string()
      .min(1, "Account holder name is required")
      .optional(),
    bankAccountNumber: z
      .string()
      .min(1, "Account number is required")
      .optional(),
    bankIfscCode: z.string().min(1, "IFSC code is required").optional(),
    policeVerificationOpt: z.enum(["UPLOAD", "PLATFORM"]).optional(),
    skillId: z.string().optional(),
    skillCategory: z.string().optional(),
    experienceYears: z.number().nonnegative().optional(),
    previousCompany: z.string().optional(),
    dailyWageExpectation: z.number().min(0).optional(),
    availabilityMode: z.enum(["FULL_TIME", "PART_TIME"]).optional(),
    immediateJoining: z.boolean().optional(),
    workingRadiusKm: z.number().int().positive().optional(),
  }),
});

export const updateVendorBusinessDetailsSchema = z.object({
  body: z.object({
    businessName: z.string().min(1, "Business name is required"),
    ownerName: z.string().min(1, "Owner name is required"),
    businessType: z.string().min(1, "Business type is required"),
    language: z.string().optional(),
    businessAddress: z.string().optional(),
    state: z.string().optional(),
    city: z.string().optional(),
    pincode: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    monthlySupplyCapacity: z.string().optional(),
    warehouseDetails: z.string().optional(),
  }),
});

export const updateVendorBankDetailsSchema = z.object({
  body: z.object({
    bankAccountName: z.string().min(1, "Account holder name is required"),
    bankAccountNumber: z.string().min(1, "Account number is required"),
    bankIfscCode: z.string().min(1, "IFSC code is required"),
  }),
});

export const updateVendorAddressSchema = z.object({
  body: z.object({
    businessAddress: z.string().min(1, "Business address is required"),
    state: z.string().min(1, "State is required"),
    city: z.string().min(1, "City is required"),
    pincode: z.string().min(6, "Valid pincode required"),
    warehouseDetails: z.string().optional(),
  }),
});

export const updateVendorExperienceSchema = z.object({
  body: z.object({
    yearsInBusiness: z.number().nonnegative(),
    previousProjects: z.any().optional(),
  }),
});
