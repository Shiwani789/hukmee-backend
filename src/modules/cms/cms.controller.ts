import { Request, Response } from "express";
import { CmsService } from "./cms.service";
import { asyncHandler } from "../../utils/asyncHandler";
import { CmsType } from "@prisma/client";

export class CmsController {
  private cmsService = new CmsService();

  updateCmsPage = asyncHandler(async (req: Request, res: Response) => {
    const type = req.params.type as CmsType;
    const data = req.body;

    const page = await this.cmsService.updateCmsPage(type, data);

    res.status(200).json({
      success: true,
      message: "CMS page saved successfully",
      data: page,
    });
  });

  getAboutPage = asyncHandler(async (req: Request, res: Response) => {
    const page = await this.cmsService.getCmsPageByType(CmsType.ABOUT);

    res.status(200).json({
      success: true,
      message: "About page fetched successfully",
      data: page,
    });
  });

  getPrivacyPolicyPage = asyncHandler(async (req: Request, res: Response) => {
    const page = await this.cmsService.getCmsPageByType(CmsType.PRIVACY_POLICY);

    res.status(200).json({
      success: true,
      message: "Privacy policy page fetched successfully",
      data: page,
    });
  });

  getTermsAndConditionsPage = asyncHandler(
    async (req: Request, res: Response) => {
      const page = await this.cmsService.getCmsPageByType(
        CmsType.TERMS_AND_CONDITIONS,
      );

      res.status(200).json({
        success: true,
        message: "Terms & conditions page fetched successfully",
        data: page,
      });
    },
  );

  getCmsPageByType = asyncHandler(async (req: Request, res: Response) => {
    const type = req.params.type as CmsType;
    const page = await this.cmsService.getCmsPageByType(type);

    res.status(200).json({
      success: true,
      message: "CMS page fetched successfully",
      data: page,
    });
  });

  getAllCmsPages = asyncHandler(async (req: Request, res: Response) => {
    const pages = await this.cmsService.getAllCmsPages();

    res.status(200).json({
      success: true,
      message: "CMS pages fetched successfully",
      data: pages,
    });
  });
}
