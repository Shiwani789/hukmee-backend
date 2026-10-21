import { env } from "../src/config/env";
import { VendorKycService } from "../src/modules/vendor-kyc/vendor-identity.service";

const encryptionKey = "a".repeat(64);

describe("Vendor KYC step persistence and submission", () => {
  const oldKey = env.KYC_DOCUMENT_ENCRYPTION_KEY;

  beforeAll(() => {
    env.KYC_DOCUMENT_ENCRYPTION_KEY = encryptionKey;
    env.VENDOR_KYC_BANK_DETAILS_REQUIRED = false;
  });

  afterAll(() => {
    env.KYC_DOCUMENT_ENCRYPTION_KEY = oldKey;
  });

  it("saves each step without submitting and retrieves bank details masked", async () => {
    const writes: Record<string, unknown>[] = [];
    const db = {
      vendorKycApplication: {
        upsert: jest
          .fn()
          .mockResolvedValue({ id: "application-1", status: "DRAFT" }),
        updateMany: jest.fn(async ({ data }) => {
          writes.push(data);
          return { count: 1 };
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: "application-1",
          status: "DRAFT",
          updatedAt: new Date(),
        }),
        findUnique: jest.fn(async () => ({
          addressDetails: {
            line1: "1 Main Road",
            city: "Pune",
            state: "Maharashtra",
            postalCode: "411001",
          },
          professionalDetails: {
            experienceYears: 3,
          },
          encryptedBankDetails: writes.find(
            (write) => "encryptedBankDetails" in write,
          )?.encryptedBankDetails,
        })),
      },
      user: {
        update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ displayName: "Vendor Name" }),
      },
      repairService: {
        findMany: jest.fn().mockResolvedValue([{ id: "service-1" }]),
      },
      technicianProfile: {
        upsert: jest.fn().mockResolvedValue({ id: "tech-1" }),
      },
      technicianSkill: { deleteMany: jest.fn(), createMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const service = new VendorKycService(db as never);

    await service.saveStep("vendor-1", "personalDetails", {
      fullName: "Vendor Name",
    });
    await service.saveStep("vendor-1", "addressDetails", {
      line1: "1 Main Road",
    });
    await service.saveStep("vendor-1", "professionalDetails", {
      services: ["00000000-0000-4000-8000-000000000001"],
      experienceYears: 3,
    });
    await service.saveStep("vendor-1", "bankDetails", {
      accountHolderName: "Vendor Name",
      accountNumber: "123456789012",
      ifscCode: "ABCD0123456",
      bankName: "Example Bank",
    });

    expect(db.vendorKycApplication.upsert).toHaveBeenCalledTimes(3);
    expect(writes.map((write) => Object.keys(write)[0])).toEqual([
      "updatedAt",
      "addressDetails",
      "professionalDetails",
      "encryptedBankDetails",
    ]);
    expect(String(writes[3]?.encryptedBankDetails)).not.toContain(
      "123456789012",
    );
    await expect(service.getStep("vendor-1", "bankDetails")).resolves.toEqual(
      expect.objectContaining({ accountNumber: "****9012" }),
    );
  });

  it("blocks duplicate submission while preserving existing admin feedback", async () => {
    const db = {
      vendorKycApplication: {
        findUnique: jest.fn().mockResolvedValue({
          id: "application-1",
          status: "PENDING_REVIEW",
          documents: [],
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ displayName: "Vendor Name" }),
      },
      technicianProfile: {
        findUnique: jest.fn().mockResolvedValue({ skills: [] }),
      },
    };
    const service = new VendorKycService(db as never);

    await expect(service.submit("vendor-1")).rejects.toMatchObject({
      code: "KYC_NOT_SUBMITTABLE",
    });
  });

  it("reports missing required step fields and completed-step progress", async () => {
    const db = {
      vendorKycApplication: {
        findUnique: jest.fn().mockResolvedValue({
          id: "application-1",
          status: "DRAFT",
          submittedAt: null,
          reviewedAt: null,
          adminFeedback: "Please correct your address",
          addressDetails: { line1: "1 Main Road" },
          professionalDetails: null,
          encryptedBankDetails: null,
          documents: [],
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ displayName: "Vendor Name" }),
      },
      technicianProfile: {
        findUnique: jest.fn().mockResolvedValue({ skills: [] }),
      },
    };
    const service = new VendorKycService(db as never);

    await expect(service.getOwnStatus("vendor-1")).resolves.toMatchObject({
      status: "DRAFT",
      adminFeedback: "Please correct your address",
      completedSteps: {
        personalDetails: true,
        address: false,
        identity: true,
        professionalDetails: false,
        bankDetails: true,
      },
      missingFields: expect.arrayContaining([
        "addressDetails.city",
        "addressDetails.state",
        "addressDetails.postalCode",
        "professionalDetails.services",
        "professionalDetails.experienceYears",
      ]),
    });
  });

  it("keeps rejection feedback and status while saving a correction", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const db = {
      vendorKycApplication: {
        upsert: jest.fn().mockResolvedValue({
          id: "application-1",
          status: "REJECTED",
        }),
        updateMany,
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: "application-1",
          status: "REJECTED",
          updatedAt: new Date(),
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ displayName: "Vendor Name" }),
      },
      technicianProfile: {
        findUnique: jest.fn().mockResolvedValue({ skills: [] }),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new VendorKycService(db as never);

    await service.saveStep("vendor-1", "addressDetails", {
      line1: "2 Main Road",
      city: "Pune",
      state: "Maharashtra",
      postalCode: "411001",
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["DRAFT", "REJECTED", "RESUBMISSION_REQUIRED"] },
        }),
        data: expect.not.objectContaining({
          status: expect.anything(),
          adminFeedback: expect.anything(),
        }),
      }),
    );
  });

  it("does not let one vendor access another vendor's private document", async () => {
    const db = {
      vendorIdentityDocument: {
        findUnique: jest.fn().mockResolvedValue({
          id: "document-1",
          frontStorageKey: "private-file.enc",
          backStorageKey: null,
          application: { vendorUserId: "owner-vendor" },
        }),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new VendorKycService(db as never);

    await expect(
      service.getDocumentForAccess(
        "document-1",
        "other-vendor",
        false,
        "front",
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("accepts optional files and preserves existing identity values when omitted", async () => {
    let createdData: Record<string, unknown> | undefined;
    const tx = {
      vendorKycApplication: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vendorIdentityDocument: {
        create: jest.fn(async ({ data }) => {
          createdData = data;
          return {
            ...data,
            id: "document-2",
            status: "PENDING",
            adminFeedback: null,
            uploadedAt: new Date(),
            reviewedAt: null,
            resubmittedAt: new Date(),
          };
        }),
      },
      auditLog: { create: jest.fn() },
    };
    const db = {
      vendorKycApplication: {
        upsert: jest
          .fn()
          .mockResolvedValue({ id: "application-1", status: "DRAFT" }),
      },
      vendorIdentityDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "document-1",
          encryptedDocumentNumber: "encrypted-number",
          maskedDocumentNumber: "******1234",
          nameOnDocument: "Vendor Name",
          frontStorageKey: "front-existing.enc",
          frontMimeType: "image/png",
          backStorageKey: null,
          backMimeType: null,
          status: "REJECTED",
        }),
      },
      $transaction: jest.fn((run) => run(tx)),
    };
    const service = new VendorKycService(db as never);

    const response = await service.uploadDocument(
      "vendor-1",
      { documentType: "PAN" },
      {},
    );

    expect(response.documentNumber).toBe("******1234");
    expect(response.frontImageAvailable).toBe(true);
    expect(createdData).toMatchObject({
      encryptedDocumentNumber: "encrypted-number",
      nameOnDocument: "Vendor Name",
      frontStorageKey: "front-existing.enc",
    });
  });

  it("allows an optional-document application to be resubmitted after rejection", async () => {
    const appUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      vendorKycApplication: {
        updateMany: appUpdate,
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: "application-1",
          status: "PENDING_REVIEW",
          submittedAt: new Date(),
        }),
      },
      vendorKycReviewLog: { create: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const db = {
      vendorKycApplication: {
        findUnique: jest.fn().mockResolvedValue({
          id: "application-1",
          status: "REJECTED",
          personalDetails: { fullName: "Vendor Name" },
          addressDetails: {
            line1: "1 Main Road",
            city: "Pune",
            state: "Maharashtra",
            postalCode: "411001",
          },
          professionalDetails: {
            experienceYears: 3,
          },
          encryptedBankDetails: null,
          documents: [],
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ displayName: "Vendor Name" }),
      },
      technicianProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ skills: [{ serviceId: "service-1" }] }),
      },
      $transaction: jest.fn((run) => run(tx)),
    };
    const service = new VendorKycService(db as never);

    await expect(service.submit("vendor-1")).resolves.toMatchObject({
      status: "PENDING_REVIEW",
    });
    expect(appUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["DRAFT", "REJECTED", "RESUBMISSION_REQUIRED"] },
        }),
        data: expect.not.objectContaining({ adminFeedback: null }),
      }),
    );
  });
});
