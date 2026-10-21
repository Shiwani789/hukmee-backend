import { Request, Response } from "express";
import { BannerService } from "./banner.service";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError } from "../../utils/errors";

export class BannerController {
  private bannerService = new BannerService();

  private formatBanner(banner: any) {
    if (!banner) return banner;
    const baseUrl = process.env.BASE_URL || "";
    if (banner.imageUrl && banner.imageUrl.startsWith("/uploads/")) {
      banner.imageUrl = `${baseUrl}${banner.imageUrl}`;
    }
    return banner;
  }

  getPublicBanners = asyncHandler(async (req: Request, res: Response) => {
    const banners = await this.bannerService.getAllBanners(false);
    res.status(200).json({
      success: true,
      message: "Active banners fetched successfully",
      data: banners.map((b: any) => this.formatBanner(b)),
    });
  });

  getAdminBanners = asyncHandler(async (req: Request, res: Response) => {
    const banners = await this.bannerService.getAllBanners(true);
    res.status(200).json({
      success: true,
      message: "All banners fetched successfully",
      data: banners.map((b: any) => this.formatBanner(b)),
    });
  });

  getBanner = asyncHandler(async (req: Request, res: Response) => {
    const banner = await this.bannerService.getBannerById(
      String(req.params.id),
    );
    res.status(200).json({
      success: true,
      message: "Banner fetched successfully",
      data: this.formatBanner(banner),
    });
  });

  createBanner = asyncHandler(async (req: Request, res: Response) => {
    const data = { ...req.body };
    if (typeof data.isActive === "string") {
      data.isActive = data.isActive === "true";
    }

    if (req.file) {
      data.imageUrl = `/uploads/banners/${req.file.filename}`;
    } else {
      throw new BadRequestError("Banner image is required");
    }

    const banner = await this.bannerService.createBanner(data);
    res.status(201).json({
      success: true,
      message: "Banner created successfully",
      data: this.formatBanner(banner),
    });
  });

  updateBanner = asyncHandler(async (req: Request, res: Response) => {
    const data = { ...req.body };
    if (typeof data.isActive === "string") {
      data.isActive = data.isActive === "true";
    }

    if (req.file) {
      data.imageUrl = `/uploads/banners/${req.file.filename}`;
    }

    const banner = await this.bannerService.updateBanner(
      String(req.params.id),
      data,
    );
    res.status(200).json({
      success: true,
      message: "Banner updated successfully",
      data: this.formatBanner(banner),
    });
  });

  deleteBanner = asyncHandler(async (req: Request, res: Response) => {
    await this.bannerService.deleteBanner(String(req.params.id));
    res.status(200).json({
      success: true,
      message: "Banner deleted successfully",
      data: null,
    });
  });
}
