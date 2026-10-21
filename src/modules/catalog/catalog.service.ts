import type { Prisma } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { AppError } from "../../utils/errors";

type WithoutUndefined<T> = {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
    T[K],
    undefined
  >;
} & {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
};

export const withoutUndefined = <T extends object>(
  value: T,
): WithoutUndefined<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as WithoutUndefined<T>;

const catalogDirectory = path.resolve(process.cwd(), "uploads", "catalog");

async function removeCatalogImageIfUnreferenced(image: string | null) {
  if (!image || !image.startsWith("/uploads/catalog/")) return;
  const filename = image.slice("/uploads/catalog/".length);
  if (!filename || path.basename(filename) !== filename) return;

  try {
    const counts = await Promise.all([
      prisma.brand.count({ where: { image } }),
      prisma.deviceModel.count({ where: { image } }),
      prisma.repairService.count({ where: { image } }),
      prisma.part.count({ where: { image } }),
      prisma.partGrade.count({ where: { image } }),
    ]);
    if (counts.some((count) => count > 0)) return;
    await fs
      .unlink(path.join(catalogDirectory, filename))
      .catch(() => undefined);
  } catch {
    // A failed reference check must never cause deletion of a potentially used file.
  }
}

export interface CatalogListQuery {
  page: number;
  pageSize: number;
  search?: string | undefined;
  active?: "true" | "false" | undefined;
  sortOrder: "asc" | "desc";
}

export interface BrandBrowseQuery {
  search?: string | undefined;
  sortOrder: "asc" | "desc";
}
export interface BrandListQuery extends CatalogListQuery {
  sortBy: "name" | "createdAt";
}
export interface CreateBrandDto {
  name: string;
  image?: string | undefined;
}
export interface UpdateBrandDto {
  name?: string | undefined;
  active?: boolean | undefined;
  image?: string | undefined;
}

export interface ModelBrowseQuery extends BrandBrowseQuery {
  brandId?: string | undefined;
}
export interface ModelListQuery extends BrandListQuery {
  brandId?: string | undefined;
}
export interface CreateModelDto {
  brandId: string;
  name: string;
  image?: string | undefined;
}
export interface UpdateModelDto {
  brandId?: string | undefined;
  name?: string | undefined;
  active?: boolean | undefined;
  image?: string | undefined;
}

export interface CategoryBrowseQuery {
  modelId?: string | undefined;
  sortOrder: "asc" | "desc";
}
export type CategoryListQuery = BrandListQuery;
export interface CreateCategoryDto {
  name: string;
}
export interface UpdateCategoryDto {
  name?: string | undefined;
  active?: boolean | undefined;
}

export interface ServiceBrowseQuery {
  modelId: string;
  categoryId?: string | undefined;
  serviceId?: string | undefined;
  search?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  sortOrder: "asc" | "desc";
}
export interface ServiceListQuery extends CatalogListQuery {
  categoryId?: string | undefined;
  modelId?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  sortBy: "name" | "basePrice" | "createdAt";
}
export interface CreateServiceDto {
  categoryId: string;
  name: string;
  description?: string | null | undefined;
  active?: boolean | undefined;
  image?: string | undefined;
  compatibleModelIds?: string[] | undefined;
}
export interface UpdateServiceDto {
  categoryId?: string | undefined;
  name?: string | undefined;
  description?: string | null | undefined;
  active?: boolean | undefined;
  image?: string | undefined;
  compatibleModelIds?: string[] | undefined;
}

export interface PartListQuery extends CatalogListQuery {
  modelId?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  sortBy: "name" | "sku" | "sellingPrice" | "createdAt";
}
export interface CreatePartDto {
  sku?: string | null | undefined;
  name?: string | null | undefined;
  sellingPrice: number;
  image?: string | undefined;
  active?: boolean | undefined;
  compatibleModelIds?: string[] | undefined;
  compatibleServiceIds?: string[] | undefined;
}
export interface UpdatePartDto {
  sku?: string | null | undefined;
  name?: string | null | undefined;
  sellingPrice?: number | undefined;
  image?: string | undefined;
  active?: boolean | undefined;
  compatibleModelIds?: string[] | undefined;
  compatibleServiceIds?: string[] | undefined;
}

export interface PartGradeBrowseQuery {
  modelId?: string | undefined;
  serviceId?: string | undefined;
}
export interface CreatePartGradeDto {
  name: string;
  price?: number | null | undefined;
  image?: string | undefined;
  active?: boolean | undefined;
  partId: string;
}
export interface UpdatePartGradeDto {
  name?: string | undefined;
  price?: number | null | undefined;
  image?: string | undefined;
  clearImage?: boolean | undefined;
  active?: boolean | undefined;
}

// ── Pagination helper ─────────────────────────────────────────────────
const pageResult = async <T>(
  q: CatalogListQuery,
  findMany: (skip: number, take: number) => Promise<T[]>,
  count: () => Promise<number>,
) => {
  const skip = (q.page - 1) * q.pageSize;
  const [items, total] = await Promise.all([
    findMany(skip, q.pageSize),
    count(),
  ]);
  return {
    items,
    pagination: {
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.ceil(total / q.pageSize),
    },
  };
};
// ── Helpers ───────────────────────────────────────────────────────────
const activeWhere = (active: string | undefined) =>
  active === undefined ? {} : { active: active === "true" };
const searchWhere = (
  search: string | undefined,
  fields: readonly string[] = ["name"],
) =>
  search
    ? {
        OR: fields.map((f) => ({
          [f]: { contains: search, mode: "insensitive" },
        })),
      }
    : {};
const priceRangeWhere = (
  field: "basePrice" | "sellingPrice",
  min: number | undefined,
  max: number | undefined,
) => {
  if (min === undefined && max === undefined) return {};
  const cond: { gte?: number; lte?: number } = {};
  if (min !== undefined) cond.gte = min;
  if (max !== undefined) cond.lte = max;
  return { [field]: cond };
};
const ensureRecord = async <T>(
  findUnique: () => Promise<T | null>,
  id: string,
  entity: string,
): Promise<T> => {
  const item = await findUnique();
  if (!item) throw new AppError(404, "NOT_FOUND", `${entity} not found`);
  return item;
};
const normalizeModelIds = (ids: readonly string[] | undefined): string[] => [
  ...new Set(ids ?? []),
];
const publicImageUrl = (image: string | null): string | null => {
  if (!image || /^https?:\/\//i.test(image)) return image;
  const baseUrl = (env.BASE_URL ?? `http://localhost:${env.PORT}`).replace(
    /\/$/,
    "",
  );
  return `${baseUrl}${image.startsWith("/") ? "" : "/"}${image}`;
};
const ensureBrandExists = async (brandId: string) => {
  await ensureRecord(
    () => prisma.brand.findUnique({ where: { id: brandId } }),
    brandId,
    "Brand",
  );
};
const ensureCategoryExists = async (categoryId: string) => {
  await ensureRecord(
    () => prisma.repairCategory.findUnique({ where: { id: categoryId } }),
    categoryId,
    "Service category",
  );
};
const ensureModelsExist = async (ids: readonly string[] | undefined) => {
  const uniqueIds = normalizeModelIds(ids);
  if (!uniqueIds.length) return;
  const count = await prisma.deviceModel.count({
    where: { id: { in: uniqueIds } },
  });
  if (count !== uniqueIds.length)
    throw new AppError(404, "NOT_FOUND", "One or more models not found");
};
const ensureActiveModelsForPartMapping = async (
  tx: Prisma.TransactionClient,
  ids: readonly string[],
) => {
  const uniqueIds = normalizeModelIds(ids);
  if (!uniqueIds.length) return;
  const models = await tx.deviceModel.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, active: true, brand: { select: { active: true } } },
  });
  if (models.length !== uniqueIds.length)
    throw new AppError(404, "NOT_FOUND", "One or more models not found");
  if (models.some((model) => !model.active || !model.brand.active))
    throw new AppError(
      409,
      "CATALOG_MAPPING_INVALID",
      "Inactive models or brands cannot be used for part mappings",
    );
};
const ensurePartServiceMappings = async (
  tx: Prisma.TransactionClient,
  modelIds: readonly string[],
  serviceIds: readonly string[],
  requireActiveServices: boolean,
) => {
  const uniqueServiceIds = normalizeModelIds(serviceIds);
  if (!uniqueServiceIds.length) return;
  const uniqueModelIds = normalizeModelIds(modelIds);
  if (!uniqueModelIds.length)
    throw new AppError(
      409,
      "CATALOG_MAPPING_INVALID",
      "Select at least one compatible device model before mapping services",
    );
  const services = await tx.repairService.findMany({
    where: { id: { in: uniqueServiceIds } },
    select: {
      id: true,
      active: true,
      compatibility: { select: { modelId: true } },
    },
  });
  if (services.length !== uniqueServiceIds.length)
    throw new AppError(
      404,
      "NOT_FOUND",
      "One or more repair services not found",
    );
  const invalid = services.find(
    (service) =>
      (requireActiveServices && !service.active) ||
      !service.compatibility.some(({ modelId }) =>
        uniqueModelIds.includes(modelId),
      ),
  );
  if (invalid)
    throw new AppError(
      409,
      "CATALOG_MAPPING_INVALID",
      !invalid.active
        ? "Inactive repair services cannot be mapped to a part"
        : "Each mapped service must be compatible with at least one selected device model",
    );
};
// ── Unified CatalogService ────────────────────────────────────────────
export class CatalogService {
  // ── BRANDS ────────────────────────────────────────────────
  /** Public: active brands only, searchable, sortable */
  browseBrands(q: BrandBrowseQuery) {
    const order = q?.sortOrder ?? "asc";
    return prisma.brand
      .findMany({
        where: {
          active: true,
          ...searchWhere(q?.search),
        },
        orderBy: { name: order },
        select: { id: true, name: true, image: true },
      })
      .then((brands) =>
        brands.map((brand) => ({
          ...brand,
          image: publicImageUrl(brand.image),
        })),
      );
  }
  /** Admin: paginated, search, active filter, sortBy/sortOrder */
  listBrands(q: BrandListQuery) {
    const where = { ...activeWhere(q.active), ...searchWhere(q.search) };
    const orderBy = [{ [q.sortBy]: q.sortOrder }];
    return pageResult(
      q,
      (skip, take) => prisma.brand.findMany({ where, skip, take, orderBy }),
      () => prisma.brand.count({ where }),
    );
  }
  async getBrand(id: string) {
    return ensureRecord(
      () => prisma.brand.findUnique({ where: { id: id } }),
      id,
      "Brand",
    );
  }
  createBrand(data: CreateBrandDto) {
    return prisma.brand.create({ data: withoutUndefined(data) });
  }
  async updateBrand(id: string, data: UpdateBrandDto) {
    await ensureRecord(
      () => prisma.brand.findUnique({ where: { id: id } }),
      id,
      "Brand",
    );
    return prisma.brand.update({ where: { id }, data: withoutUndefined(data) });
  }
  async deactivateBrand(id: string) {
    await ensureRecord(
      () => prisma.brand.findUnique({ where: { id: id } }),
      id,
      "Brand",
    );
    return prisma.brand.update({
      where: { id },
      data: { active: false },
    });
  }
  // ── MODELS ────────────────────────────────────────────────
  /** Public: active models only, filterable by brand, searchable, sortable */
  browseModels(q: ModelBrowseQuery) {
    const order = q?.sortOrder ?? "asc";
    return prisma.deviceModel
      .findMany({
        where: {
          active: true,
          brand: { active: true },
          ...(q?.brandId ? { brandId: q.brandId } : {}),
          ...searchWhere(q?.search),
        },
        orderBy: [{ brand: { name: order } }, { name: order }],
        select: {
          id: true,
          name: true,
          image: true,
          brand: { select: { id: true, name: true } },
        },
      })
      .then((models) =>
        models.map((model) => ({
          ...model,
          image: publicImageUrl(model.image),
        })),
      );
  }
  /** Admin: paginated, search, brand filter, active filter, sortBy/sortOrder */
  listModels(q: ModelListQuery) {
    const where = {
      ...activeWhere(q.active),
      ...(q.brandId ? { brandId: q.brandId } : {}),
      ...searchWhere(q.search),
    };
    const orderBy = [{ [q.sortBy]: q.sortOrder }];
    return pageResult(
      q,
      (skip, take) =>
        prisma.deviceModel.findMany({ where, skip, take, orderBy }),
      () => prisma.deviceModel.count({ where }),
    );
  }
  async getModel(id: string) {
    return ensureRecord(
      () => prisma.deviceModel.findUnique({ where: { id: id } }),
      id,
      "Model",
    );
  }
  createModel(data: CreateModelDto) {
    return ensureBrandExists(data.brandId).then(() =>
      prisma.deviceModel.create({ data: withoutUndefined(data) }),
    );
  }
  async updateModel(id: string, data: UpdateModelDto) {
    await ensureRecord(
      () => prisma.deviceModel.findUnique({ where: { id: id } }),
      id,
      "Model",
    );
    if (data.brandId) await ensureBrandExists(data.brandId);
    return prisma.deviceModel.update({
      where: { id },
      data: withoutUndefined(data),
    });
  }
  async deactivateModel(id: string) {
    await ensureRecord(
      () => prisma.deviceModel.findUnique({ where: { id: id } }),
      id,
      "Model",
    );
    return prisma.deviceModel.update({
      where: { id },
      data: { active: false },
    });
  }
  // ── CATEGORIES ────────────────────────────────────────────
  async browseCategories(q: CategoryBrowseQuery) {
    if (q.modelId) {
      const model = await prisma.deviceModel.findFirst({
        where: { id: q.modelId, active: true, brand: { active: true } },
        select: { id: true },
      });
      if (!model) return [];
    }
    return prisma.repairCategory.findMany({
      where: {
        active: true,
        ...(q.modelId
          ? {
              services: {
                some: {
                  active: true,
                  compatibility: {
                    some: {
                      modelId: q.modelId,
                      model: { active: true, brand: { active: true } },
                    },
                  },
                },
              },
            }
          : {}),
      },
      orderBy: { name: q.sortOrder ?? "asc" },
      select: { id: true, name: true },
    });
  }
  async listCategoryServices(categoryId: string, modelId: string | undefined) {
    if (modelId) {
      const model = await prisma.deviceModel.findFirst({
        where: { id: modelId, active: true, brand: { active: true } },
        select: { id: true },
      });
      if (!model) return [];
    }
    const modelCompatibility = modelId
      ? {
          modelId,
          model: { active: true, brand: { active: true } },
        }
      : { model: { active: true, brand: { active: true } } };
    const category = await prisma.repairCategory.findFirst({
      where: { id: categoryId, active: true },
      select: {
        id: true,
        name: true,
        services: {
          where: {
            active: true,
            compatibility: { some: modelCompatibility },
          },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            description: true,
            basePrice: true,
            image: true,
            partMappings: {
              where: {
                part: {
                  active: true,
                  compatibility: { some: modelCompatibility },
                },
              },
              select: {
                part: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                    sellingPrice: true,
                    image: true,
                    grades: {
                      where: { active: true, price: { not: null } },
                      orderBy: { name: "asc" },
                      select: {
                        id: true,
                        name: true,
                        price: true,
                        image: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!category)
      throw new AppError(404, "NOT_FOUND", "Service category not found");
    return {
      id: category.id,
      name: category.name,
      services: category.services.map(({ partMappings, ...service }) => ({
        ...service,
        image: publicImageUrl(service.image),
        parts: partMappings.map(({ part }) => {
          const { grades, ...partFields } = part;
          return {
            ...partFields,
            image: publicImageUrl(part.image),
            grades: grades.map((grade) => ({
              ...grade,
              image: publicImageUrl(grade.image),
            })),
          };
        }),
      })),
    };
  }
  async listServiceParts(serviceId: string, modelId: string) {
    const model = await prisma.deviceModel.findFirst({
      where: { id: modelId, active: true, brand: { active: true } },
      select: { id: true },
    });
    if (!model) return [];
    const existingService = await prisma.repairService.findUnique({
      where: { id: serviceId },
      select: { id: true },
    });
    if (!existingService)
      throw new AppError(404, "NOT_FOUND", "Repair service not found");
    const eligibleService = await prisma.repairService.findFirst({
      where: {
        id: serviceId,
        active: true,
        category: { active: true },
        compatibility: {
          some: {
            modelId,
            model: { active: true, brand: { active: true } },
          },
        },
      },
      select: { id: true },
    });
    if (!eligibleService) return [];
    const parts = await prisma.part.findMany({
      where: {
        active: true,
        serviceMappings: { some: { serviceId } },
        compatibility: {
          some: {
            modelId,
            model: { active: true, brand: { active: true } },
          },
        },
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        sku: true,
        sellingPrice: true,
        image: true,
        grades: {
          where: { active: true, price: { not: null } },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            price: true,
            image: true,
          },
        },
      },
    });
    return parts.map(({ grades, ...part }) => ({
      ...part,
      image: publicImageUrl(part.image),
      grades: grades.map((grade) => ({
        ...grade,
        image: publicImageUrl(grade.image),
      })),
    }));
  }
  async browsePartGrades(partId: string, input: PartGradeBrowseQuery) {
    if (!input.modelId || !input.serviceId) {
      const part = await prisma.part.findFirst({
        where: { id: partId, active: true },
        select: { id: true },
      });
      if (!part) {
        const exists = await prisma.part.findUnique({
          where: { id: partId },
          select: { id: true },
        });
        if (!exists) throw new AppError(404, "NOT_FOUND", "Part not found");
        throw new AppError(400, "PART_UNAVAILABLE", "Part is not active");
      }
      const grades = await prisma.partGrade.findMany({
        where: { partId, active: true, price: { not: null } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, price: true, image: true },
      });
      return grades.map((grade) => ({
        ...grade,
        image: publicImageUrl(grade.image),
      }));
    }
    const model = await prisma.deviceModel.findFirst({
      where: {
        id: input.modelId,
        active: true,
        brand: { active: true },
      },
      select: { id: true },
    });
    if (!model)
      throw new AppError(404, "NOT_FOUND", "Active device model not found");
    const existingService = await prisma.repairService.findUnique({
      where: { id: input.serviceId },
      select: { id: true },
    });
    if (!existingService)
      throw new AppError(404, "NOT_FOUND", "Repair service not found");
    const service = await prisma.repairService.findFirst({
      where: {
        id: input.serviceId,
        active: true,
        category: { active: true },
        compatibility: {
          some: {
            modelId: input.modelId,
            model: { active: true, brand: { active: true } },
          },
        },
      },
      select: { id: true },
    });
    if (!service)
      throw new AppError(
        400,
        "SERVICE_UNAVAILABLE",
        "Service is not available for this device model",
      );
    const existingPart = await prisma.part.findUnique({
      where: { id: partId },
      select: { id: true },
    });
    if (!existingPart) throw new AppError(404, "NOT_FOUND", "Part not found");
    const part = await prisma.part.findFirst({
      where: {
        id: partId,
        active: true,
        serviceMappings: { some: { serviceId: input.serviceId } },
        compatibility: {
          some: {
            modelId: input.modelId,
            model: { active: true, brand: { active: true } },
          },
        },
      },
      select: { id: true },
    });
    if (!part)
      throw new AppError(
        400,
        "PART_UNAVAILABLE",
        "Part is not available for this service and device model",
      );
    const grades = await prisma.partGrade.findMany({
      where: { partId, active: true, price: { not: null } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, price: true, image: true },
    });
    return grades.map((grade) => ({
      ...grade,
      image: publicImageUrl(grade.image),
    }));
  }
  listCategories(q: CategoryListQuery) {
    const where = { ...activeWhere(q.active), ...searchWhere(q.search) };
    const orderBy = [{ [q.sortBy]: q.sortOrder }];
    return pageResult(
      q,
      (skip, take) =>
        prisma.repairCategory.findMany({ where, skip, take, orderBy }),
      () => prisma.repairCategory.count({ where }),
    );
  }
  async getCategory(id: string) {
    return ensureRecord(
      () => prisma.repairCategory.findUnique({ where: { id: id } }),
      id,
      "Service category",
    );
  }
  createCategory(data: CreateCategoryDto) {
    return prisma.repairCategory.create({ data });
  }
  async updateCategory(id: string, data: UpdateCategoryDto) {
    await ensureRecord(
      () => prisma.repairCategory.findUnique({ where: { id: id } }),
      id,
      "Service category",
    );
    return prisma.repairCategory.update({
      where: { id },
      data: withoutUndefined(data),
    });
  }
  async deactivateCategory(id: string) {
    await ensureRecord(
      () => prisma.repairCategory.findUnique({ where: { id: id } }),
      id,
      "Service category",
    );
    return prisma.repairCategory.update({
      where: { id },
      data: { active: false },
    });
  }
  // ── SERVICES ──────────────────────────────────────────────
  /** Public: active, compatible with modelId, searchable, price-range filterable, sortable */
  async browseServices(q: ServiceBrowseQuery) {
    const order = q.sortOrder ?? "asc";
    const model = await prisma.deviceModel.findFirst({
      where: { id: q.modelId, active: true, brand: { active: true } },
      select: { id: true },
    });
    if (!model) return [];
    const where = {
      active: true,
      category: { active: true },
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.serviceId ? { id: q.serviceId } : {}),
      compatibility: {
        some: {
          modelId: q.modelId,
          model: { active: true, brand: { active: true } },
        },
      },
      ...searchWhere(q.search),
      ...priceRangeWhere("basePrice", q.minPrice, q.maxPrice),
    };
    const select = {
      id: true,
      name: true,
      description: true,
      basePrice: true,
      image: true,
      category: { select: { id: true, name: true } },
    };
    return prisma.repairService
      .findMany({
        where,
        orderBy: [{ category: { name: order } }, { name: order }],
        select: {
          ...select,
          partMappings: {
            where: {
              part: {
                active: true,
                compatibility: {
                  some: {
                    modelId: q.modelId,
                    model: { active: true, brand: { active: true } },
                  },
                },
              },
            },
            select: {
              part: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  sellingPrice: true,
                  image: true,
                  grades: {
                    where: { active: true, price: { not: null } },
                    orderBy: { name: "asc" },
                    select: {
                      id: true,
                      name: true,
                      price: true,
                      image: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
      .then((services) => {
        const mappedServices = services.map(({ partMappings, ...service }) => ({
          id: service.id,
          name: service.name,
          description: service.description,
          basePrice: service.basePrice,
          image: publicImageUrl(service.image),
          category: service.category,
          parts: partMappings.map(({ part }) => {
            const { grades, ...partFields } = part;
            return {
              ...partFields,
              image: publicImageUrl(part.image),
              grades: grades.map((grade) => ({
                ...grade,
                image: publicImageUrl(grade.image),
              })),
            };
          }),
        }));
        if (q.categoryId)
          return mappedServices.map(({ category, ...service }) => {
            void category;
            return service;
          });
        const categories = new Map();
        for (const { category, ...service } of mappedServices) {
          let categoryGroup = categories.get(category.id);
          if (!categoryGroup) {
            categoryGroup = {
              id: category.id,
              name: category.name,
              services: [],
            };
            categories.set(categoryGroup.id, categoryGroup);
          }
          categoryGroup.services.push(service);
        }
        return [...categories.values()];
      });
  }
  /** Admin: paginated, search, category/model/price filters, active filter, sortBy/sortOrder */
  listServices(q: ServiceListQuery) {
    const where = {
      ...activeWhere(q.active),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...searchWhere(q.search),
      ...priceRangeWhere("basePrice", q.minPrice, q.maxPrice),
      ...(q.modelId ? { compatibility: { some: { modelId: q.modelId } } } : {}),
    };
    const sortOrder = q.sortOrder;
    const orderBy =
      q.sortBy === "basePrice"
        ? [{ basePrice: sortOrder }]
        : [{ [q.sortBy]: sortOrder }];
    return pageResult(
      q,
      (skip, take) =>
        prisma.repairService.findMany({
          where,
          skip,
          take,
          orderBy,
          include: { compatibility: { include: { model: true } } },
        }),
      () => prisma.repairService.count({ where }),
    );
  }
  async getService(id: string) {
    const service = await prisma.repairService.findUnique({
      where: { id },
      include: { compatibility: { include: { model: true } } },
    });
    if (!service)
      throw new AppError(404, "NOT_FOUND", "Repair service not found");
    return service;
  }
  async createService(data: CreateServiceDto) {
    await ensureCategoryExists(data.categoryId);
    await ensureModelsExist(data.compatibleModelIds);
    const { compatibleModelIds, ...rest } = data;
    return prisma.repairService.create({
      data: {
        ...withoutUndefined(rest),
        ...(compatibleModelIds
          ? {
              compatibility: {
                create: normalizeModelIds(compatibleModelIds).map(
                  (modelId) => ({ modelId }),
                ),
              },
            }
          : {}),
      },
    });
  }
  async updateService(id: string, data: UpdateServiceDto) {
    const { compatibleModelIds, ...fields } = data;
    if (fields.categoryId) await ensureCategoryExists(fields.categoryId);
    await ensureModelsExist(compatibleModelIds);
    return prisma.$transaction(async (tx) => {
      if (compatibleModelIds !== undefined) {
        const existing = await tx.repairService.findUnique({
          where: { id },
          include: {
            partMappings: {
              include: {
                part: { include: { compatibility: true } },
              },
            },
          },
        });
        if (!existing)
          throw new AppError(404, "NOT_FOUND", "Repair service not found");
        const modelIds = normalizeModelIds(compatibleModelIds);
        const invalidPart = existing.partMappings.find(
          ({ part }) =>
            !part.compatibility.some(({ modelId }) =>
              modelIds.includes(modelId),
            ),
        );
        if (invalidPart)
          throw new AppError(
            409,
            "CATALOG_MAPPING_INVALID",
            "The selected device models would make a mapped part incompatible",
          );
        await tx.deviceServiceCompatibility.deleteMany({
          where: { serviceId: id },
        });
        if (modelIds.length)
          await tx.deviceServiceCompatibility.createMany({
            data: modelIds.map((modelId) => ({ modelId, serviceId: id })),
          });
      } else {
        const existing = await tx.repairService.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!existing)
          throw new AppError(404, "NOT_FOUND", "Repair service not found");
      }
      return tx.repairService.update({
        where: { id },
        data: withoutUndefined(fields),
        include: { compatibility: { include: { model: true } } },
      });
    });
  }
  async deactivateService(id: string) {
    await ensureRecord(
      () => prisma.repairService.findUnique({ where: { id: id } }),
      id,
      "Repair service",
    );
    return prisma.repairService.update({
      where: { id },
      data: { active: false },
    });
  }
  // ── PARTS ──────────────────────────────────────────────────
  listParts(q: PartListQuery) {
    const where = {
      ...activeWhere(q.active),
      ...(q.modelId ? { compatibility: { some: { modelId: q.modelId } } } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" as const } },
              { sku: { contains: q.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...priceRangeWhere("sellingPrice", q.minPrice, q.maxPrice),
    };
    const sortOrder = q.sortOrder;
    const orderBy =
      q.sortBy === "sellingPrice"
        ? [{ sellingPrice: sortOrder }]
        : [{ [q.sortBy]: sortOrder }];
    return pageResult(
      q,
      (skip, take) =>
        prisma.part.findMany({
          where,
          skip,
          take,
          orderBy,
          include: {
            compatibility: { include: { model: true } },
            serviceMappings: {
              include: {
                service: {
                  select: {
                    id: true,
                    name: true,
                    active: true,
                    compatibility: { select: { modelId: true } },
                  },
                },
              },
            },
          },
        }),
      () => prisma.part.count({ where }),
    );
  }
  async getPart(id: string) {
    const part = await prisma.part.findUnique({
      where: { id },
      include: {
        compatibility: { include: { model: true } },
        serviceMappings: {
          include: {
            service: {
              select: {
                id: true,
                name: true,
                active: true,
                compatibility: { select: { modelId: true } },
              },
            },
          },
        },
      },
    });
    if (!part) throw new AppError(404, "NOT_FOUND", "Part not found");
    return part;
  }
  async listPartGrades(partId: string) {
    await ensureRecord(
      () => prisma.part.findUnique({ where: { id: partId } }),
      partId,
      "Part",
    );
    return prisma.partGrade.findMany({
      where: { partId },
      orderBy: { name: "asc" },
    });
  }
  async createPartGrade(data: CreatePartGradeDto) {
    await ensureRecord(
      () => prisma.part.findUnique({ where: { id: data.partId } }),
      data.partId,
      "Part",
    );
    const duplicate = await prisma.partGrade.findFirst({
      where: { partId: data.partId, name: data.name },
      select: { id: true },
    });
    if (duplicate)
      throw new AppError(
        409,
        "DUPLICATE_RESOURCE",
        "This grade name already exists for the part",
      );
    return prisma.partGrade.create({ data: withoutUndefined(data) });
  }
  async updatePartGrade(gradeId: string, data: UpdatePartGradeDto) {
    const existing = await prisma.partGrade.findUnique({
      where: { id: gradeId },
      select: { id: true, partId: true, image: true },
    });
    if (!existing) throw new AppError(404, "NOT_FOUND", "Part grade not found");
    const { clearImage, ...fields } = data;
    if (fields.name !== undefined) {
      const duplicate = await prisma.partGrade.findFirst({
        where: {
          partId: existing.partId,
          name: fields.name,
          id: { not: gradeId },
        },
        select: { id: true },
      });
      if (duplicate)
        throw new AppError(
          409,
          "DUPLICATE_RESOURCE",
          "This grade name already exists for the part",
        );
    }
    const updated = await prisma.partGrade.update({
      where: { id: gradeId },
      data: withoutUndefined({
        ...fields,
        ...(clearImage ? { image: null } : {}),
      }),
    });
    if (existing.image && existing.image !== updated.image)
      await removeCatalogImageIfUnreferenced(existing.image);
    return updated;
  }
  async deactivatePartGrade(gradeId: string) {
    await ensureRecord(
      () => prisma.partGrade.findUnique({ where: { id: gradeId } }),
      gradeId,
      "Part grade",
    );
    return prisma.partGrade.update({
      where: { id: gradeId },
      data: { active: false },
    });
  }
  async createPart(data: CreatePartDto) {
    await ensureModelsExist(data.compatibleModelIds);
    const { compatibleModelIds, compatibleServiceIds, ...fields } = data;
    const modelIds = normalizeModelIds(compatibleModelIds);
    const serviceIds = normalizeModelIds(compatibleServiceIds);
    return prisma.$transaction(async (tx) => {
      if (serviceIds.length) {
        if (fields.active === false)
          throw new AppError(
            409,
            "CATALOG_MAPPING_INVALID",
            "Inactive parts cannot be mapped to repair services",
          );
        await ensureActiveModelsForPartMapping(tx, modelIds);
        await ensurePartServiceMappings(tx, modelIds, serviceIds, true);
      }
      return tx.part.create({
        data: {
          ...withoutUndefined(fields),
          ...(compatibleModelIds !== undefined
            ? {
                compatibility: {
                  create: modelIds.map((modelId) => ({ modelId })),
                },
              }
            : {}),
          ...(serviceIds.length
            ? {
                serviceMappings: {
                  create: serviceIds.map((serviceId) => ({
                    service: { connect: { id: serviceId } },
                  })),
                },
              }
            : {}),
        },
        include: {
          compatibility: { include: { model: true } },
          serviceMappings: { include: { service: true } },
        },
      });
    });
  }
  async updatePart(id: string, data: UpdatePartDto) {
    const { compatibleModelIds, compatibleServiceIds, ...fields } = data;
    await ensureModelsExist(compatibleModelIds);
    return prisma.$transaction(async (tx) => {
      const existing = await tx.part.findUnique({
        where: { id },
        include: {
          compatibility: true,
          serviceMappings: {
            include: {
              service: { select: { id: true, compatibility: true } },
            },
          },
        },
      });
      if (!existing) throw new AppError(404, "NOT_FOUND", "Part not found");
      const modelIds = normalizeModelIds(
        compatibleModelIds ??
          existing.compatibility.map(({ modelId }) => modelId),
      );
      const serviceIds = normalizeModelIds(
        compatibleServiceIds ??
          existing.serviceMappings.map(({ serviceId }) => serviceId),
      );
      if (
        compatibleServiceIds !== undefined &&
        (fields.active ?? existing.active) === false &&
        serviceIds.length
      )
        throw new AppError(
          409,
          "CATALOG_MAPPING_INVALID",
          "Inactive parts cannot be mapped to repair services",
        );
      if (compatibleModelIds !== undefined && serviceIds.length)
        await ensureActiveModelsForPartMapping(tx, modelIds);
      await ensurePartServiceMappings(
        tx,
        modelIds,
        serviceIds,
        compatibleServiceIds !== undefined,
      );
      if (compatibleModelIds !== undefined) {
        await tx.partCompatibility.deleteMany({ where: { partId: id } });
        if (modelIds.length)
          await tx.partCompatibility.createMany({
            data: modelIds.map((modelId) => ({ modelId, partId: id })),
          });
      }
      if (compatibleServiceIds !== undefined) {
        await tx.repairServicePart.deleteMany({ where: { partId: id } });
        if (serviceIds.length)
          await tx.repairServicePart.createMany({
            data: serviceIds.map((serviceId) => ({ serviceId, partId: id })),
          });
      }
      return tx.part.update({
        where: { id },
        data: withoutUndefined(fields),
        include: {
          compatibility: { include: { model: true } },
          serviceMappings: { include: { service: true } },
        },
      });
    });
  }
  async deactivatePart(id: string) {
    await ensureRecord(
      () => prisma.part.findUnique({ where: { id: id } }),
      id,
      "Part",
    );
    return prisma.part.update({ where: { id }, data: { active: false } });
  }
}

/** Shared stateless catalog operations used by all resource controllers. */
export const catalogService = new CatalogService();
