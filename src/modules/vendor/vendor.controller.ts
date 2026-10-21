import { Request, Response } from "express";
import { VendorService } from "./vendor.service";

const vendorService = new VendorService();

export class VendorController {
  private getFileUrl(req: Request, folder: string) {
    if (!req.file) return undefined;
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return `${baseUrl}/uploads/${folder}/${req.file.filename}`;
  }

  private getUploadedFileUrl(
    req: Request,
    folder: string,
    fieldNames: string[],
  ) {
    const files = req.files as
      | Record<string, Express.Multer.File[]>
      | undefined;
    const file = fieldNames
      .map((fieldName) => files?.[fieldName]?.[0])
      .find(Boolean);

    if (!file) return undefined;

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return `${baseUrl}/uploads/${folder}/${file.filename}`;
  }

  async getProfile(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const profile = await vendorService.getProfile(userId);
      res.status(200).json({ success: true, data: profile });
    } catch (error: any) {
      res.status(404).json({ success: false, message: error.message });
    }
  }

  async updateProfile(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const { firstName, lastName, phone } = req.body;

      const dataToUpdate: any = {};
      if (firstName !== undefined) dataToUpdate.firstName = firstName;
      if (lastName !== undefined) dataToUpdate.lastName = lastName;
      if (phone !== undefined) dataToUpdate.phone = phone;

      // Handle file upload for profileImage
      let profileImage = req.body.profileImage;
      if (req.file) {
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        profileImage: `${baseUrl}/uploads/profiles/${req.file.filename}`;
      }

      if (profileImage !== undefined) dataToUpdate.profileImage = profileImage;

      if (Object.keys(dataToUpdate).length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "Please provide at least one valid field to update (firstName, lastName, phone, profileImage)",
        });
      }

      const updated = await vendorService.updateProfile(userId, dataToUpdate);
      res.status(200).json({ success: true, data: updated });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async submitOnboarding(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const addressProofUrl = this.getUploadedFileUrl(req, "vendors", [
        "addressProof",
      ]);
      const profileImage = this.getUploadedFileUrl(req, "vendors", [
        "profileImage",
        "vendorImage",
        "image",
      ]);
      const data = await vendorService.submitOnboarding(userId, {
        ...req.body,
        addressProofUrl: addressProofUrl || req.body.addressProofUrl,
        profileImage:
          profileImage ||
          req.body.profileImage ||
          req.body.vendorImage ||
          req.body.image,
      });
      res.status(201).json({ success: true, message: data.message, data });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async getOnboardingStatus(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const data = await vendorService.getOnboardingStatus(userId);
      res.status(200).json(data);
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async getDashboard(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const data = await vendorService.getDashboard(userId);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async getAssignedOrders(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const data = await vendorService.getAssignedOrders(userId, req.query);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async getOrderDetails(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const data = await vendorService.getOrderDetails(
        userId,
        String(req.params.id),
      );
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res
        .status(error.statusCode || 404)
        .json({ success: false, message: error.message });
    }
  }

  async markOutOfStock(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const data = await vendorService.markOutOfStock(
        userId,
        String(req.params.assignmentId),
        req.body.reason || req.body.remarks,
      );
      res
        .status(200)
        .json({ success: true, message: "Order marked out of stock", data });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async submitDeliveryPreparation(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const data = await vendorService.submitDeliveryPreparation(
        userId,
        String(req.params.id),
        req.body,
      );
      res
        .status(200)
        .json({ success: true, message: "Delivery request submitted", data });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async getWallet(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const data = await vendorService.getWallet(userId);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async getEarnings(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const data = await vendorService.getEarnings(userId);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async requestWithdrawal(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const data = await vendorService.requestWithdrawal(
        userId,
        Number(req.body.amount),
      );
      res
        .status(201)
        .json({ success: true, message: "Withdrawal requested", data });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async getWithdrawals(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const data = await vendorService.getWithdrawals(userId);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async getTransactions(req: Request, res: Response) {
    try {
      const userId = (req as any).user.userId;
      const data = await vendorService.getTransactions(userId);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async getAdminWithdrawals(req: Request, res: Response) {
    try {
      const data = await vendorService.getAdminWithdrawals();
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }

  async updateWithdrawalStatus(req: Request, res: Response) {
    try {
      const data = await vendorService.updateWithdrawalStatus(
        String(req.params.settlementId),
        req.body.status,
        (req as any).user.userId,
        req.body.referenceNo,
      );
      res.status(200).json({
        success: true,
        message: "Vendor withdrawal status updated",
        data,
      });
    } catch (error: any) {
      res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    }
  }
}
