import { z } from "zod";

// ── Shared primitives ────────────────────────────────────────────────
const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(25);
const uuid = z.uuid();
const image = z
  .string()
  .trim()
  .max(255)
  .regex(/^\/uploads\/catalog\/[A-Za-z0-9_.-]+$/);
const sellingPrice = z
  .number()
  .finite()
  .min(0)
  .max(9_999_999_999.99)
  .refine((v) => Number.isInteger(v * 100));
const gradePrice = sellingPrice.nullable().optional();

// ── Allowlisted sort fields per entity ────────────────────────────────
const brandSortFields = z.enum(["name", "createdAt"]).default("name");
const modelSortFields = z.enum(["name", "createdAt"]).default("name");
const categorySortFields = z.enum(["name", "createdAt"]).default("name");
const serviceSortFields = z
  .enum(["name", "basePrice", "createdAt"])
  .default("name");
const partSortFields = z
  .enum(["name", "sku", "sellingPrice", "createdAt"])
  .default("name");
const sortOrder = z.enum(["asc", "desc"]).default("asc");

// ── Shared list-query base ─────────────────────────────────────────────
const listQuery = z.object({
  page,
  pageSize,
  search: z.string().trim().max(100).optional(),
  active: z.enum(["true", "false"]).optional(),
  sortOrder,
});

const idSchema = z.object({
  body: z.object({}),
  params: z.object({ id: uuid }),
  query: z.object({}),
});
// ── Browse query schemas ──────────────────────────────────────────────
export const brandBrowseSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    search: z.string().trim().max(100).optional(),
    sortOrder,
  }),
});

export const modelBrowseSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    brandId: uuid.optional(),
    search: z.string().trim().max(100).optional(),
    sortOrder,
  }),
});

export const categoryBrowseSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    modelId: uuid.optional(),
    sortOrder,
  }),
});

export const categoryServicesSchema = z.object({
  body: z.object({}),
  params: z.object({ categoryId: uuid }),
  query: z.object({ modelId: uuid.optional() }),
});

export const servicePartsSchema = z.object({
  body: z.object({}),
  params: z.object({ serviceId: uuid }),
  query: z.object({ modelId: uuid }),
});

export const partGradeBrowseSchema = z.object({
  body: z.object({}),
  params: z.object({ partId: uuid }),
  query: z
    .object({ modelId: uuid.optional(), serviceId: uuid.optional() })
    .refine(
      ({ modelId, serviceId }) =>
        (modelId === undefined) === (serviceId === undefined),
      {
        message: "modelId and serviceId must be supplied together",
        path: ["modelId"],
      },
    ),
});

export const serviceBrowseSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    modelId: uuid,
    categoryId: uuid.optional(),
    serviceId: uuid.optional(),
    search: z.string().trim().max(100).optional(),
    minPrice: z.coerce.number().finite().min(0).optional(),
    maxPrice: z.coerce.number().finite().min(0).optional(),
    sortOrder,
  }),
});

// ── Admin brand schemas ────────────────────────────────────────────────
export const brandSchemas = {
  list: z.object({
    body: z.object({}),
    params: z.object({}),
    query: listQuery.extend({ sortBy: brandSortFields }),
  }),
  id: idSchema,
  create: z.object({
    body: z.object({
      name: z.string().trim().min(1).max(100),
      image: image.optional(),
    }),
    params: z.object({}),
    query: z.object({}),
  }),
  update: z.object({
    body: z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        active: z.boolean().optional(),
        image: image.optional(),
      })
      .refine((v) => Object.keys(v).length > 0),
    params: z.object({ id: uuid }),
    query: z.object({}),
  }),
};

// ── Admin model schemas ────────────────────────────────────────────────
export const modelSchemas = {
  list: z.object({
    body: z.object({}),
    params: z.object({}),
    query: listQuery.extend({
      brandId: uuid.optional(),
      sortBy: modelSortFields,
    }),
  }),
  id: idSchema,
  create: z.object({
    body: z.object({
      brandId: uuid,
      name: z.string().trim().min(1).max(100),
      image: image.optional(),
    }),
    params: z.object({}),
    query: z.object({}),
  }),
  update: z.object({
    body: z
      .object({
        brandId: uuid.optional(),
        name: z.string().trim().min(1).max(100).optional(),
        active: z.boolean().optional(),
        image: image.optional(),
      })
      .refine((v) => Object.keys(v).length > 0),
    params: z.object({ id: uuid }),
    query: z.object({}),
  }),
};

// ── Admin category schemas ─────────────────────────────────────────────
export const categorySchemas = {
  list: z.object({
    body: z.object({}),
    params: z.object({}),
    query: listQuery.extend({ sortBy: categorySortFields }),
  }),
  id: idSchema,
  create: z.object({
    body: z.object({ name: z.string().trim().min(1).max(100) }),
    params: z.object({}),
    query: z.object({}),
  }),
  update: z.object({
    body: z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        active: z.boolean().optional(),
      })
      .refine((v) => Object.keys(v).length > 0),
    params: z.object({ id: uuid }),
    query: z.object({}),
  }),
};

// ── Admin service schemas ──────────────────────────────────────────────
export const serviceSchemas = {
  list: z.object({
    body: z.object({}),
    params: z.object({}),
    query: listQuery.extend({
      categoryId: uuid.optional(),
      modelId: uuid.optional(),
      minPrice: z.coerce.number().finite().min(0).optional(),
      maxPrice: z.coerce.number().finite().min(0).optional(),
      sortBy: serviceSortFields,
    }),
  }),
  id: idSchema,
  create: z.object({
    body: z.object({
      categoryId: uuid,
      name: z.string().trim().min(1).max(100),
      description: z.string().trim().max(2000).nullable().optional(),
      active: z.boolean().optional(),
      image: image.optional(),
      compatibleModelIds: z.array(uuid).optional(),
    }),
    params: z.object({}),
    query: z.object({}),
  }),
  update: z.object({
    body: z
      .object({
        categoryId: uuid.optional(),
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().max(2000).nullable().optional(),
        active: z.boolean().optional(),
        image: image.optional(),
        compatibleModelIds: z.array(uuid).optional(),
      })
      .refine((v) => Object.keys(v).length > 0),
    params: z.object({ id: uuid }),
    query: z.object({}),
  }),
};

// ── Admin part schemas ─────────────────────────────────────────────────
export const partSchemas = {
  list: z.object({
    body: z.object({}),
    params: z.object({}),
    query: listQuery.extend({
      modelId: uuid.optional(),
      minPrice: z.coerce.number().finite().min(0).optional(),
      maxPrice: z.coerce.number().finite().min(0).optional(),
      sortBy: partSortFields,
    }),
  }),
  id: idSchema,
  create: z.object({
    body: z.object({
      sku: z.string().trim().min(1).max(100).nullable().optional(),
      name: z.string().trim().min(1).max(150).nullable().optional(),
      sellingPrice,
      image: image.optional(),
      active: z.boolean().optional(),
      compatibleModelIds: z.array(uuid).optional(),
      compatibleServiceIds: z.array(uuid).optional(),
    }),
    params: z.object({}),
    query: z.object({}),
  }),
  update: z.object({
    body: z
      .object({
        sku: z.string().trim().min(1).max(100).nullable().optional(),
        name: z.string().trim().min(1).max(150).nullable().optional(),
        sellingPrice: sellingPrice.optional(),
        image: image.optional(),
        active: z.boolean().optional(),
        compatibleModelIds: z.array(uuid).optional(),
        compatibleServiceIds: z.array(uuid).optional(),
      })
      .refine((v) => Object.keys(v).length > 0),
    params: z.object({ id: uuid }),
    query: z.object({}),
  }),
};

export const partGradeSchemas = {
  list: z.object({
    body: z.object({}),
    params: z.object({ partId: uuid }),
    query: z.object({}),
  }),
  create: z.object({
    body: z.object({
      name: z.string().trim().min(1).max(100),
      price: gradePrice,
      image: image.optional(),
      active: z.boolean().optional(),
    }),
    params: z.object({ partId: uuid }),
    query: z.object({}),
  }),
  update: z.object({
    body: z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        price: gradePrice,
        image: image.optional(),
        clearImage: z.boolean().optional(),
        active: z.boolean().optional(),
      })
      .refine(
        (value) =>
          value.name !== undefined ||
          value.price !== undefined ||
          value.image !== undefined ||
          value.clearImage === true ||
          value.active !== undefined,
      )
      .refine((value) => !(value.image && value.clearImage), {
        message: "Upload an image or clear the image, not both",
        path: ["clearImage"],
      }),
    params: z.object({ gradeId: uuid }),
    query: z.object({}),
  }),
  id: z.object({
    body: z.object({}),
    params: z.object({ gradeId: uuid }),
    query: z.object({}),
  }),
};

export type CatalogListQuery = z.infer<typeof listQuery>;
