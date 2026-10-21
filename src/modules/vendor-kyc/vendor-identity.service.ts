import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  VendorIdentityDocumentStatus,
  VendorKycStatus,
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/errors";

type DocumentPolicy = {
  enabled: boolean;
  required: boolean;
  numberRequired: boolean;
  nameRequired: boolean;
  frontRequired: boolean;
  backRequired: boolean;
  numberPattern?: string;
};
type Policy = { documents: Record<string, DocumentPolicy> };
type StoredFiles = {
  frontImage?: Express.Multer.File;
  backImage?: Express.Multer.File;
};

const defaultPolicy: Policy = {
  documents: {
    AADHAAR: {
      enabled: true,
      required: false,
      numberRequired: false,
      nameRequired: false,
      frontRequired: false,
      backRequired: false,
    },
    PAN: {
      enabled: true,
      required: false,
      numberRequired: false,
      nameRequired: false,
      frontRequired: false,
      backRequired: false,
    },
  },
};

function getPolicy(): Policy {
  if (!env.VENDOR_KYC_DOCUMENT_POLICY) return defaultPolicy;
  try {
    const parsed = JSON.parse(env.VENDOR_KYC_DOCUMENT_POLICY) as Policy;
    if (!parsed.documents || typeof parsed.documents !== "object")
      throw new Error();
    for (const [type, rule] of Object.entries(parsed.documents)) {
      if (
        !/^[A-Z][A-Z0-9_]{1,39}$/.test(type) ||
        typeof rule.enabled !== "boolean"
      )
        throw new Error();
      if (rule.numberPattern) new RegExp(rule.numberPattern);
    }
    return parsed;
  } catch {
    throw new AppError(
      500,
      "INVALID_KYC_POLICY",
      "Vendor KYC document policy is invalid",
    );
  }
}

function encryptNumber(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function decryptNumber(value: string): string {
  const [encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (!encodedIv || !encodedTag || !encodedCiphertext)
    throw new AppError(
      500,
      "KYC_DATA_INVALID",
      "Encrypted KYC data is invalid",
    );
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptionKey(): Buffer {
  if (!env.KYC_DOCUMENT_ENCRYPTION_KEY) {
    throw new AppError(
      503,
      "KYC_ENCRYPTION_UNAVAILABLE",
      "Secure KYC document storage is not configured",
    );
  }
  return Buffer.from(env.KYC_DOCUMENT_ENCRYPTION_KEY, "hex");
}

async function encryptFile(file: Express.Multer.File) {
  const key = encryptionKey();
  const source = file.buffer;
  const validSignature =
    (file.mimetype === "image/jpeg" &&
      source.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) ||
    (file.mimetype === "image/png" &&
      source
        .subarray(0, 8)
        .equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        )) ||
    (file.mimetype === "image/webp" &&
      source.toString("ascii", 0, 4) === "RIFF" &&
      source.toString("ascii", 8, 12) === "WEBP") ||
    (file.mimetype === "application/pdf" &&
      source.toString("ascii", 0, 5) === "%PDF-");
  if (!validSignature)
    throw new AppError(
      400,
      "INVALID_UPLOAD",
      "Uploaded file content does not match its media type",
    );
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(source), cipher.final()]);
  const storageKey = `${randomBytes(24).toString("hex")}.enc`;
  const target = path.resolve(
    process.cwd(),
    "storage",
    "private",
    "vendor-kyc",
    storageKey,
  );
  await fs.writeFile(
    target,
    Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
    { mode: 0o600, flag: "wx" },
  );
  return { storageKey, mimeType: file.mimetype, target };
}

async function decryptFile(storageKey: string) {
  if (!/^[a-f0-9]{48}\.enc$/.test(storageKey)) {
    throw new AppError(
      404,
      "DOCUMENT_FILE_NOT_FOUND",
      "Document image not found",
    );
  }
  const filePath = path.resolve(
    process.cwd(),
    "storage",
    "private",
    "vendor-kyc",
    storageKey,
  );
  const payload = await fs.readFile(filePath).catch(() => {
    throw new AppError(
      404,
      "DOCUMENT_FILE_NOT_FOUND",
      "Document image not found",
    );
  });
  if (payload.length < 29) {
    throw new AppError(
      500,
      "DOCUMENT_FILE_INVALID",
      "Stored KYC file is invalid",
    );
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    payload.subarray(0, 12),
  );
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([
    decipher.update(payload.subarray(28)),
    decipher.final(),
  ]);
}

function maskNumber(value: string): string {
  const normalized = value.replace(/\s+/g, "");
  return normalized.length <= 4
    ? "*".repeat(normalized.length)
    : `${"*".repeat(normalized.length - 4)}${normalized.slice(-4)}`;
}

function missingKeys(value: unknown, keys: string[]): string[] {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return keys.filter((key) => {
    const field = record[key];
    return (
      field === undefined ||
      field === null ||
      (typeof field === "string" && !field.trim()) ||
      (Array.isArray(field) && field.length === 0)
    );
  });
}

function validateDocumentNumber(
  type: string,
  value: string,
  rule: DocumentPolicy,
) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  const pattern =
    type === "AADHAAR"
      ? /^\d{12}$/
      : type === "PAN"
        ? /^[A-Z]{5}\d{4}[A-Z]$/
        : rule.numberPattern
          ? new RegExp(rule.numberPattern)
          : null;
  if (pattern && !pattern.test(normalized)) {
    throw new AppError(
      400,
      "INVALID_DOCUMENT_NUMBER",
      `Document number format is invalid for ${type}`,
    );
  }
  return normalized;
}

function serializeDocument(
  document: {
    id: string;
    documentType: string;
    maskedDocumentNumber: string | null;
    nameOnDocument: string | null;
    frontStorageKey: string | null;
    frontMimeType: string | null;
    backStorageKey: string | null;
    backMimeType: string | null;
    status: VendorIdentityDocumentStatus;
    adminFeedback: string | null;
    uploadedAt: Date;
    reviewedAt: Date | null;
    resubmittedAt: Date | null;
  },
  prefix = "/api/v1/vendor/kyc",
) {
  return {
    id: document.id,
    documentType: document.documentType,
    documentNumber: document.maskedDocumentNumber,
    nameOnDocument: document.nameOnDocument,
    frontImageAvailable: Boolean(document.frontStorageKey),
    backImageAvailable: Boolean(document.backStorageKey),
    frontImageEndpoint: document.frontStorageKey
      ? `${prefix}/documents/${document.id}/front`
      : null,
    backImageEndpoint: document.backStorageKey
      ? `${prefix}/documents/${document.id}/back`
      : null,
    status: document.status,
    adminFeedback: document.adminFeedback,
    uploadedAt: document.uploadedAt,
    reviewedAt: document.reviewedAt,
    resubmittedAt: document.resubmittedAt,
  };
}

export class VendorKycService {
  constructor(private readonly db: typeof prisma = prisma) {}

  getDocumentPolicy() {
    return {
      ...getPolicy(),
      bankDetailsRequired: env.VENDOR_KYC_BANK_DETAILS_REQUIRED,
    };
  }

  async saveStep(
    vendorUserId: string,
    step:
      | "personalDetails"
      | "addressDetails"
      | "professionalDetails"
      | "bankDetails",
    value: Record<string, unknown>,
  ) {
    if (step === "personalDetails") {
      const application = await this.db.vendorKycApplication.findUnique({
        where: { vendorUserId },
        select: { id: true, status: true },
      });
      if (
        application &&
        ["APPROVED", "PENDING_REVIEW"].includes(application.status)
      )
        throw new AppError(
          409,
          "KYC_NOT_EDITABLE",
          "KYC cannot be changed while approved or under review",
        );
      if (application) {
        const changed = await this.db.vendorKycApplication.updateMany({
          where: {
            id: application.id,
            status: { in: ["DRAFT", "REJECTED", "RESUBMISSION_REQUIRED"] },
          },
          data: { updatedAt: new Date() },
        });
        if (changed.count !== 1)
          throw new AppError(
            409,
            "KYC_NOT_EDITABLE",
            "KYC status changed; refresh before editing",
          );
      }
      await this.db.user.update({
        where: { id: vendorUserId },
        data: { displayName: value.fullName as string },
      });
      await this.db.auditLog.create({
        data: {
          actorUserId: vendorUserId,
          action: "vendor_kyc.personalDetails.saved",
          entityType: "User",
          entityId: vendorUserId,
        },
      });
      return { userId: vendorUserId, fullName: value.fullName };
    }
    if (step === "professionalDetails") {
      const selectedServices = Array.isArray(value.services)
        ? value.services.filter(
            (serviceId): serviceId is string => typeof serviceId === "string",
          )
        : [];
      if (selectedServices.length) {
        const activeServices = await this.db.repairService.findMany({
          where: { id: { in: selectedServices }, active: true },
          select: { id: true },
        });
        if (activeServices.length !== new Set(selectedServices).size)
          throw new AppError(
            400,
            "INVALID_SERVICES",
            "One or more selected repair services are unavailable",
          );
      }
    }
    const application = await this.db.vendorKycApplication.upsert({
      where: { vendorUserId },
      update: {},
      create: { vendorUserId },
    });
    if (["APPROVED", "PENDING_REVIEW"].includes(application.status))
      throw new AppError(
        409,
        "KYC_NOT_EDITABLE",
        "KYC cannot be changed while approved or under review",
      );
    const serialized = JSON.stringify(value);
    const payload = step === "bankDetails" ? encryptNumber(serialized) : value;
    const field = step === "bankDetails" ? "encryptedBankDetails" : step;
    const changed = await this.db.vendorKycApplication.updateMany({
      where: {
        id: application.id,
        status: { in: ["DRAFT", "REJECTED", "RESUBMISSION_REQUIRED"] },
      },
      data: { [field]: payload as never },
    });
    if (changed.count !== 1)
      throw new AppError(
        409,
        "KYC_NOT_EDITABLE",
        "KYC status changed; refresh before editing",
      );
    if (step === "professionalDetails") {
      const technician = await this.db.technicianProfile.upsert({
        where: { userId: vendorUserId },
        update: {},
        create: { userId: vendorUserId },
        select: { id: true },
      });
      await this.db.technicianSkill.deleteMany({
        where: { technicianId: technician.id },
      });
      await this.db.technicianSkill.createMany({
        data: (value.services as string[]).map((serviceId) => ({
          technicianId: technician.id,
          serviceId,
        })),
        skipDuplicates: true,
      });
    }
    const updated = await this.db.vendorKycApplication.findUniqueOrThrow({
      where: { id: application.id },
      select: { id: true, status: true, updatedAt: true },
    });
    await this.db.auditLog.create({
      data: {
        actorUserId: vendorUserId,
        action: `vendor_kyc.${step}.saved`,
        entityType: "VendorKycApplication",
        entityId: application.id,
      },
    });
    return updated;
  }

  async getStep(
    vendorUserId: string,
    step:
      | "personalDetails"
      | "addressDetails"
      | "professionalDetails"
      | "bankDetails",
  ) {
    if (step === "personalDetails") {
      const user = await this.db.user.findUnique({
        where: { id: vendorUserId },
        select: {
          email: true,
          phone: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          displayName: true,
          profileImage: true,
        },
      });
      if (!user) return null;
      return {
        fullName: user.displayName ?? null,
        email: user.email,
        phone: user.phone,
        emailVerifiedAt: user.emailVerifiedAt,
        phoneVerifiedAt: user.phoneVerifiedAt,
        profileImage: user.profileImage ?? null,
      };
    }
    const application = await this.db.vendorKycApplication.findUnique({
      where: { vendorUserId },
      select: {
        addressDetails: true,
        professionalDetails: true,
        encryptedBankDetails: true,
      },
    });
    if (!application) return null;
    if (step === "bankDetails") {
      if (!application.encryptedBankDetails) return null;
      const bank = JSON.parse(
        decryptNumber(application.encryptedBankDetails),
      ) as Record<string, string>;
      if (!bank.accountNumber)
        throw new AppError(
          500,
          "KYC_DATA_INVALID",
          "Encrypted bank details are incomplete",
        );
      return {
        accountHolderName: bank.accountHolderName,
        accountNumber: `****${bank.accountNumber.slice(-4)}`,
        ifscCode: bank.ifscCode,
        bankName: bank.bankName,
        branchName: bank.branchName,
      };
    }
    if (step === "professionalDetails") {
      const profile = await this.db.technicianProfile.findUnique({
        where: { userId: vendorUserId },
        include: {
          skills: {
            where: { service: { active: true } },
            include: { service: { select: { id: true, name: true } } },
          },
        },
      });
      const professional = application.professionalDetails as Record<
        string,
        unknown
      > | null;
      return {
        experienceYears: professional?.experienceYears ?? null,
        description: professional?.description ?? null,
        services: profile?.skills.map(({ service }) => service) ?? [],
      };
    }
    return application[step];
  }

  async getOwnStatus(vendorUserId: string) {
    const [application, user, technician] = await Promise.all([
      this.db.vendorKycApplication.findUnique({
        where: { vendorUserId },
        include: { documents: { orderBy: { createdAt: "desc" } } },
      }),
      this.db.user.findUnique({
        where: { id: vendorUserId },
        select: { displayName: true },
      }),
      this.db.technicianProfile.findUnique({
        where: { userId: vendorUserId },
        include: { skills: true },
      }),
    ]);
    const personalDetails = user?.displayName
      ? { fullName: user.displayName }
      : null;
    const professionalDetails = application?.professionalDetails as Record<
      string,
      unknown
    > | null;
    const professionalComplete = Boolean(
      professionalDetails?.experienceYears !== undefined &&
        technician?.skills.length,
    );
    if (!application) {
      const missingFields = [
        ...missingKeys(personalDetails, ["fullName"]).map(
          (key) => `personalDetails.${key}`,
        ),
        ...missingKeys(null, ["line1", "city", "state", "postalCode"]).map(
          (key) => `addressDetails.${key}`,
        ),
        ...(!professionalDetails?.experienceYears
          ? ["professionalDetails.experienceYears"]
          : []),
        ...(!technician?.skills.length ? ["professionalDetails.services"] : []),
        ...this.missingPolicyDocumentFields([]),
        ...(env.VENDOR_KYC_BANK_DETAILS_REQUIRED
          ? [
              "bankDetails.accountHolderName",
              "bankDetails.accountNumber",
              "bankDetails.ifscCode",
              "bankDetails.bankName",
            ]
          : []),
      ];
      return {
        id: null,
        status: "DRAFT" as const,
        submittedAt: null,
        reviewedAt: null,
        adminFeedback: null,
        documents: [],
        completedSteps: {
          personalDetails:
            missingKeys(personalDetails, ["fullName"]).length === 0,
          address:
            missingKeys(null, ["line1", "city", "state", "postalCode"])
              .length === 0,
          identity: this.missingPolicyDocumentFields([]).length === 0,
          professionalDetails: professionalComplete,
          bankDetails: !env.VENDOR_KYC_BANK_DETAILS_REQUIRED,
        },
        missingFields,
      };
    }
    const latestByType = new Map<
      string,
      (typeof application.documents)[number]
    >();
    for (const doc of [...application.documents].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    ))
      if (!latestByType.has(doc.documentType))
        latestByType.set(doc.documentType, doc);
    const missingFields = [
      ...missingKeys(personalDetails, ["fullName"]).map(
        (key) => `personalDetails.${key}`,
      ),
      ...missingKeys(application.addressDetails, [
        "line1",
        "city",
        "state",
        "postalCode",
      ]).map((key) => `addressDetails.${key}`),
      ...(!professionalDetails?.experienceYears
        ? ["professionalDetails.experienceYears"]
        : []),
      ...(!technician?.skills.length ? ["professionalDetails.services"] : []),
      ...this.missingPolicyDocumentFields([...latestByType.values()]),
      ...(env.VENDOR_KYC_BANK_DETAILS_REQUIRED &&
      !application.encryptedBankDetails
        ? [
            "bankDetails.accountHolderName",
            "bankDetails.accountNumber",
            "bankDetails.ifscCode",
            "bankDetails.bankName",
          ]
        : []),
    ];
    return {
      id: application.id,
      status: application.status,
      submittedAt: application.submittedAt,
      reviewedAt: application.reviewedAt,
      adminFeedback: application.adminFeedback,
      documents: application.documents.map((document) =>
        serializeDocument(document),
      ),
      completedSteps: {
        personalDetails:
          missingKeys(personalDetails, ["fullName"]).length === 0,
        address:
          missingKeys(application.addressDetails, [
            "line1",
            "city",
            "state",
            "postalCode",
          ]).length === 0,
        identity:
          this.missingPolicyDocumentFields([...latestByType.values()])
            .length === 0,
        professionalDetails: professionalComplete,
        bankDetails:
          !env.VENDOR_KYC_BANK_DETAILS_REQUIRED ||
          Boolean(application.encryptedBankDetails),
      },
      missingFields,
    };
  }

  private missingPolicyDocumentFields(
    documents: Array<{
      documentType: string;
      encryptedDocumentNumber: string | null;
      nameOnDocument: string | null;
      frontStorageKey: string | null;
      backStorageKey: string | null;
    }>,
  ) {
    const latest = new Map(
      documents.map((document) => [document.documentType, document]),
    );
    const missing: string[] = [];
    for (const [type, rule] of Object.entries(getPolicy().documents)) {
      if (!rule.enabled || !rule.required) continue;
      const document = latest.get(type);
      if (!document) {
        missing.push(`identity.${type}`);
        continue;
      }
      if (rule.numberRequired && !document.encryptedDocumentNumber)
        missing.push(`identity.${type}.documentNumber`);
      if (rule.nameRequired && !document.nameOnDocument)
        missing.push(`identity.${type}.nameOnDocument`);
      if (rule.frontRequired && !document.frontStorageKey)
        missing.push(`identity.${type}.frontImage`);
      if (rule.backRequired && !document.backStorageKey)
        missing.push(`identity.${type}.backImage`);
    }
    return missing;
  }

  async getIdentityStep(vendorUserId: string) {
    const application = await this.db.vendorKycApplication.findUnique({
      where: { vendorUserId },
      include: { documents: { orderBy: { createdAt: "desc" } } },
    });
    if (!application)
      return {
        documents: [],
        requiredDocumentTypes: Object.entries(getPolicy().documents)
          .filter(([, rule]) => rule.enabled && rule.required)
          .map(([type]) => type),
      };
    return {
      documents: application.documents.map((document) =>
        serializeDocument(document),
      ),
      requiredDocumentTypes: Object.entries(getPolicy().documents)
        .filter(([, rule]) => rule.enabled && rule.required)
        .map(([type]) => type),
    };
  }

  async uploadDocument(
    vendorUserId: string,
    input: {
      documentType: string;
      documentNumber?: string;
      nameOnDocument?: string;
    },
    files: StoredFiles,
  ) {
    const type = input.documentType.trim().toUpperCase();
    const rule = getPolicy().documents[type];
    if (!rule?.enabled)
      throw new AppError(
        400,
        "DOCUMENT_TYPE_NOT_ALLOWED",
        "This document type is not enabled by policy",
      );
    if (rule.numberRequired && !input.documentNumber)
      throw new AppError(
        400,
        "DOCUMENT_NUMBER_REQUIRED",
        "Document number is required by policy",
      );
    if (rule.nameRequired && !input.nameOnDocument?.trim())
      throw new AppError(
        400,
        "DOCUMENT_NAME_REQUIRED",
        "Name on document is required by policy",
      );
    if (rule.frontRequired && !files.frontImage)
      throw new AppError(
        400,
        "FRONT_IMAGE_REQUIRED",
        "Front image is required by policy",
      );
    if (rule.backRequired && !files.backImage)
      throw new AppError(
        400,
        "BACK_IMAGE_REQUIRED",
        "Back image is required by policy",
      );
    if (input.documentNumber && input.documentNumber.length > 64)
      throw new AppError(
        400,
        "INVALID_DOCUMENT_NUMBER",
        "Document number is too long",
      );
    if (input.nameOnDocument && input.nameOnDocument.trim().length > 160)
      throw new AppError(
        400,
        "INVALID_DOCUMENT_NAME",
        "Name on document is too long",
      );
    const normalizedNumber = input.documentNumber
      ? validateDocumentNumber(type, input.documentNumber, rule)
      : undefined;
    const application = await this.db.vendorKycApplication.upsert({
      where: { vendorUserId },
      update: {},
      create: { vendorUserId },
    });
    if (["APPROVED", "PENDING_REVIEW"].includes(application.status)) {
      throw new AppError(
        409,
        "KYC_NOT_EDITABLE",
        "Documents cannot be changed while KYC is under review or approved",
      );
    }
    const latest = await this.db.vendorIdentityDocument.findFirst({
      where: { kycApplicationId: application.id, documentType: type },
      orderBy: { createdAt: "desc" },
    });
    const encryptedFiles: Awaited<ReturnType<typeof encryptFile>>[] = [];
    try {
      if (files.frontImage)
        encryptedFiles.push(await encryptFile(files.frontImage));
      if (files.backImage)
        encryptedFiles.push(await encryptFile(files.backImage));
    } catch (error) {
      await Promise.all(
        encryptedFiles.map((file) =>
          fs.unlink(file.target).catch(() => undefined),
        ),
      );
      throw error;
    }
    let encryptedFileIndex = 0;
    const frontFile = files.frontImage
      ? encryptedFiles[encryptedFileIndex++]
      : undefined;
    const backFile = files.backImage
      ? encryptedFiles[encryptedFileIndex]
      : undefined;
    const now = new Date();
    let document;
    try {
      document = await this.db.$transaction(async (tx) => {
        const applicationChanged = await tx.vendorKycApplication.updateMany({
          where: {
            id: application.id,
            status: { in: ["DRAFT", "REJECTED", "RESUBMISSION_REQUIRED"] },
          },
          data: { updatedAt: now },
        });
        if (applicationChanged.count !== 1)
          throw new AppError(
            409,
            "KYC_NOT_EDITABLE",
            "KYC status changed; refresh before editing",
          );
        const created = await tx.vendorIdentityDocument.create({
          data: {
            kycApplicationId: application.id,
            documentType: type,
            ...(normalizedNumber
              ? {
                  encryptedDocumentNumber: encryptNumber(normalizedNumber),
                  maskedDocumentNumber: maskNumber(normalizedNumber),
                }
              : latest?.encryptedDocumentNumber
                ? {
                    encryptedDocumentNumber: latest.encryptedDocumentNumber,
                    maskedDocumentNumber: latest.maskedDocumentNumber,
                  }
                : {}),
            ...(input.nameOnDocument?.trim()
              ? { nameOnDocument: input.nameOnDocument.trim() }
              : latest?.nameOnDocument
                ? { nameOnDocument: latest.nameOnDocument }
                : {}),
            ...(frontFile
              ? {
                  frontStorageKey: frontFile.storageKey,
                  frontMimeType: frontFile.mimeType,
                }
              : latest?.frontStorageKey
                ? {
                    frontStorageKey: latest.frontStorageKey,
                    frontMimeType: latest.frontMimeType,
                  }
                : {}),
            ...(backFile
              ? {
                  backStorageKey: backFile.storageKey,
                  backMimeType: backFile.mimeType,
                }
              : latest?.backStorageKey
                ? {
                    backStorageKey: latest.backStorageKey,
                    backMimeType: latest.backMimeType,
                  }
                : {}),
            status: "PENDING",
            ...(latest ? { resubmittedAt: now } : {}),
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: vendorUserId,
            action: latest
              ? "vendor_kyc.document.resubmitted"
              : "vendor_kyc.document.uploaded",
            entityType: "VendorIdentityDocument",
            entityId: created.id,
            metadata: { documentType: type },
          },
        });
        return created;
      });
    } catch (error) {
      await Promise.all(
        encryptedFiles.map((file) =>
          fs.unlink(file.target).catch(() => undefined),
        ),
      );
      throw error;
    }
    return serializeDocument(document);
  }

  async submit(vendorUserId: string) {
    const [application, user, technician] = await Promise.all([
      this.db.vendorKycApplication.findUnique({
        where: { vendorUserId },
        include: { documents: true },
      }),
      this.db.user.findUnique({
        where: { id: vendorUserId },
        select: { displayName: true },
      }),
      this.db.technicianProfile.findUnique({
        where: { userId: vendorUserId },
        include: { skills: true },
      }),
    ]);
    if (!application)
      throw new AppError(
        404,
        "KYC_DRAFT_NOT_FOUND",
        "Upload a required identity document before submission",
      );
    if (
      application.status === "APPROVED" ||
      application.status === "PENDING_REVIEW"
    )
      throw new AppError(
        409,
        "KYC_NOT_SUBMITTABLE",
        "KYC is already approved or under review",
      );
    const missingStepFields = [
      ...missingKeys(
        user?.displayName ? { fullName: user.displayName } : null,
        ["fullName"],
      ).map((key) => `personalDetails.${key}`),
      ...missingKeys(application.addressDetails, [
        "line1",
        "city",
        "state",
        "postalCode",
      ]).map((key) => `addressDetails.${key}`),
      ...(!(application.professionalDetails as Record<string, unknown> | null)
        ?.experienceYears
        ? ["professionalDetails.experienceYears"]
        : []),
      ...(!technician?.skills.length ? ["professionalDetails.services"] : []),
      ...(env.VENDOR_KYC_BANK_DETAILS_REQUIRED &&
      !application.encryptedBankDetails
        ? [
            "bankDetails.accountHolderName",
            "bankDetails.accountNumber",
            "bankDetails.ifscCode",
            "bankDetails.bankName",
          ]
        : []),
    ];
    if (missingStepFields.length)
      throw new AppError(
        400,
        "KYC_STEPS_INCOMPLETE",
        `Complete required onboarding fields: ${missingStepFields.join(", ")}`,
      );
    const policy = getPolicy();
    const latestByType = new Map<
      string,
      (typeof application.documents)[number]
    >();
    for (const doc of application.documents.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    ))
      if (!latestByType.has(doc.documentType))
        latestByType.set(doc.documentType, doc);
    const missing = Object.entries(policy.documents)
      .filter(([, rule]) => rule.enabled && rule.required)
      .map(([type]) => type)
      .filter((type) => !latestByType.has(type));
    if (missing.length)
      throw new AppError(
        400,
        "KYC_DOCUMENTS_MISSING",
        `Required documents missing: ${missing.join(", ")}`,
      );
    for (const [type, rule] of Object.entries(policy.documents)) {
      if (!rule.enabled || !rule.required) continue;
      const doc = latestByType.get(type)!;
      if (
        (rule.numberRequired && !doc.encryptedDocumentNumber) ||
        (rule.nameRequired && !doc.nameOnDocument) ||
        (rule.frontRequired && !doc.frontStorageKey) ||
        (rule.backRequired && !doc.backStorageKey)
      ) {
        throw new AppError(
          400,
          "KYC_DOCUMENT_INCOMPLETE",
          `Required details are missing for ${type}`,
        );
      }
    }
    const updated = await this.db.$transaction(async (tx) => {
      const changed = await tx.vendorKycApplication.updateMany({
        where: {
          id: application.id,
          status: { in: ["DRAFT", "REJECTED", "RESUBMISSION_REQUIRED"] },
        },
        data: {
          status: "PENDING_REVIEW",
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedById: null,
        },
      });
      if (changed.count !== 1)
        throw new AppError(
          409,
          "KYC_STATE_CONFLICT",
          "KYC status changed; refresh and try again",
        );
      await tx.vendorKycReviewLog.create({
        data: {
          applicationId: application.id,
          reviewerUserId: vendorUserId,
          action: "SUBMITTED",
          previousStatus: application.status,
          newStatus: "PENDING_REVIEW",
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: vendorUserId,
          action: "vendor_kyc.application.submitted",
          entityType: "VendorKycApplication",
          entityId: application.id,
        },
      });
      return tx.vendorKycApplication.findUniqueOrThrow({
        where: { id: application.id },
      });
    });
    return {
      id: updated.id,
      status: updated.status,
      submittedAt: updated.submittedAt,
    };
  }

  async listApplications(query?: {
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query?.page ?? 1);
    const limit = Math.min(100, Math.max(1, query?.limit ?? 20));
    const where = query?.status
      ? { status: query.status as VendorKycStatus }
      : {};
    const [items, total] = await Promise.all([
      this.db.vendorKycApplication.findMany({
        where,
        orderBy: { submittedAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          vendorUserId: true,
          status: true,
          submittedAt: true,
          reviewedAt: true,
          updatedAt: true,
          _count: { select: { documents: true } },
        },
      }),
      this.db.vendorKycApplication.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** @deprecated Use listApplications with status filter instead */
  async listPending() {
    const result = await this.listApplications({ status: "PENDING_REVIEW" });
    return result.items;
  }

  async getAdminDetail(applicationId: string, reviewerUserId: string) {
    const application = await this.db.vendorKycApplication.findUnique({
      where: { id: applicationId },
      include: {
        vendor: {
          select: {
            id: true,
            email: true,
            phone: true,
            emailVerifiedAt: true,
            phoneVerifiedAt: true,
            displayName: true,
            profileImage: true,
            technicianProfile: {
              include: {
                skills: {
                  include: { service: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
        documents: { orderBy: { createdAt: "desc" } },
        reviewLogs: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            action: true,
            previousStatus: true,
            newStatus: true,
            feedback: true,
            createdAt: true,
            reviewerUserId: true,
            documentId: true,
          },
        },
      },
    });
    if (!application)
      throw new AppError(
        404,
        "KYC_NOT_FOUND",
        "Vendor KYC application not found",
      );
    let bankDetails: Record<string, string> | null = null;
    if (application.encryptedBankDetails) {
      bankDetails = JSON.parse(
        decryptNumber(application.encryptedBankDetails),
      ) as Record<string, string>;
      await this.db.auditLog.create({
        data: {
          actorUserId: reviewerUserId,
          action: "vendor_kyc.bank_details.accessed",
          entityType: "VendorKycApplication",
          entityId: application.id,
        },
      });
    }
    return {
      id: application.id,
      vendor: application.vendor,
      onboarding: {
        personalDetails: {
          fullName: application.vendor.displayName ?? null,
          email: application.vendor.email,
          phone: application.vendor.phone,
          emailVerifiedAt: application.vendor.emailVerifiedAt,
          phoneVerifiedAt: application.vendor.phoneVerifiedAt,
          profileImage: application.vendor.profileImage ?? null,
        },
        addressDetails: application.addressDetails,
        professionalDetails: {
          ...(application.professionalDetails as Record<
            string,
            unknown
          > | null),
          services:
            application.vendor.technicianProfile?.skills.map(
              ({ service }) => service,
            ) ?? [],
        },
        bankDetails,
      },
      status: application.status,
      submittedAt: application.submittedAt,
      reviewedAt: application.reviewedAt,
      adminFeedback: application.adminFeedback,
      documents: application.documents.map((document) =>
        serializeDocument(document, "/api/v1/admin/vendor-kyc"),
      ),
      reviewHistory: application.reviewLogs,
    };
  }

  async reviewDocument(
    documentId: string,
    reviewerUserId: string,
    status: VendorIdentityDocumentStatus,
    feedback?: string,
  ) {
    if (status !== "APPROVED" && !feedback?.trim())
      throw new AppError(
        400,
        "FEEDBACK_REQUIRED",
        "Feedback is required when rejecting or requesting resubmission",
      );
    const current = await this.db.vendorIdentityDocument.findUnique({
      where: { id: documentId },
    });
    if (!current)
      throw new AppError(404, "DOCUMENT_NOT_FOUND", "KYC document not found");
    const parent = await this.db.vendorKycApplication.findUnique({
      where: { id: current.kycApplicationId },
    });
    if (!parent || parent.status !== "PENDING_REVIEW")
      throw new AppError(
        409,
        "KYC_NOT_REVIEWABLE",
        "Only submitted KYC documents can be reviewed",
      );
    const updated = await this.db.$transaction(async (tx) => {
      const changed = await tx.vendorIdentityDocument.updateMany({
        where: { id: documentId, status: "PENDING" },
        data: {
          status,
          adminFeedback: feedback ?? null,
          reviewedAt: new Date(),
        },
      });
      if (changed.count !== 1)
        throw new AppError(
          409,
          "DOCUMENT_ALREADY_REVIEWED",
          "Document status changed; refresh before reviewing",
        );
      await tx.vendorKycReviewLog.create({
        data: {
          applicationId: current.kycApplicationId,
          documentId,
          reviewerUserId,
          action: `DOCUMENT_${status}`,
          previousStatus: current.status,
          newStatus: status,
          feedback: feedback ?? null,
        },
      });
      if (status === "REJECTED" || status === "RESUBMISSION_REQUIRED") {
        const parentChanged = await tx.vendorKycApplication.updateMany({
          where: {
            id: current.kycApplicationId,
            status: "PENDING_REVIEW",
          },
          data: {
            status: "RESUBMISSION_REQUIRED",
            reviewedAt: new Date(),
            reviewedById: reviewerUserId,
            adminFeedback: feedback ?? null,
          },
        });
        if (parentChanged.count !== 1)
          throw new AppError(
            409,
            "KYC_STATE_CONFLICT",
            "Application status changed; refresh and try again",
          );
        await tx.vendorKycReviewLog.create({
          data: {
            applicationId: current.kycApplicationId,
            reviewerUserId,
            action: "APPLICATION_RESUBMISSION_REQUIRED",
            previousStatus: "PENDING_REVIEW",
            newStatus: "RESUBMISSION_REQUIRED",
            feedback: feedback ?? null,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: reviewerUserId,
          action: "vendor_kyc.document.reviewed",
          entityType: "VendorIdentityDocument",
          entityId: documentId,
          metadata: { status },
        },
      });
      return tx.vendorIdentityDocument.findUniqueOrThrow({
        where: { id: documentId },
      });
    });
    return serializeDocument(updated);
  }

  async reviewApplication(
    applicationId: string,
    reviewerUserId: string,
    status: Extract<
      VendorKycStatus,
      "APPROVED" | "REJECTED" | "RESUBMISSION_REQUIRED"
    >,
    feedback?: string,
  ) {
    const application = await this.db.vendorKycApplication.findUnique({
      where: { id: applicationId },
      include: { documents: true },
    });
    if (!application)
      throw new AppError(
        404,
        "KYC_NOT_FOUND",
        "Vendor KYC application not found",
      );
    if (application.status !== "PENDING_REVIEW")
      throw new AppError(
        409,
        "KYC_NOT_REVIEWABLE",
        "Only submitted applications can be reviewed",
      );
    if (status !== "APPROVED" && !feedback?.trim())
      throw new AppError(
        400,
        "FEEDBACK_REQUIRED",
        "Feedback is required when rejecting or requesting resubmission",
      );
    if (status === "APPROVED") {
      const policy = getPolicy();
      const latest = new Map<string, (typeof application.documents)[number]>();
      for (const document of application.documents.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      ))
        if (!latest.has(document.documentType))
          latest.set(document.documentType, document);
      const missing = Object.entries(policy.documents)
        .filter(([, rule]) => rule.enabled && rule.required)
        .map(([type]) => type)
        .filter((type) => latest.get(type)?.status !== "APPROVED");
      const outstanding = [...latest.values()].some(
        (doc) => doc.status !== "APPROVED",
      );
      if (missing.length || outstanding)
        throw new AppError(
          409,
          "DOCUMENTS_NOT_APPROVED",
          "All required and uploaded documents must be approved first",
        );
    }
    return this.db.$transaction(async (tx) => {
      const changed = await tx.vendorKycApplication.updateMany({
        where: { id: applicationId, status: "PENDING_REVIEW" },
        data: {
          status,
          reviewedAt: new Date(),
          reviewedById: reviewerUserId,
          adminFeedback: feedback ?? null,
        },
      });
      if (changed.count !== 1)
        throw new AppError(
          409,
          "KYC_STATE_CONFLICT",
          "Application status changed; refresh and try again",
        );
      // Sync TechnicianProfile.approvedAt so booking assignment eligibility
      // reflects the KYC decision without a separate approval step.
      if (status === "APPROVED") {
        await tx.technicianProfile.updateMany({
          where: { userId: application.vendorUserId, approvedAt: null },
          data: { approvedAt: new Date() },
        });
      } else {
        await tx.technicianProfile.updateMany({
          where: { userId: application.vendorUserId },
          data: { approvedAt: null },
        });
      }
      await tx.vendorKycReviewLog.create({
        data: {
          applicationId,
          reviewerUserId,
          action: `APPLICATION_${status}`,
          previousStatus: application.status,
          newStatus: status,
          feedback: feedback ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: reviewerUserId,
          action: "vendor_kyc.application.reviewed",
          entityType: "VendorKycApplication",
          entityId: applicationId,
          metadata: { status },
        },
      });
      return tx.vendorKycApplication.findUniqueOrThrow({
        where: { id: applicationId },
      });
    });
  }

  async getDocumentForAccess(
    documentId: string,
    actorUserId: string,
    isAdmin: boolean,
    side: "front" | "back",
  ) {
    const document = await this.db.vendorIdentityDocument.findUnique({
      where: { id: documentId },
      include: { application: { select: { vendorUserId: true } } },
    });
    if (!document)
      throw new AppError(404, "DOCUMENT_NOT_FOUND", "KYC document not found");
    if (!isAdmin && document.application.vendorUserId !== actorUserId)
      throw new AppError(404, "DOCUMENT_NOT_FOUND", "KYC document not found");
    const key =
      side === "front" ? document.frontStorageKey : document.backStorageKey;
    if (!key)
      throw new AppError(
        404,
        "DOCUMENT_FILE_NOT_FOUND",
        "Document image not found",
      );
    if (isAdmin)
      await this.db.auditLog.create({
        data: {
          actorUserId,
          action: "vendor_kyc.document.accessed",
          entityType: "VendorIdentityDocument",
          entityId: document.id,
          metadata: { side },
        },
      });
    const contentType =
      side === "front" ? document.frontMimeType : document.backMimeType;
    return {
      buffer: await decryptFile(key),
      contentType: contentType ?? "application/octet-stream",
    };
  }
}
