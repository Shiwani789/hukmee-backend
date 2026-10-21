import { prisma } from "../../config/database";
import { NotFoundError } from "../../utils/errors";
import { CmsType } from "@prisma/client";

export class CmsService {
  async updateCmsPage(type: CmsType, data: { title: string; content: string }) {
    return await prisma.cmsPage.upsert({
      where: { type },
      update: {
        title: data.title,
        content: data.content,
      },
      create: {
        type: type,
        title: data.title,
        content: data.content,
      },
    });
  }

  async getCmsPageByType(type: CmsType) {
    const page = await prisma.cmsPage.findUnique({
      where: { type },
    });

    if (!page) {
      throw new NotFoundError(`CMS page of type ${type} not found`);
    }

    return page;
  }

  async getAllCmsPages() {
    return await prisma.cmsPage.findMany({
      orderBy: { createdAt: "desc" },
    });
  }
}
