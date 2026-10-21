import express from "express";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { errorHandler } from "../src/middlewares/errors";
import { standardizeApiResponse } from "../src/middlewares/api-response";

const modelId = "00000000-0000-4000-8000-000000000001";
const otherModelId = "00000000-0000-4000-8000-000000000002";
const serviceId = "00000000-0000-4000-8000-000000000003";
const partId = "00000000-0000-4000-8000-000000000004";

const model = { id: modelId, active: true, brand: { active: true } };
const service = {
  id: serviceId,
  name: "Screen repair",
  active: true,
  compatibility: [{ modelId }],
};
const part = {
  id: partId,
  name: "Display assembly",
  sku: "DISP-001",
  sellingPrice: "349.00",
  image: null,
  grades: [],
};

const modelCount = jest.fn();
const modelFindMany = jest.fn();
const modelFindFirst = jest.fn();
const categoryFindMany = jest.fn();
const categoryFindFirst = jest.fn();
const serviceFindMany = jest.fn();
const serviceFindFirst = jest.fn();
const serviceFindUnique = jest.fn();
const serviceUpdate = jest.fn();
const partFindMany = jest.fn();
const partFindUnique = jest.fn();
const partCreate = jest.fn();
const partUpdate = jest.fn();
const mappingDeleteMany = jest.fn();
const mappingCreateMany = jest.fn();
const compatibilityDeleteMany = jest.fn();
const compatibilityCreateMany = jest.fn();
const db: Record<string, unknown> = {};

Object.assign(db, {
  brand: {},
  deviceModel: {
    count: modelCount,
    findMany: modelFindMany,
    findFirst: modelFindFirst,
  },
  repairCategory: {
    findMany: categoryFindMany,
    findFirst: categoryFindFirst,
    findUnique: jest.fn().mockResolvedValue({ id: "category" }),
  },
  repairService: {
    findMany: serviceFindMany,
    findFirst: serviceFindFirst,
    findUnique: serviceFindUnique,
    update: serviceUpdate,
  },
  part: {
    findMany: partFindMany,
    findUnique: partFindUnique,
    create: partCreate,
    update: partUpdate,
  },
  repairServicePart: {
    deleteMany: mappingDeleteMany,
    createMany: mappingCreateMany,
  },
  partCompatibility: {
    deleteMany: compatibilityDeleteMany,
    createMany: compatibilityCreateMany,
  },
});
db.$transaction = jest.fn((callback: (tx: PrismaClient) => unknown) =>
  callback(db as unknown as PrismaClient),
);

describe("catalogue repair service and part mapping", () => {
  let app: express.Express;

  beforeAll(async () => {
    jest.doMock("../src/config/database", () => ({ prisma: db }));
    jest.doMock("../src/middlewares/auth", () => {
      const { AppError } = jest.requireActual(
        "../src/utils/errors",
      ) as typeof import("../src/utils/errors");
      return {
        authenticate: (
          req: express.Request,
          _res: express.Response,
          next: express.NextFunction,
        ) => {
          if (!req.header("x-test-user"))
            return next(
              new AppError(401, "UNAUTHORIZED", "Authentication required"),
            );
          req.auth = {
            userId: "admin",
            sessionId: "test",
            roles: [req.header("x-test-role") ?? "USER"],
            permissions: [],
          };
          next();
        },
        requireRole:
          (...allowed: string[]) =>
          (
            req: express.Request,
            _res: express.Response,
            next: express.NextFunction,
          ) =>
            req.auth && allowed.some((role) => req.auth?.roles.includes(role))
              ? next()
              : next(new AppError(403, "FORBIDDEN", "Insufficient role")),
      };
    });
    const { default: routes } = await import(
      "../src/modules/catalog/catalog.routes"
    );
    app = express();
    app.use(express.json());
    app.use(standardizeApiResponse);
    app.use("/api/v1/catalog", routes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    modelCount.mockResolvedValue(1);
    modelFindMany.mockResolvedValue([model]);
    modelFindFirst.mockResolvedValue(model);
    categoryFindMany.mockResolvedValue([]);
    categoryFindFirst.mockResolvedValue(null);
    serviceFindMany.mockResolvedValue([service]);
    serviceFindFirst.mockResolvedValue(service);
    serviceFindUnique.mockResolvedValue({ id: serviceId });
    serviceUpdate.mockResolvedValue({ id: serviceId });
    partFindMany.mockResolvedValue([]);
    partFindUnique.mockResolvedValue({
      ...part,
      active: true,
      compatibility: [{ modelId }],
      serviceMappings: [],
    });
    partCreate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: partId, ...data }),
    );
    partUpdate.mockResolvedValue({ ...part, active: true });
  });

  const asAdmin = (r: request.Test) =>
    r.set("x-test-user", "admin").set("x-test-role", "ADMIN");

  it("lets an admin create and update a valid part-to-service mapping", async () => {
    const created = await asAdmin(
      request(app).post("/api/v1/catalog/parts"),
    ).send({
      sku: "DISP-001",
      name: "Display assembly",
      sellingPrice: 349,
      compatibleModelIds: [modelId],
      compatibleServiceIds: [serviceId],
    });

    expect(created.status).toBe(201);
    expect(partCreate).toHaveBeenCalledTimes(1);
    const createArgs = partCreate.mock.calls[0][0];
    expect(createArgs.data.serviceMappings.create).toEqual([
      { service: { connect: { id: serviceId } } },
    ]);
    expect(createArgs.data.compatibility.create).toEqual([{ modelId }]);

    const updated = await asAdmin(
      request(app).patch(`/api/v1/catalog/parts/${partId}`),
    ).send({ compatibleServiceIds: [serviceId] });
    expect(updated.status).toBe(200);
    expect(mappingDeleteMany).toHaveBeenCalledWith({ where: { partId } });
    expect(mappingCreateMany).toHaveBeenCalledWith({
      data: [{ serviceId, partId }],
    });
  });

  it("rejects inactive, missing, and model-incompatible service mappings", async () => {
    serviceFindMany.mockResolvedValue([
      { ...service, compatibility: [{ modelId: otherModelId }] },
    ]);
    const incompatible = await asAdmin(
      request(app).post("/api/v1/catalog/parts"),
    ).send({
      sku: "BAD-001",
      name: "Wrong part",
      sellingPrice: 10,
      compatibleModelIds: [modelId],
      compatibleServiceIds: [serviceId],
    });
    expect(incompatible.status).toBe(409);
    expect(incompatible.body.error.code).toBe("CATALOG_MAPPING_INVALID");
    expect(partCreate).not.toHaveBeenCalled();

    serviceFindMany.mockResolvedValue([{ ...service, active: false }]);
    const inactive = await asAdmin(
      request(app).post("/api/v1/catalog/parts"),
    ).send({
      sku: "BAD-002",
      name: "Inactive service part",
      sellingPrice: 10,
      compatibleModelIds: [modelId],
      compatibleServiceIds: [serviceId],
    });
    expect(inactive.status).toBe(409);
    expect(inactive.body.error.code).toBe("CATALOG_MAPPING_INVALID");

    serviceFindMany.mockResolvedValue([]);
    const missing = await asAdmin(
      request(app).post("/api/v1/catalog/parts"),
    ).send({
      sku: "BAD-003",
      name: "Unknown service part",
      sellingPrice: 10,
      compatibleModelIds: [modelId],
      compatibleServiceIds: [serviceId],
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects updating a part mapping that no longer matches its device models", async () => {
    serviceFindMany.mockResolvedValue([
      { ...service, compatibility: [{ modelId }] },
    ]);
    const response = await asAdmin(
      request(app).patch(`/api/v1/catalog/parts/${partId}`),
    ).send({
      compatibleModelIds: [otherModelId],
      compatibleServiceIds: [serviceId],
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CATALOG_MAPPING_INVALID");
    expect(mappingDeleteMany).not.toHaveBeenCalled();
  });

  it("returns only mapped active priced parts for the requested model and service", async () => {
    serviceFindMany.mockResolvedValue([
      {
        id: serviceId,
        name: "Screen repair",
        description: "Replace a damaged screen",
        basePrice: null,
        image: null,
        category: { id: "category-1", name: "Screen" },
        partMappings: [{ part }],
      },
    ]);
    const response = await request(app).get("/api/v1/catalog/services").query({
      modelId,
      serviceId,
    });

    expect(response.status).toBe(200);
    expect(serviceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: serviceId,
          active: true,
          category: { active: true },
          compatibility: {
            some: {
              modelId,
              model: { active: true, brand: { active: true } },
            },
          },
        }),
      }),
    );
    expect(response.body.data).toEqual([
      {
        id: "category-1",
        name: "Screen",
        services: [
          expect.objectContaining({
            id: serviceId,
            name: "Screen repair",
            description: "Replace a damaged screen",
            basePrice: null,
            image: null,
            parts: [
              {
                id: partId,
                name: "Display assembly",
                sku: "DISP-001",
                sellingPrice: "349.00",
                image: null,
                grades: [],
              },
            ],
          }),
        ],
      },
    ]);
    const query = serviceFindMany.mock.calls[0][0];
    expect(query.select.partMappings.where.part).toEqual(
      expect.objectContaining({
        active: true,
        compatibility: {
          some: {
            modelId,
            model: { active: true, brand: { active: true } },
          },
        },
      }),
    );
  });

  it("requires modelId and returns no services for an inactive or unknown model", async () => {
    const missing = await request(app).get("/api/v1/catalog/services");
    expect(missing.status).toBe(400);

    modelFindFirst.mockResolvedValueOnce(null);
    const inactive = await request(app)
      .get("/api/v1/catalog/services")
      .query({ modelId });
    expect(inactive.status).toBe(200);
    expect(inactive.body.data).toEqual([]);
    expect(serviceFindMany).not.toHaveBeenCalled();

    modelFindFirst.mockResolvedValueOnce(null);
    const invalid = await request(app)
      .get("/api/v1/catalog/services")
      .query({ modelId: otherModelId });
    expect(invalid.status).toBe(200);
    expect(invalid.body.data).toEqual([]);
  });

  it("lists categories without nested services and filters them by model compatibility", async () => {
    categoryFindMany.mockResolvedValue([
      { id: "category-1", name: "Battery Replacement" },
    ]);
    const response = await request(app)
      .get("/api/v1/catalog/categories")
      .query({ modelId });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      { id: "category-1", name: "Battery Replacement" },
    ]);
    expect(categoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: true,
          services: {
            some: {
              active: true,
              compatibility: {
                some: {
                  modelId,
                  model: { active: true, brand: { active: true } },
                },
              },
            },
          },
        },
        select: { id: true, name: true },
      }),
    );

    modelFindFirst.mockResolvedValueOnce(null);
    const inactiveModel = await request(app)
      .get("/api/v1/catalog/categories")
      .query({ modelId: otherModelId });
    expect(inactiveModel.status).toBe(200);
    expect(inactiveModel.body.data).toEqual([]);
    expect(categoryFindMany).toHaveBeenCalledTimes(1);

    const invalidModelId = await request(app)
      .get("/api/v1/catalog/categories")
      .query({ modelId: "bad-id" });
    expect(invalidModelId.status).toBe(400);
  });

  it("returns flat services for a selected category while retaining compatibility filters", async () => {
    serviceFindMany.mockResolvedValue([
      {
        id: serviceId,
        name: "Battery Change",
        description: "Replace battery",
        basePrice: null,
        image: null,
        category: { id: "category-1", name: "Battery Replacement" },
        partMappings: [],
      },
    ]);
    const response = await request(app)
      .get("/api/v1/catalog/services")
      .query({ modelId, categoryId: "00000000-0000-4000-8000-000000000008" });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: serviceId,
        name: "Battery Change",
        basePrice: null,
        parts: [],
      }),
    ]);
    expect(response.body.data[0]).not.toHaveProperty("category");
    expect(serviceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          category: { active: true },
          categoryId: "00000000-0000-4000-8000-000000000008",
          compatibility: {
            some: {
              modelId,
              model: { active: true, brand: { active: true } },
            },
          },
        }),
      }),
    );

    const invalidCategoryId = await request(app)
      .get("/api/v1/catalog/services")
      .query({ modelId, categoryId: "bad-id" });
    expect(invalidCategoryId.status).toBe(400);
    expect(serviceFindMany).toHaveBeenCalledTimes(1);
  });

  it("gets a category's services, compatible parts, and priced grades using categoryId alone", async () => {
    categoryFindFirst.mockResolvedValue({
      id: "category-1",
      name: "Battery Replacement",
      services: [
        {
          id: serviceId,
          name: "Battery Change",
          description: "Replace battery",
          basePrice: null,
          image: null,
          partMappings: [
            {
              part: {
                ...part,
                grades: [
                  {
                    id: "grade-1",
                    name: "Premium",
                    price: "900.00",
                    image: null,
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const response = await request(app).get(
      "/api/v1/catalog/categories/00000000-0000-4000-8000-000000000008/services",
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      id: "category-1",
      name: "Battery Replacement",
      services: [
        expect.objectContaining({
          id: serviceId,
          name: "Battery Change",
          parts: [
            expect.objectContaining({
              id: partId,
              sellingPrice: "349.00",
              grades: [
                expect.objectContaining({ name: "Premium", price: "900.00" }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(categoryFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "00000000-0000-4000-8000-000000000008",
          active: true,
        },
        select: expect.objectContaining({
          services: expect.objectContaining({
            where: {
              active: true,
              compatibility: {
                some: {
                  model: { active: true, brand: { active: true } },
                },
              },
            },
          }),
        }),
      }),
    );
  });

  it("gets only active parts mapped to the service and compatible with the model", async () => {
    partFindMany.mockResolvedValue([
      {
        ...part,
        image: "/uploads/catalog/part.png",
        grades: [
          {
            id: "grade-1",
            name: "Original",
            price: "900.00",
            image: "/uploads/catalog/grade.png",
          },
        ],
      },
      {
        id: "00000000-0000-4000-8000-000000000009",
        name: "Second part",
        sku: null,
        sellingPrice: null,
        image: null,
        grades: [],
      },
    ]);

    const response = await request(app)
      .get(`/api/v1/catalog/services/${serviceId}/parts`)
      .query({ modelId });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Parts fetched successfully.");
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: partId,
        name: "Display assembly",
        sellingPrice: "349.00",
        image: expect.stringMatching(/\/uploads\/catalog\/part\.png$/),
        grades: [
          expect.objectContaining({
            id: "grade-1",
            name: "Original",
            price: "900.00",
            image: expect.stringMatching(/\/uploads\/catalog\/grade\.png$/),
          }),
        ],
      }),
      expect.objectContaining({ id: "00000000-0000-4000-8000-000000000009" }),
    ]);
    expect(serviceFindUnique).toHaveBeenCalledWith({
      where: { id: serviceId },
      select: { id: true },
    });
    expect(serviceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
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
      }),
    );
    expect(partFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
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
        select: expect.objectContaining({
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
        }),
      }),
    );
  });

  it("handles invalid IDs, unknown services, incompatible models, and no matching parts", async () => {
    const missingModel = await request(app).get(
      `/api/v1/catalog/services/${serviceId}/parts`,
    );
    expect(missingModel.status).toBe(400);

    const invalidService = await request(app)
      .get("/api/v1/catalog/services/not-a-uuid/parts")
      .query({ modelId });
    expect(invalidService.status).toBe(400);

    const invalidModel = await request(app)
      .get(`/api/v1/catalog/services/${serviceId}/parts`)
      .query({ modelId: "bad-id" });
    expect(invalidModel.status).toBe(400);

    serviceFindUnique.mockResolvedValueOnce(null);
    const unknownService = await request(app)
      .get(`/api/v1/catalog/services/${serviceId}/parts`)
      .query({ modelId });
    expect(unknownService.status).toBe(404);

    serviceFindFirst.mockResolvedValueOnce(null);
    const incompatible = await request(app)
      .get(`/api/v1/catalog/services/${serviceId}/parts`)
      .query({ modelId });
    expect(incompatible.status).toBe(200);
    expect(incompatible.body.data).toEqual([]);

    partFindMany.mockResolvedValueOnce([]);
    const empty = await request(app)
      .get(`/api/v1/catalog/services/${serviceId}/parts`)
      .query({ modelId });
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);
  });

  it("groups compatible services by category and preserves parts, grades, and prices", async () => {
    serviceFindMany.mockResolvedValue([
      {
        id: serviceId,
        name: "Display Assembly",
        description: null,
        basePrice: "799.00",
        image: null,
        category: { id: "category-1", name: "Battery Replacement" },
        partMappings: [
          {
            part: {
              ...part,
              grades: [
                {
                  id: "grade-1",
                  name: "Premium",
                  price: "99.00",
                  image: null,
                },
              ],
            },
          },
        ],
      },
      {
        id: "00000000-0000-4000-8000-000000000005",
        name: "Screen Replacement",
        description: "Replace a broken display",
        basePrice: "1200.00",
        image: "/uploads/catalog/second-service.png",
        category: { id: "category-1", name: "Battery Replacement" },
        partMappings: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000006",
        name: "Charging Port Repair",
        description: null,
        basePrice: null,
        image: null,
        category: { id: "category-2", name: "Charging" },
        partMappings: [],
      },
    ]);

    const response = await request(app)
      .get("/api/v1/catalog/services")
      .query({ modelId });

    expect(response.status).toBe(200);
    expect(serviceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          category: { active: true },
          compatibility: {
            some: {
              modelId,
              model: { active: true, brand: { active: true } },
            },
          },
        }),
      }),
    );
    expect(response.body.data).toEqual([
      {
        id: "category-1",
        name: "Battery Replacement",
        services: [
          expect.objectContaining({
            id: serviceId,
            name: "Display Assembly",
            basePrice: "799.00",
            parts: [
              expect.objectContaining({
                sellingPrice: "349.00",
                grades: [
                  expect.objectContaining({
                    name: "Premium",
                    price: "99.00",
                  }),
                ],
              }),
            ],
          }),
          expect.objectContaining({
            id: "00000000-0000-4000-8000-000000000005",
            name: "Screen Replacement",
            basePrice: "1200.00",
          }),
        ],
      },
      {
        id: "category-2",
        name: "Charging",
        services: [
          expect.objectContaining({
            id: "00000000-0000-4000-8000-000000000006",
            name: "Charging Port Repair",
          }),
        ],
      },
    ]);
  });

  it("returns an empty parts list when a service has no mappings and requires modelId for serviceId", async () => {
    serviceFindMany.mockResolvedValue([
      {
        id: serviceId,
        name: "Screen repair",
        description: null,
        basePrice: null,
        image: null,
        category: { id: "category-1", name: "Screen" },
        partMappings: [],
      },
    ]);
    const empty = await request(app)
      .get("/api/v1/catalog/services")
      .query({ modelId, serviceId });
    expect(empty.status).toBe(200);
    expect(empty.body.data[0].services[0].parts).toEqual([]);

    const invalid = await request(app)
      .get("/api/v1/catalog/services")
      .query({ serviceId });
    expect(invalid.status).toBe(400);
  });

  it("rejects inactive parts when adding a service mapping", async () => {
    const response = await asAdmin(
      request(app).post("/api/v1/catalog/parts"),
    ).send({
      sku: "INACTIVE-001",
      name: "Inactive part",
      sellingPrice: 10,
      active: false,
      compatibleModelIds: [modelId],
      compatibleServiceIds: [serviceId],
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CATALOG_MAPPING_INVALID");
    expect(partCreate).not.toHaveBeenCalled();
  });
});
