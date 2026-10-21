import { prisma } from "../../config/database";
import { NotFoundError } from "../../utils/errors";

export class BannerService {
  async getAllBanners(admin = false) {
    const where = admin ? {} : { isActive: true };
    return prisma.banner.findMany({
      where,
      orderBy: { position: "asc" },
    });
  }

  async getBannerById(id: string) {
    const banner = await prisma.banner.findUnique({
      where: { id },
    });
    if (!banner) throw new NotFoundError("Banner not found");
    return banner;
  }

  async createBanner(data: {
    title?: string;
    imageUrl: string;
    linkUrl?: string;
    position?: number;
    isActive?: boolean;
  }) {
    return prisma.banner.create({
      data: {
        title: data.title || null,
        imageUrl: data.imageUrl,
        linkUrl: data.linkUrl,
        position: data.position ? Number(data.position) : 0,
        isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
      },
    });
  }

  async updateBanner(
    id: string,
    data: Partial<{
      title: string;
      imageUrl: string;
      linkUrl: string;
      position: number;
      isActive: boolean;
    }>,
  ) {
    await this.getBannerById(id);

    return prisma.banner.update({
      where: { id },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.imageUrl && { imageUrl: data.imageUrl }),
        ...(data.linkUrl !== undefined && { linkUrl: data.linkUrl }),
        ...(data.position !== undefined && { position: Number(data.position) }),
        ...(data.isActive !== undefined && {
          isActive: Boolean(data.isActive),
        }),
      },
    });
  }

  async deleteBanner(id: string) {
    await this.getBannerById(id);
    return prisma.banner.delete({
      where: { id },
    });
  }
}
