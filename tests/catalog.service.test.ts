import {
  brandSchemas,
  partSchemas,
  serviceBrowseSchema,
} from "../src/validation/catalog";

let mockPrisma: unknown;
let CatalogService: typeof import("../src/modules/catalog/catalog.service").CatalogService;

async function loadCatalogService(database: unknown) {
  jest.resetModules();
  mockPrisma = database;
  jest.doMock("../src/config/database", () => ({ prisma: mockPrisma }));
  ({ CatalogService } = await import("../src/modules/catalog/catalog.service"));
  return new CatalogService();
}

describe("CatalogService", () => {
  it("applies brand search, sort, and pagination filters", async () => {
    const rows = [{ id: "brand-1", name: "Apple", image: null }];
    const findMany = jest.fn().mockResolvedValue(rows);
    const count = jest.fn().mockResolvedValue(6);
    const service = await loadCatalogService({ brand: { findMany, count } });
    const query = brandSchemas.list.parse({
      body: {},
      params: {},
      query: {
        page: 2,
        pageSize: 5,
        search: "apple",
        sortBy: "name",
        sortOrder: "desc",
      },
    }).query;

    await expect(service.listBrands(query)).resolves.toEqual({
      items: rows,
      pagination: { page: 2, pageSize: 5, total: 6, totalPages: 2 },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { OR: [{ name: { contains: "apple", mode: "insensitive" } }] },
      skip: 5,
      take: 5,
      orderBy: [{ name: "desc" }],
    });
    expect(count).toHaveBeenCalledWith({
      where: { OR: [{ name: { contains: "apple", mode: "insensitive" } }] },
    });
  });

  it("keeps public service model, category, text, and price filters together", async () => {
    const modelId = "00000000-0000-4000-8000-000000000001";
    const categoryId = "00000000-0000-4000-8000-000000000002";
    const serviceId = "00000000-0000-4000-8000-000000000003";
    const findMany = jest.fn().mockResolvedValue([]);
    const service = await loadCatalogService({
      deviceModel: { findFirst: jest.fn().mockResolvedValue({ id: modelId }) },
      repairService: { findMany },
    });
    const query = serviceBrowseSchema.parse({
      body: {},
      params: {},
      query: {
        modelId,
        categoryId,
        serviceId,
        search: "screen",
        minPrice: 100,
        maxPrice: 500,
      },
    }).query;

    await expect(service.browseServices(query)).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          category: { active: true },
          categoryId,
          id: serviceId,
          compatibility: expect.objectContaining({
            some: expect.objectContaining({ modelId }),
          }),
          OR: [{ name: { contains: "screen", mode: "insensitive" } }],
          basePrice: { gte: 100, lte: 500 },
        }),
        orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
      }),
    );
  });

  it("rejects service mappings to inactive models", async () => {
    const modelId = "00000000-0000-4000-8000-000000000001";
    const serviceId = "00000000-0000-4000-8000-000000000002";
    const tx = {
      deviceModel: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: modelId, active: false, brand: { active: true } },
          ]),
      },
    };
    const database = {
      deviceModel: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const service = await loadCatalogService(database);
    const input = partSchemas.create.parse({
      body: {
        sellingPrice: 25,
        compatibleModelIds: [modelId],
        compatibleServiceIds: [serviceId],
      },
      params: {},
      query: {},
    }).body;

    await expect(service.createPart(input)).rejects.toMatchObject({
      status: 409,
      code: "CATALOG_MAPPING_INVALID",
    });
    expect(tx.deviceModel.findMany).toHaveBeenCalled();
  });
});
