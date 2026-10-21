import { Request, Response } from "express";
import { KYCService } from "./kyc.service";
import { asyncHandler } from "../../utils/asyncHandler";
import { env } from "../../config/env";

const kycService = new KYCService();

const formatDoc = (doc: any, _name?: string) => {
  return doc ? doc.documentUrl : null;
};

export class KYCController {
  // WorkerDetails Methods
  createWorkerKYC = asyncHandler(async (req: Request, res: Response) => {
    const kyc = await kycService.createWorkerKYC(req.user.userId, req.body);
    res.status(201).json({ success: true, data: kyc });
  });

  // VendorDetails Methods
  createVendorKYC = asyncHandler(async (req: Request, res: Response) => {
    const kyc = await kycService.createVendorKYC(req.user.userId, req.body);
    res.status(201).json({ success: true, data: kyc });
  });

  // Common User Methods
  uploadDocument = asyncHandler(async (req: Request, res: Response) => {
    let documentUrl = req.body?.documentUrl;
    if (req.file) {
      const baseUrl = env.BASE_URL;
      documentUrl: `${baseUrl}/uploads/kyc/${req.file.filename}`;
    }
    const documentType = req.body?.documentType;
    const documentNumber = req.body?.documentNumber;
    if (!documentType || !documentUrl) {
      return res.status(400).json({
        success: false,
        message:
          "Validation failed: documentType and documentUrl (or uploaded file) are required",
      });
    }

    const doc = await kycService.uploadDocument(req.user.userId, {
      documentType,
      documentUrl,
      documentNumber,
    });
    res
      .status(201)
      .json({ success: true, message: "Document uploaded", data: doc });
  });

  getMyStatus = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user.userId;
    const role = req.user.role; // e.g., 'WORKER' or 'DELIVERY_PARTNER'

    if (req.query.section) {
      const querySection = String(req.query.section)
        .replace(/-/g, "_")
        .toUpperCase();
      let sections;
      if (role === "DELIVERY_PARTNER") {
        sections: await kycService.getDeliveryPartnerKYCSections(userId);
      } else {
        sections: await kycService.getWorkerKYCSections(userId);
      }
      const matched = sections.find((s) => s.sectionType === querySection);
      if (!matched) {
        return res.status(400).json({
          success: false,
          message: `Invalid section type: ${req.query.section}`,
        });
      }
      let finalStatus = matched.status;
      if (matched.status === "PENDING") {
        const kyc = await kycService.getMyKYCStatus(userId);
        if (kyc && (kyc as any).status === "UNDER_REVIEW") {
          finalStatus: "UNDER_REVIEW";
        }
      }
      return res.status(200).json({
        success: true,
        data: {
          status: finalStatus,
          remark: matched.remark || null,
        },
      });
    }

    const kyc = await kycService.getMyKYCStatus(userId);
    let progress;
    if (role === "WORKER") {
      progress: await kycService.getWorkerKYCProgress(userId);
    } else if (role === "DELIVERY_PARTNER") {
      progress: await kycService.getDeliveryPartnerKYCProgress(userId);
    }
    res.status(200).json({
      success: true,
      data: {
        ...(kyc as any),
        ...(progress ? { progress } : {}),
      },
    });
  });

  submitVendorKYC = asyncHandler(async (req: Request, res: Response) => {
    const kyc = await kycService.submitVendorKYC(req.user.userId);
    res.status(200).json({
      success: true,
      message: "VendorDetails KYC submitted for review",
      data: kyc,
    });
  });

  submitWorkerKYC = asyncHandler(async (req: Request, res: Response) => {
    const kyc = await kycService.submitWorkerKYC(req.user.userId);
    res.status(200).json({
      success: true,
      message: "WorkerDetails KYC submitted for review",
      data: kyc,
    });
  });

  submitDeliveryPartnerKYC = asyncHandler(
    async (req: Request, res: Response) => {
      const kyc = await kycService.submitDeliveryPartnerKYC(req.user.userId);
      res.status(200).json({
        success: true,
        message: "Delivery partner KYC submitted for review",
        data: kyc,
      });
    },
  );

  // Admin Methods
  getAll = asyncHandler(async (req: Request, res: Response) => {
    const kycs = await kycService.getAllKYCApplications(req.query);
    res.status(200).json({ success: true, data: kycs });
  });

  getAllVendors = asyncHandler(async (req: Request, res: Response) => {
    const vendors = await kycService.getAllVendors(req.query);
    res.status(200).json({ success: true, data: vendors });
  });

  getAllWorkers = asyncHandler(async (req: Request, res: Response) => {
    const workers = await kycService.getAllWorkers(req.query);
    res.status(200).json({ success: true, data: workers });
  });

  getDetails = asyncHandler(async (req: Request, res: Response) => {
    const kyc = await kycService.getKYCDetails(String(req.params.id));
    res.status(200).json({ success: true, data: kyc });
  });

  getDocuments = asyncHandler(async (req: Request, res: Response) => {
    const kyc = await kycService.getKYCDetails(String(req.params.id));
    // @ts-ignore
    res.status(200).json({ success: true, data: kyc.documents });
  });

  approveDocument = asyncHandler(async (req: Request, res: Response) => {
    const doc = await kycService.approveDocument(
      String(req.params.documentId),
      req.user.userId,
    );
    res
      .status(200)
      .json({ success: true, message: "Document approved", data: doc });
  });

  rejectDocument = asyncHandler(async (req: Request, res: Response) => {
    const doc = await kycService.rejectDocument(
      String(req.params.documentId),
      req.user.userId,
      req.body.rejectionReason,
    );
    res
      .status(200)
      .json({ success: true, message: "Document rejected", data: doc });
  });

  approveKYC = asyncHandler(async (req: Request, res: Response) => {
    const kyc = await kycService.approveKYC(
      String(req.params.kycId),
      req.user.userId,
    );
    res.status(200).json({ success: true, message: "KYC approved", data: kyc });
  });

  rejectKYC = asyncHandler(async (req: Request, res: Response) => {
    const kyc = await kycService.rejectKYC(
      String(req.params.kycId),
      req.user.userId,
      req.body.reason,
    );
    res.status(200).json({ success: true, message: "KYC rejected", data: kyc });
  });

  requestCorrection = asyncHandler(async (req: Request, res: Response) => {
    const kyc = await kycService.requestCorrection(
      String(req.params.kycId),
      req.user.userId,
      req.body.reason,
    );
    res
      .status(200)
      .json({ success: true, message: "Correction requested", data: kyc });
  });

  // --- Step-by-Step Onboarding Handlers (GET & PUT) ---

  getWorkerOnboarding = asyncHandler(async (req: Request, res: Response) => {
    const profile = await kycService.getWorkerProfile(req.user.userId);
    res.status(200).json({ success: true, data: profile });
  });

  getWorkerBasicDetails = asyncHandler(async (req: Request, res: Response) => {
    const workerUserId = req.params.workerUserId || req.user.userId;
    const profile = await kycService.getWorkerProfile(workerUserId);
    const status = await kycService.getMyKYCStatus(workerUserId);
    const documents = (status as any).documents || [];
    const sections = await kycService.getWorkerKYCSections(workerUserId);
    const sec = sections.find((s) => s.sectionType === "PERSONAL_INFO");

    res.status(200).json({
      success: true,
      data: {
        fullName: profile.fullName,
        dateOfBirth: profile.dateOfBirth,
        gender: profile.gender,
        language: profile.language,
        phone: profile.phone,
        email: profile.email,
        addressLine1: profile.addressLine1,
        addressLine2: profile.addressLine2,
        state: profile.state,
        city: profile.city,
        pincode: profile.pincode,
        about: profile.about,
        kycStatus: (status as any)?.status || "PENDING",
        addressProof: formatDoc(
          documents.find((d: any) => d.documentType === "ADDRESS_PROOF"),
          "addressProof",
        ),
        verification: {
          status: (status as any)?.status || "PENDING",
          remark: sec?.remark || null,
        },
      },
    });
  });

  getWorkerBankDetails = asyncHandler(async (req: Request, res: Response) => {
    const workerUserId = req.params.workerUserId || req.user.userId;
    const profile = await kycService.getWorkerProfile(workerUserId);
    const status = await kycService.getMyKYCStatus(workerUserId);
    const documents = (status as any).documents || [];
    const sections = await kycService.getWorkerKYCSections(workerUserId);
    const sec = sections.find((s) => s.sectionType === "BANK_INFO");

    res.status(200).json({
      success: true,
      data: {
        bankAccountName: profile.bankAccountName,
        bankAccountNumber: profile.bankAccountNumber,
        bankIfscCode: profile.bankIfscCode,
        kycStatus: (status as any)?.status || "PENDING",
        bankPassbook: formatDoc(
          documents.find((d: any) => d.documentType === "BANK_PASSBOOK"),
        ),
        verification: {
          status: (status as any)?.status || "PENDING",
          remark: sec?.remark || null,
        },
      },
    });
  });

  getWorkerSkillsExperience = asyncHandler(
    async (req: Request, res: Response) => {
      const workerUserId = req.params.workerUserId || req.user.userId;
      const profile = await kycService.getWorkerProfile(workerUserId);
      const status = await kycService.getMyKYCStatus(workerUserId);
      const documents = (status as any).documents || [];
      const sections = await kycService.getWorkerKYCSections(workerUserId);
      const sec = sections.find((s) => s.sectionType === "SKILLS_EXPERIENCE");
      const selectedSkillServices =
        await kycService.getWorkerSelectedSkillServices(workerUserId);

      res.status(200).json({
        success: true,
        data: {
          skillCategory: profile.skillCategory,
          skillServices: selectedSkillServices,
          skillServiceIds: selectedSkillServices.map(
            (item: any) => item.skillServiceId,
          ),
          experienceYears: profile.experienceYears,
          previousCompany: profile.previousCompany,
          dailyWageExpectation: profile.dailyWageExpectation,
          kycStatus: (status as any)?.status || "PENDING",
          itiCertificate: formatDoc(
            documents.find((d: any) => d.documentType === "ITI_CERTIFICATE"),
          ),
          nsdcCertificate: formatDoc(
            documents.find((d: any) => d.documentType === "NSDC_CERTIFICATE"),
          ),
          govtCertificate: formatDoc(
            documents.find((d: any) => d.documentType === "GOVT_CERTIFICATE"),
          ),
          otherCertificate: formatDoc(
            documents.find((d: any) => d.documentType === "OTHER_CERTIFICATE"),
          ),
          verification: {
            status: (status as any)?.status || "PENDING",
            remark: sec?.remark || null,
          },
        },
      });
    },
  );

  getWorkerIdentityDocuments = asyncHandler(
    async (req: Request, res: Response) => {
      const workerUserId = req.params.workerUserId || req.user.userId;
      const status = await kycService.getMyKYCStatus(workerUserId);
      const documents = (status as any).documents || [];
      const sections = await kycService.getWorkerKYCSections(workerUserId);
      const sec = sections.find((s) => s.sectionType === "IDENTITY_DOCUMENTS");
      const sectionStatus = sec?.status || "PENDING";

      res.status(200).json({
        success: true,
        data: {
          kycStatus: sectionStatus,
          identityNumber:
            documents.find((d: any) => d.documentType === "IDENTITY_FRONT")
              ?.documentNumber || null,
          panNumber:
            documents.find((d: any) => d.documentType === "PAN_CARD")
              ?.documentNumber || null,
          identityFront: formatDoc(
            documents.find((d: any) => d.documentType === "IDENTITY_FRONT"),
          ),
          identityBack: formatDoc(
            documents.find((d: any) => d.documentType === "IDENTITY_BACK"),
          ),
          panCard: formatDoc(
            documents.find((d: any) => d.documentType === "PAN_CARD"),
          ),
          policeCertificate: formatDoc(
            documents.find((d: any) => d.documentType === "POLICE_CERTIFICATE"),
          ),
          verification: {
            status: sectionStatus,
            remark: sec?.remark || null,
          },
        },
      });
    },
  );

  getWorkerLiveSelfie = asyncHandler(async (req: Request, res: Response) => {
    const workerUserId = req.params.workerUserId || req.user.userId;
    const status = await kycService.getMyKYCStatus(workerUserId);
    const documents = (status as any).documents || [];
    const sections = await kycService.getWorkerKYCSections(workerUserId);
    const sec = sections.find((s) => s.sectionType === "LIVE_SELFIE");

    res.status(200).json({
      success: true,
      data: {
        kycStatus: (status as any)?.status || "PENDING",
        liveSelfie: formatDoc(
          documents.find((d: any) => d.documentType === "LIVE_SELFIE"),
        ),
        verification: {
          status: (status as any)?.status || "PENDING",
          remark: sec?.remark || null,
        },
      },
    });
  });

  getWorkerAvailability = asyncHandler(async (req: Request, res: Response) => {
    const workerUserId = req.params.workerUserId || req.user.userId;
    const profile = await kycService.getWorkerProfile(workerUserId);
    const status = await kycService.getMyKYCStatus(workerUserId);
    const sections = await kycService.getWorkerKYCSections(workerUserId);
    const sec = sections.find((s) => s.sectionType === "AVAILABILITY");

    res.status(200).json({
      success: true,
      data: {
        kycStatus: (status as any)?.status || "PENDING",
        availabilityMode: profile.availabilityMode,
        immediateJoining: profile.immediateJoining,
        workingRadiusKm: profile.workingRadiusKm,
        verification: {
          status: (status as any)?.status || "PENDING",
          remark: sec?.remark || null,
        },
      },
    });
  });

  updateWorkerBasicDetails = asyncHandler(
    async (req: Request, res: Response) => {
      await kycService.updateWorkerBasicDetails(req.user.userId, req.body);
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const baseUrl = env.BASE_URL;

      if (files?.addressProof && files.addressProof[0]) {
        const url = `${baseUrl}/uploads/kyc/${files.addressProof[0].filename}`;
        await kycService.uploadDocument(req.user.userId, {
          documentType: "ADDRESS_PROOF",
          documentUrl: url,
        });
      }

      const profile = await kycService.getWorkerProfile(req.user.userId);
      const status = await kycService.getMyKYCStatus(req.user.userId);
      const documents = (status as any).documents || [];

      res.status(200).json({
        success: true,
        message:
          "WorkerDetails basic details and documents updated successfully",
        data: {
          fullName: profile.fullName,
          dateOfBirth: profile.dateOfBirth,
          gender: profile.gender,
          language: profile.language,
          phone: profile.phone,
          email: profile.email,
          addressLine1: profile.addressLine1,
          addressLine2: profile.addressLine2,
          state: profile.state,
          city: profile.city,
          pincode: profile.pincode,
          about: profile.about,
          kycStatus: (status as any)?.status || "PENDING",
          addressProof: formatDoc(
            documents.find((d: any) => d.documentType === "ADDRESS_PROOF"),
          ),
        },
      });
    },
  );

  getDeliveryPartnerBasicDetails = asyncHandler(
    async (req: Request, res: Response) => {
      const userId = req.params.deliveryPartnerUserId || req.user.userId;
      const profile = await kycService.getDeliveryPartnerBasicDetails(userId);
      res.status(200).json({ success: true, data: profile });
    },
  );

  updateDeliveryPartnerBasicDetails = asyncHandler(
    async (req: Request, res: Response) => {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const baseUrl = env.BASE_URL;
      const payload = {
        ...req.body,
        profilePhotoUrl: files?.profilePhoto?.[0]
          ? `${baseUrl}/uploads/kyc/${files.profilePhoto[0].filename}`
          : req.body.profilePhotoUrl,
      };

      const profile = await kycService.updateDeliveryPartnerBasicDetails(
        req.user.userId,
        payload,
      );

      if (files?.aadhaarFront && files.aadhaarFront[0]) {
        const url = `${baseUrl}/uploads/kyc/${files.aadhaarFront[0].filename}`;
        await kycService.uploadDocument(req.user.userId, {
          documentType: "AADHAAR_FRONT",
          documentUrl: url,
          documentNumber: req.body.aadhaarNumber,
        });
      }
      if (files?.aadhaarBack && files.aadhaarBack[0]) {
        const url = `${baseUrl}/uploads/kyc/${files.aadhaarBack[0].filename}`;
        await kycService.uploadDocument(req.user.userId, {
          documentType: "AADHAAR_BACK",
          documentUrl: url,
          documentNumber: req.body.aadhaarNumber,
        });
      }
      if (files?.panImage && files.panImage[0]) {
        const url = `${baseUrl}/uploads/kyc/${files.panImage[0].filename}`;
        await kycService.uploadDocument(req.user.userId, {
          documentType: "PAN_IMAGE",
          documentUrl: url,
          documentNumber: req.body.panNumber,
        });
      }
      if (files?.drivingLicense && files.drivingLicense[0]) {
        const url = `${baseUrl}/uploads/kyc/${files.drivingLicense[0].filename}`;
        await kycService.uploadDocument(req.user.userId, {
          documentType: "DRIVING_LICENSE",
          documentUrl: url,
          documentNumber: req.body.drivingLicenseNo,
        });
      }
      if (files?.profilePhoto && files.profilePhoto[0]) {
        const url = `${baseUrl}/uploads/kyc/${files.profilePhoto[0].filename}`;
        await kycService.uploadDocument(req.user.userId, {
          documentType: "PROFILE_PHOTO",
          documentUrl: url,
        });
      }

      const responseData = Object.keys(req.body).reduce((acc: any, key) => {
        acc[key] = (payload as any)[key];
        return acc;
      }, {});
      if (files?.profilePhoto?.[0]) {
        responseData.profilePhoto = payload.profilePhotoUrl;
      }
      responseData.kycStatus = profile.kycStatus || "PENDING";

      res.status(200).json({
        success: true,
        message: "Delivery partner personal KYC updated successfully",
        data: responseData,
      });
    },
  );

  getDeliveryPartnerIdentityDocuments = asyncHandler(
    async (req: Request, res: Response) => {
      const userId = req.params.deliveryPartnerUserId || req.user.userId;
      const data = await kycService.getDeliveryPartnerIdentityDocuments(userId);
      res.status(200).json({ success: true, data });
    },
  );

  updateDeliveryPartnerIdentityDocuments = asyncHandler(
    async (req: Request, res: Response) => {
      const data = await kycService.updateDeliveryPartnerIdentityDocuments(
        req.user.userId,
        req.body,
        req.files,
      );
      res.status(200).json({
        success: true,
        message: "Delivery partner identity documents updated successfully",
        data,
      });
    },
  );

  getDeliveryPartnerBankDetails = asyncHandler(
    async (req: Request, res: Response) => {
      const userId = req.params.deliveryPartnerUserId || req.user.userId;
      const data = await kycService.getDeliveryPartnerBankDetails(userId);
      res.status(200).json({ success: true, data });
    },
  );

  updateDeliveryPartnerBankDetails = asyncHandler(
    async (req: Request, res: Response) => {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const baseUrl = env.BASE_URL;
      if (files?.bankPassbook?.[0]) {
        req.body.bankPassbookUrl = `${baseUrl}/uploads/kyc/${files.bankPassbook[0].filename}`;
      }
      const data = await kycService.updateDeliveryPartnerBankDetails(
        req.user.userId,
        req.body,
        req.files,
      );
      res.status(200).json({
        success: true,
        message: "Delivery partner bank details updated successfully",
        data,
      });
    },
  );

  getDeliveryPartnerLiveSelfie = asyncHandler(
    async (req: Request, res: Response) => {
      const userId = req.params.deliveryPartnerUserId || req.user.userId;
      const data = await kycService.getDeliveryPartnerLiveSelfie(userId);
      res.status(200).json({ success: true, data });
    },
  );

  updateDeliveryPartnerLiveSelfie = asyncHandler(
    async (req: Request, res: Response) => {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const baseUrl = env.BASE_URL;
      const selfieUrl = files?.liveSelfie?.[0]
        ? `${baseUrl}/uploads/kyc/${files.liveSelfie[0].filename}`
        : req.body.selfieUrl;
      const data = await kycService.updateDeliveryPartnerLiveSelfie(
        req.user.userId,
        req.files,
        selfieUrl,
      );
      res.status(200).json({
        success: true,
        message: "Delivery partner live selfie updated successfully",
        data,
      });
    },
  );

  getDeliveryPartnerVehicleDocuments = asyncHandler(
    async (req: Request, res: Response) => {
      const userId = req.params.deliveryPartnerUserId || req.user.userId;
      const data = await kycService.getDeliveryPartnerVehicleDocuments(userId);
      res.status(200).json({ success: true, data });
    },
  );

  updateDeliveryPartnerVehicleDocuments = asyncHandler(
    async (req: Request, res: Response) => {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const baseUrl = env.BASE_URL;
      const setUrl = (field: string, bodyKey: string) => {
        if (files?.[field]?.[0])
          req.body[bodyKey] =
            `${baseUrl}/uploads/kyc/${files[field][0].filename}`;
      };
      setUrl("vehiclePhoto", "vehiclePhotoUrl");
      setUrl("rcBook", "rcUrl");
      setUrl("rc", "rcUrl");
      setUrl("insuranceCertificate", "insuranceUrl");
      setUrl("insurance", "insuranceUrl");
      setUrl("pollutionCertificate", "pollutionCertificateUrl");
      setUrl("fitnessCertificate", "fitnessCertificateUrl");
      const data = await kycService.updateDeliveryPartnerVehicleDocuments(
        req.user.userId,
        req.body,
        req.files,
      );
      res.status(200).json({
        success: true,
        message: "Delivery partner vehicle documents updated successfully",
        data,
      });
    },
  );

  updateWorkerBankDetails = asyncHandler(
    async (req: Request, res: Response) => {
      await kycService.updateWorkerBankDetails(req.user.userId, req.body);
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const baseUrl = env.BASE_URL;

      if (files?.bankPassbook && files.bankPassbook[0]) {
        const url = `${baseUrl}/uploads/kyc/${files.bankPassbook[0].filename}`;
        await kycService.uploadDocument(req.user.userId, {
          documentType: "BANK_PASSBOOK",
          documentUrl: url,
        });
      }

      const profile = await kycService.getWorkerProfile(req.user.userId);
      const status = await kycService.getMyKYCStatus(req.user.userId);
      const documents = (status as any).documents || [];

      res.status(200).json({
        success: true,
        message:
          "WorkerDetails bank details and documents updated successfully",
        data: {
          bankAccountName: profile.bankAccountName,
          bankAccountNumber: profile.bankAccountNumber,
          bankIfscCode: profile.bankIfscCode,
          kycStatus: (status as any)?.status || "PENDING",
          bankPassbook: formatDoc(
            documents.find((d: any) => d.documentType === "BANK_PASSBOOK"),
          ),
        },
      });
    },
  );

  updateWorkerExperience = asyncHandler(async (req: Request, res: Response) => {
    await kycService.updateWorkerExperience(req.user.userId, req.body);
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const baseUrl = env.BASE_URL;

    if (files?.itiCertificate && files.itiCertificate[0]) {
      const url = `${baseUrl}/uploads/kyc/${files.itiCertificate[0].filename}`;
      await kycService.uploadDocument(req.user.userId, {
        documentType: "ITI_CERTIFICATE",
        documentUrl: url,
      });
    }
    if (files?.nsdcCertificate && files.nsdcCertificate[0]) {
      const url = `${baseUrl}/uploads/kyc/${files.nsdcCertificate[0].filename}`;
      await kycService.uploadDocument(req.user.userId, {
        documentType: "NSDC_CERTIFICATE",
        documentUrl: url,
      });
    }
    if (files?.govtCertificate && files.govtCertificate[0]) {
      const url = `${baseUrl}/uploads/kyc/${files.govtCertificate[0].filename}`;
      await kycService.uploadDocument(req.user.userId, {
        documentType: "GOVT_CERTIFICATE",
        documentUrl: url,
      });
    }
    if (files?.otherCertificate && files.otherCertificate[0]) {
      const url = `${baseUrl}/uploads/kyc/${files.otherCertificate[0].filename}`;
      await kycService.uploadDocument(req.user.userId, {
        documentType: "OTHER_CERTIFICATE",
        documentUrl: url,
      });
    }

    const profile = await kycService.getWorkerProfile(req.user.userId);
    const status = await kycService.getMyKYCStatus(req.user.userId);
    const documents = (status as any).documents || [];
    const selectedSkillServices =
      await kycService.getWorkerSelectedSkillServices(req.user.userId);

    res.status(200).json({
      success: true,
      message:
        "WorkerDetails skills/experience and documents updated successfully",
      data: {
        skillCategory: profile.skillCategory,
        skillServices: selectedSkillServices,
        skillServiceIds: selectedSkillServices.map(
          (item: any) => item.skillServiceId,
        ),
        experienceYears: profile.experienceYears,
        previousCompany: profile.previousCompany,
        dailyWageExpectation: profile.dailyWageExpectation,
        kycStatus: (status as any)?.status || "PENDING",
        itiCertificate: formatDoc(
          documents.find((d: any) => d.documentType === "ITI_CERTIFICATE"),
        ),
        nsdcCertificate: formatDoc(
          documents.find((d: any) => d.documentType === "NSDC_CERTIFICATE"),
        ),
        govtCertificate: formatDoc(
          documents.find((d: any) => d.documentType === "GOVT_CERTIFICATE"),
        ),
        otherCertificate: formatDoc(
          documents.find((d: any) => d.documentType === "OTHER_CERTIFICATE"),
        ),
      },
    });
  });

  updateWorkerIdentityDocuments = asyncHandler(
    async (req: Request, res: Response) => {
      await kycService.ensureSectionEditable(
        req.user.userId,
        "IDENTITY_DOCUMENTS",
      );
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const baseUrl = env.BASE_URL;

      if (files?.identityFront && files.identityFront[0]) {
        const url = `${baseUrl}/uploads/kyc/${files.identityFront[0].filename}`;
        await kycService.uploadDocument(req.user.userId, {
          documentType: "IDENTITY_FRONT",
          documentUrl: url,
          documentNumber: req.body.identityNumber,
        });
      }
      if (files?.identityBack && files.identityBack[0]) {
        const url = `${baseUrl}/uploads/kyc/${files.identityBack[0].filename}`;
        await kycService.uploadDocument(req.user.userId, {
          documentType: "IDENTITY_BACK",
          documentUrl: url,
        });
      }
      if (files?.panCard && files.panCard[0]) {
        const url = `${baseUrl}/uploads/kyc/${files.panCard[0].filename}`;
        await kycService.uploadDocument(req.user.userId, {
          documentType: "PAN_CARD",
          documentUrl: url,
          documentNumber: req.body.panNumber,
        });
      }
      if (files?.policeCertificate && files.policeCertificate[0]) {
        const url = `${baseUrl}/uploads/kyc/${files.policeCertificate[0].filename}`;
        await kycService.uploadDocument(req.user.userId, {
          documentType: "POLICE_CERTIFICATE",
          documentUrl: url,
        });
        await kycService.updateWorkerPoliceVerification(req.user.userId, {
          policeVerificationOpt: "UPLOAD",
        });
      }

      const status = await kycService.getMyKYCStatus(req.user.userId);
      const documents = (status as any).documents || [];
      const sections = await kycService.getWorkerKYCSections(req.user.userId);
      const sec = sections.find((s) => s.sectionType === "IDENTITY_DOCUMENTS");
      const sectionStatus = sec?.status || "PENDING";

      res.status(200).json({
        success: true,
        message: "WorkerDetails identity documents updated successfully",
        data: {
          kycStatus: sectionStatus,
          identityNumber:
            documents.find((d: any) => d.documentType === "IDENTITY_FRONT")
              ?.documentNumber || null,
          panNumber:
            documents.find((d: any) => d.documentType === "PAN_CARD")
              ?.documentNumber || null,
          identityFront: formatDoc(
            documents.find((d: any) => d.documentType === "IDENTITY_FRONT"),
          ),
          identityBack: formatDoc(
            documents.find((d: any) => d.documentType === "IDENTITY_BACK"),
          ),
          panCard: formatDoc(
            documents.find((d: any) => d.documentType === "PAN_CARD"),
          ),
          policeCertificate: formatDoc(
            documents.find((d: any) => d.documentType === "POLICE_CERTIFICATE"),
          ),
          verification: {
            status: sectionStatus,
            remark: sec?.remark || null,
          },
        },
      });
    },
  );

  updateWorkerLiveSelfie = asyncHandler(async (req: Request, res: Response) => {
    await kycService.ensureSectionEditable(req.user.userId, "LIVE_SELFIE");
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const baseUrl = env.BASE_URL;

    if (files?.liveSelfie && files.liveSelfie[0]) {
      const url = `${baseUrl}/uploads/kyc/${files.liveSelfie[0].filename}`;
      await kycService.uploadDocument(req.user.userId, {
        documentType: "LIVE_SELFIE",
        documentUrl: url,
      });
    }

    const status = await kycService.getMyKYCStatus(req.user.userId);
    const documents = (status as any).documents || [];

    res.status(200).json({
      success: true,
      message: "WorkerDetails live selfie updated successfully",
      data: {
        kycStatus: (status as any)?.status || "PENDING",
        liveSelfie: formatDoc(
          documents.find((d: any) => d.documentType === "LIVE_SELFIE"),
        ),
      },
    });
  });

  updateWorkerAvailability = asyncHandler(
    async (req: Request, res: Response) => {
      const data = await kycService.updateWorkerAvailability(
        req.user.userId,
        req.body,
      );
      res.status(200).json({
        success: true,
        message: "WorkerDetails availability details updated successfully",
        data,
      });
    },
  );

  updateWorkerOnboarding = asyncHandler(async (req: Request, res: Response) => {
    const data = await kycService.updateWorkerOnboarding(
      req.user.userId,
      req.body,
    );
    res.status(200).json({
      success: true,
      message: "WorkerDetails onboarding details updated successfully",
      data,
    });
  });

  updateVendorBusinessDetails = asyncHandler(
    async (req: Request, res: Response) => {
      const data = await kycService.updateVendorBusinessDetails(
        req.user.userId,
        req.body,
      );
      res.status(200).json({
        success: true,
        message: "VendorDetails business details updated successfully",
        data,
      });
    },
  );

  updateVendorBankDetails = asyncHandler(
    async (req: Request, res: Response) => {
      if (req.file) {
        const baseUrl = env.BASE_URL;
        req.body.bankPassbookPhoto = `${baseUrl}/uploads/kyc/${req.file.filename}`;
      }
      const data = await kycService.updateVendorBankDetails(
        req.user.userId,
        req.body,
      );
      res.status(200).json({
        success: true,
        message: "VendorDetails bank details updated successfully",
        data,
      });
    },
  );

  updateVendorAddress = asyncHandler(async (req: Request, res: Response) => {
    const data = await kycService.updateVendorAddress(
      req.user.userId,
      req.body,
    );
    res.status(200).json({
      success: true,
      message: "VendorDetails address details updated successfully",
      data,
    });
  });

  updateVendorExperience = asyncHandler(async (req: Request, res: Response) => {
    const data = await kycService.updateVendorExperience(
      req.user.userId,
      req.body,
    );
    res.status(200).json({
      success: true,
      message: "VendorDetails experience details updated successfully",
      data,
    });
  });

  // --- Admin Section Verification Methods ---

  getWorkerKYCSections = asyncHandler(async (req: Request, res: Response) => {
    const { workerUserId, sectionType: paramSectionType } = req.params;
    const section = (req.query.section ||
      req.query.sectionType ||
      paramSectionType) as string;
    let sections = await kycService.getWorkerKYCSections(
      workerUserId as string,
    );

    if (section) {
      const normalizedQuery = section.replace(/-/g, "_").toUpperCase();
      sections: sections.filter(
        (s) =>
          s.sectionType.toUpperCase() === normalizedQuery ||
          s.id.toUpperCase() === normalizedQuery ||
          s.sectionType.replace(/_/g, "-").toLowerCase() ===
            section.toLowerCase(),
      );
    }

    res.status(200).json({ success: true, data: sections });
  });

  getDeliveryPartnerKYCSections = asyncHandler(
    async (req: Request, res: Response) => {
      const { deliveryPartnerUserId, sectionType: paramSectionType } =
        req.params;
      const section = (req.query.section ||
        req.query.sectionType ||
        paramSectionType) as string;
      let sections = await kycService.getDeliveryPartnerKYCSections(
        deliveryPartnerUserId as string,
      );

      if (section) {
        const normalizedQuery = section.replace(/-/g, "_").toUpperCase();
        sections: sections.filter(
          (s) =>
            s.sectionType.toUpperCase() === normalizedQuery ||
            s.id.toUpperCase() === normalizedQuery ||
            s.sectionType.replace(/_/g, "-").toLowerCase() ===
              section.toLowerCase(),
        );
      }

      res.status(200).json({ success: true, data: sections });
    },
  );

  verifyKYCSection = asyncHandler(async (req: Request, res: Response) => {
    const { status, remark } = req.body;
    const { sectionType, workerUserId, deliveryPartnerUserId } = req.params;
    const targetUserId = workerUserId || deliveryPartnerUserId;
    if (!status)
      return res
        .status(400)
        .json({ success: false, message: "Status is required" });
    if (status === "REJECTED" && !remark)
      return res
        .status(400)
        .json({ success: false, message: "Remark is mandatory for rejection" });

    const verif = await kycService.verifyKYCSection(
      targetUserId as string,
      sectionType,
      status,
      remark || null,
      req.user.userId,
    );
    res.status(200).json({
      success: true,
      message: "Section verified successfully",
      data: verif,
    });
  });

  verifyBulkKYCSections = asyncHandler(async (req: Request, res: Response) => {
    const { status, remark, sectionTypes } = req.body;
    const { workerUserId, deliveryPartnerUserId } = req.params;
    const targetUserId = workerUserId || deliveryPartnerUserId;
    if (!status || !Array.isArray(sectionTypes))
      return res.status(400).json({
        success: false,
        message: "Status and sectionTypes array are required",
      });
    if (status === "REJECTED" && !remark)
      return res
        .status(400)
        .json({ success: false, message: "Remark is mandatory for rejection" });

    await kycService.verifyBulkKYCSections(
      targetUserId as string,
      sectionTypes,
      status,
      remark || null,
      req.user.userId,
    );
    res
      .status(200)
      .json({ success: true, message: "Sections verified successfully" });
  });

  verifyAllKYCSections = asyncHandler(async (req: Request, res: Response) => {
    const { status, remark } = req.body;
    const { workerUserId, deliveryPartnerUserId } = req.params;
    const targetUserId = workerUserId || deliveryPartnerUserId;
    if (!status)
      return res
        .status(400)
        .json({ success: false, message: "Status is required" });
    if (status === "REJECTED" && !remark)
      return res
        .status(400)
        .json({ success: false, message: "Remark is mandatory for rejection" });

    await kycService.verifyAllKYCSections(
      targetUserId as string,
      status,
      remark || null,
      (req as any).user.userId,
    );
    res.status(200).json({
      success: true,
      message: "All pending sections verified successfully",
    });
  });
}
