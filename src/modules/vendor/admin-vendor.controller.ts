import { Request, Response } from "express";
import { AdminVendorService } from "./admin-vendor.service";
import { asyncHandler } from "../../utils/asyncHandler";

const adminVendorService = new AdminVendorService();

export class AdminVendorController {
  createVendor = asyncHandler(async (req: Request, res: Response) => {
    const vendor = await adminVendorService.createVendor(req.body);
    res.status(201).json({
      success: true,
      message: "VendorDetails created successfully",
      data: vendor,
    });
  });

  getAllVendors = asyncHandler(async (req: Request, res: Response) => {
    const data = await adminVendorService.getAllVendors(req.query);
    res.status(200).json({
      success: true,
      data,
    });
  });

  getVendorById = asyncHandler(async (req: Request, res: Response) => {
    const vendor = await adminVendorService.getVendorById(
      String(req.params.vendorUserId),
    );
    res.status(200).json({
      success: true,
      data: vendor,
    });
  });

  updateVendor = asyncHandler(async (req: Request, res: Response) => {
    const vendor = await adminVendorService.updateVendor(
      String(req.params.vendorUserId),
      req.body,
    );
    res.status(200).json({
      success: true,
      message: "VendorDetails updated successfully",
      data: vendor,
    });
  });

  deleteVendor = asyncHandler(async (req: Request, res: Response) => {
    const result = await adminVendorService.deleteVendor(
      String(req.params.vendorUserId),
    );
    res.status(200).json({
      success: true,
      message: "VendorDetails deleted successfully",
      data: result,
    });
  });

  addDocument = asyncHandler(async (req: any, res: Response) => {
    const { documentType } = req.body;
    const vendorUserId = String(req.params.vendorUserId);

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Please upload a document file" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const documentUrl = `${baseUrl}/uploads/vendors/${req.file.filename}`;

    const doc = await adminVendorService.addDocument(
      vendorUserId,
      documentType,
      documentUrl,
    );
    res.status(201).json({
      success: true,
      message: "Document uploaded and mapped successfully",
      data: doc,
    });
  });

  getDocuments = asyncHandler(async (req: Request, res: Response) => {
    const docs = await adminVendorService.getDocuments(
      String(req.params.vendorUserId),
    );
    res.status(200).json({
      success: true,
      data: docs,
    });
  });

  deleteDocument = asyncHandler(async (req: Request, res: Response) => {
    const result = await adminVendorService.deleteDocument(
      String(req.params.vendorUserId),
      String(req.params.documentId),
    );
    res.status(200).json({
      success: true,
      message: "Document deleted successfully",
      data: result,
    });
  });

  getOnboardingRequests = asyncHandler(async (req: Request, res: Response) => {
    const data = await adminVendorService.getOnboardingRequests(req.query);
    res.status(200).json({ success: true, data });
  });

  getOnboardingRequest = asyncHandler(async (req: Request, res: Response) => {
    const data = await adminVendorService.getOnboardingRequest(
      String(req.params.userId),
    );
    res.status(200).json({ success: true, data });
  });

  updateOnboardingRequest = asyncHandler(
    async (req: Request, res: Response) => {
      const data = await adminVendorService.updateOnboardingRequest(
        String(req.params.userId),
        req.body,
      );
      res.status(200).json({
        success: true,
        message: "Vendor onboarding request updated successfully",
        data,
      });
    },
  );

  approveOnboardingRequest = asyncHandler(
    async (req: Request, res: Response) => {
      const data = await adminVendorService.approveOnboardingRequest(
        String(req.params.userId),
        req.user.userId,
      );
      res.status(200).json({
        success: true,
        message: "Vendor onboarding approved successfully",
        data,
      });
    },
  );

  rejectOnboardingRequest = asyncHandler(
    async (req: Request, res: Response) => {
      const data = await adminVendorService.rejectOnboardingRequest(
        String(req.params.userId),
        req.user.userId,
        req.body.reason,
      );
      res.status(200).json({
        success: true,
        message: "Vendor onboarding rejected successfully",
        data,
      });
    },
  );
}
