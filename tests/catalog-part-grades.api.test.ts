import express from "express";
import request from "supertest";
import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { errorHandler } from "../src/middlewares/errors";
import { standardizeApiResponse } from "../src/middlewares/api-response";

const partId = "00000000-0000-4000-8000-000000000101";
const gradeId = "00000000-0000-4000-8000-000000000102";
const modelId = "00000000-0000-4000-8000-000000000103";
const serviceId = "00000000-0000-4000-8000-000000000104";

const partFindUnique = jest.fn();
const partFindFirst = jest.fn();
const serviceFindMany = jest.fn();
const serviceFindFirst = jest.fn();
const serviceFindUnique = jest.fn();
const modelFindFirst = jest.fn();
const gradeFindFirst = jest.fn();
const gradeFindMany = jest.fn();
const gradeFindUnique = jest.fn();
const gradeCreate = jest.fn();
const gradeUpdate = jest.fn();
const db: Record<string, unknown> = {};
Object.assign(db, {
  brand: { count: jest.fn().mockResolvedValue(0) },
  deviceModel: {
    count: jest.fn().mockResolvedValue(0),
    findMany: jest.fn(),
    findFirst: modelFindFirst,
  },
  repairCategory: { findUnique: jest.fn() },
  repairService: {
    findMany: serviceFindMany,
    findFirst: serviceFindFirst,
    findUnique: serviceFindUnique,
    count: jest.fn().mockResolvedValue(0),
  },
  part: {
    findUnique: partFindUnique,
    findFirst: partFindFirst,
    count: jest.fn().mockResolvedValue(0),
  },
  partGrade: {
    findFirst: gradeFindFirst,
    findMany: gradeFindMany,
    findUnique: gradeFindUnique,
    create: gradeCreate,
    update: gradeUpdate,
    count: jest.fn().mockResolvedValue(0),
  },
});
db.$transaction = jest.fn((callback: (tx: PrismaClient) => unknown) =>
  callback(db as unknown as PrismaClient),
);

describe("part grade catalogue APIs", () => {
  let app: express.Express;
  const uploadedFiles: string[] = [];

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
          (...roles: string[]) =>
          (
            req: express.Request,
            _res: express.Response,
            next: express.NextFunction,
          ) =>
            req.auth && roles.some((role) => req.auth?.roles.includes(role))
              ? next()
              : next(new AppError(403, "FORBIDDEN", "Insufficient role")),
      };
    });
    const { default: catalogRoutes } = await import(
      "../src/modules/catalog/catalog.routes"
    );
    app = express();
    app.use(express.json());
    app.use(standardizeApiResponse);
    app.use("/api/v1/catalog", catalogRoutes);
    app.use("/api/v1/admin/catalog", catalogRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    partFindUnique.mockResolvedValue({ id: partId, active: true });
    partFindFirst.mockResolvedValue({ id: partId });
    modelFindFirst.mockResolvedValue({ id: modelId });
    serviceFindUnique.mockResolvedValue({ id: serviceId });
    serviceFindFirst.mockResolvedValue({ id: serviceId });
    serviceFindMany.mockResolvedValue([]);
    gradeFindFirst.mockResolvedValue(null);
    gradeFindMany.mockResolvedValue([]);
    gradeFindUnique.mockResolvedValue({
      id: gradeId,
      partId,
      name: "configured grade",
      price: "499.00",
      image: null,
      active: true,
    });
    gradeCreate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: gradeId,
        ...data,
        active: data.active ?? true,
      }),
    );
    gradeUpdate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: gradeId,
        partId,
        name: "configured grade",
        price: "499.00",
        image: null,
        active: true,
        ...data,
      }),
    );
  });

  afterAll(async () => {
    await Promise.all(
      uploadedFiles.map((file) => fs.unlink(file).catch(() => undefined)),
    );
  });

  const asAdmin = (test: request.Test) =>
    test.set("x-test-user", "admin").set("x-test-role", "ADMIN");

  it("returns public grades without IDs and keeps admin reads protected", async () => {
    const denied = await request(app).get(
      `/api/v1/catalog/parts/${partId}/grades`,
    );
    expect(denied.status).toBe(200);

    const customerRead = await request(app)
      .get(`/api/v1/catalog/parts/${partId}/grades`)
      .set("x-test-user", "customer");
    expect(customerRead.status).toBe(200);

    const forbidden = await request(app)
      .get(`/api/v1/admin/catalog/parts/${partId}/grades`)
      .set("x-test-user", "customer");
    expect(forbidden.status).toBe(403);

    const deniedMutation = await request(app).post(
      `/api/v1/catalog/parts/${partId}/grades`,
    );
    expect(deniedMutation.status).toBe(401);
  });

  it("returns only active priced grades when given just the part ID", async () => {
    gradeFindMany.mockResolvedValue([
      {
        id: gradeId,
        name: "Original",
        price: "900.00",
        image: "/uploads/catalog/original.png",
      },
    ]);

    const response = await request(app).get(
      `/api/v1/catalog/parts/${partId}/grades`,
    );

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Part grades fetched successfully.");
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: gradeId,
        name: "Original",
        price: "900.00",
        image: expect.stringMatching(/\/uploads\/catalog\/original\.png$/),
      }),
    ]);
    expect(partFindFirst).toHaveBeenCalledWith({
      where: { id: partId, active: true },
      select: { id: true },
    });
    expect(gradeFindMany).toHaveBeenCalledWith({
      where: { partId, active: true, price: { not: null } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, price: true, image: true },
    });
    expect(modelFindFirst).not.toHaveBeenCalled();
    expect(serviceFindFirst).not.toHaveBeenCalled();
  });

  it("returns only selectable grades for the selected part, service, and model", async () => {
    gradeFindMany.mockResolvedValue([
      {
        id: gradeId,
        name: "Original",
        price: "900.00",
        image: "/uploads/catalog/original.png",
      },
    ]);

    const response = await request(app)
      .get(`/api/v1/catalog/parts/${partId}/grades`)
      .query({ modelId, serviceId });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Part grades fetched successfully.");
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: gradeId,
        name: "Original",
        price: "900.00",
        image: expect.stringMatching(/\/uploads\/catalog\/original\.png$/),
      }),
    ]);
    expect(modelFindFirst).toHaveBeenCalledWith({
      where: { id: modelId, active: true, brand: { active: true } },
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
    expect(partFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: partId,
          active: true,
          serviceMappings: { some: { serviceId } },
          compatibility: {
            some: {
              modelId,
              model: { active: true, brand: { active: true } },
            },
          },
        },
      }),
    );
    expect(gradeFindMany).toHaveBeenCalledWith({
      where: { partId, active: true, price: { not: null } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, price: true, image: true },
    });
  });

  it("validates public grade IDs and returns standard errors for unavailable mappings", async () => {
    const missingQuery = await request(app)
      .get(`/api/v1/catalog/parts/${partId}/grades`)
      .query({ modelId });
    expect(missingQuery.status).toBe(400);

    const invalidIds = await request(app)
      .get("/api/v1/catalog/parts/not-a-uuid/grades")
      .query({ modelId, serviceId });
    expect(invalidIds.status).toBe(400);

    serviceFindUnique.mockResolvedValueOnce(null);
    const missingService = await request(app)
      .get(`/api/v1/catalog/parts/${partId}/grades`)
      .query({ modelId, serviceId });
    expect(missingService.status).toBe(404);

    partFindUnique.mockResolvedValueOnce(null);
    const missingPart = await request(app)
      .get(`/api/v1/catalog/parts/${partId}/grades`)
      .query({ modelId, serviceId });
    expect(missingPart.status).toBe(404);

    modelFindFirst.mockResolvedValueOnce(null);
    const inactiveModel = await request(app)
      .get(`/api/v1/catalog/parts/${partId}/grades`)
      .query({ modelId, serviceId });
    expect(inactiveModel.status).toBe(404);

    serviceFindFirst.mockResolvedValueOnce(null);
    const unavailableService = await request(app)
      .get(`/api/v1/catalog/parts/${partId}/grades`)
      .query({ modelId, serviceId });
    expect(unavailableService.status).toBe(400);
    expect(unavailableService.body.error.code).toBe("SERVICE_UNAVAILABLE");

    partFindFirst.mockResolvedValueOnce(null);
    const unavailablePart = await request(app)
      .get(`/api/v1/catalog/parts/${partId}/grades`)
      .query({ modelId, serviceId });
    expect(unavailablePart.status).toBe(400);
    expect(unavailablePart.body.error.code).toBe("PART_UNAVAILABLE");

    gradeFindMany.mockResolvedValueOnce([]);
    const noGrades = await request(app)
      .get(`/api/v1/catalog/parts/${partId}/grades`)
      .query({ modelId, serviceId });
    expect(noGrades.status).toBe(200);
    expect(noGrades.body.data).toEqual([]);
  });

  it("creates and lists grades without duplicating the Part record", async () => {
    const created = await asAdmin(
      request(app).post(`/api/v1/admin/catalog/parts/${partId}/grades`),
    ).send({ name: "configured grade", price: 499.25 });
    expect(created.status).toBe(201);
    expect(gradeCreate).toHaveBeenCalledWith({
      data: { partId, name: "configured grade", price: 499.25 },
    });

    gradeFindMany.mockResolvedValue([created.body.data]);
    const listed = await asAdmin(
      request(app).get(`/api/v1/admin/catalog/parts/${partId}/grades`),
    );
    expect(listed.status).toBe(200);
    expect(listed.body.data[0].id).toBe(gradeId);
  });

  it("rejects missing parent parts, malformed IDs, and duplicate names", async () => {
    const invalidId = await asAdmin(
      request(app).get("/api/v1/catalog/parts/not-a-uuid/grades"),
    );
    expect(invalidId.status).toBe(400);

    partFindUnique.mockResolvedValueOnce(null);
    const missingPart = await asAdmin(
      request(app).post(`/api/v1/catalog/parts/${partId}/grades`),
    ).send({ name: "grade" });
    expect(missingPart.status).toBe(404);

    gradeFindFirst.mockResolvedValueOnce({ id: "existing" });
    const duplicate = await asAdmin(
      request(app).post(`/api/v1/catalog/parts/${partId}/grades`),
    ).send({ name: "configured grade" });
    expect(duplicate.status).toBe(409);
  });

  it("accepts a catalog image upload and rejects unsupported or oversized files", async () => {
    const created = await asAdmin(
      request(app).post(`/api/v1/catalog/parts/${partId}/grades`),
    )
      .field("name", "image grade")
      .attach("image", Buffer.from("test-image"), {
        filename: "grade.png",
        contentType: "image/png",
      });
    expect(created.status).toBe(201);
    expect(created.body.data.image).toMatch(/^\/uploads\/catalog\//);
    uploadedFiles.push(
      path.resolve(
        process.cwd(),
        "uploads",
        "catalog",
        path.basename(created.body.data.image),
      ),
    );

    const unsupported = await asAdmin(
      request(app).post(`/api/v1/catalog/parts/${partId}/grades`),
    )
      .field("name", "unsupported image")
      .attach("image", Buffer.from("gif"), {
        filename: "grade.gif",
        contentType: "image/gif",
      });
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error.code).toBe("INVALID_UPLOAD");

    const oversized = await asAdmin(
      request(app).post(`/api/v1/catalog/parts/${partId}/grades`),
    )
      .field("name", "oversized image")
      .attach("image", Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: "large.png",
        contentType: "image/png",
      });
    expect(oversized.status).toBe(413);
  });

  it("removes uploaded catalog files when request validation fails", async () => {
    const uploadDirectory = path.resolve(process.cwd(), "uploads", "catalog");
    const before = new Set(await fs.readdir(uploadDirectory));

    const response = await asAdmin(request(app).post("/api/v1/catalog/brands"))
      .attach("image", Buffer.from("invalid-brand-image"), {
        filename: "invalid-brand.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(await fs.readdir(uploadDirectory)).toEqual([...before]);
  });

  it("updates a grade, clears its image explicitly, and deactivates instead of deleting", async () => {
    gradeFindUnique.mockResolvedValueOnce({
      id: gradeId,
      partId,
      image: "/uploads/catalog/old-grade.png",
    });
    const updated = await asAdmin(
      request(app).patch(`/api/v1/catalog/part-grades/${gradeId}`),
    ).send({ price: 599.99, clearImage: true });
    expect(updated.status).toBe(200);
    expect(gradeUpdate).toHaveBeenCalledWith({
      where: { id: gradeId },
      data: { price: 599.99, image: null },
    });

    const deactivated = await asAdmin(
      request(app).delete(`/api/v1/catalog/part-grades/${gradeId}`),
    );
    expect(deactivated.status).toBe(200);
    expect(gradeUpdate).toHaveBeenLastCalledWith({
      where: { id: gradeId },
      data: { active: false },
    });
  });

  it("supports replacing the image while changing only the grade status", async () => {
    gradeFindUnique.mockResolvedValueOnce({ id: gradeId, partId, image: null });
    const updated = await asAdmin(
      request(app).patch(`/api/v1/admin/catalog/part-grades/${gradeId}`),
    )
      .field("active", "false")
      .attach("image", Buffer.from("replacement-image"), {
        filename: "replacement.webp",
        contentType: "image/webp",
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.image).toMatch(/^\/uploads\/catalog\//);
    expect(gradeUpdate).toHaveBeenCalledWith({
      where: { id: gradeId },
      data: expect.objectContaining({
        active: false,
        image: expect.stringMatching(/^\/uploads\/catalog\//),
      }),
    });
    uploadedFiles.push(
      path.resolve(
        process.cwd(),
        "uploads",
        "catalog",
        path.basename(updated.body.data.image),
      ),
    );
  });

  it("returns only active priced grades nested beneath the mapped compatible part", async () => {
    const grade = {
      id: gradeId,
      name: "configured grade",
      price: "499.00",
      image: "/uploads/catalog/grade.webp",
    };
    serviceFindMany.mockResolvedValue([
      {
        id: serviceId,
        name: "Screen service",
        description: null,
        basePrice: null,
        image: null,
        category: { id: "category", name: "Screen" },
        partMappings: [
          {
            part: {
              id: partId,
              name: "Display assembly",
              sku: "DISPLAY-1",
              sellingPrice: null,
              image: null,
              grades: [grade],
            },
          },
        ],
      },
    ]);
    const response = await request(app)
      .get("/api/v1/catalog/services")
      .query({ modelId, serviceId });

    expect(response.status).toBe(200);
    expect(response.body.data[0].services[0].parts[0].grades).toEqual([
      expect.objectContaining({
        id: gradeId,
        name: "configured grade",
        price: "499.00",
      }),
    ]);
    expect(response.body.data[0].services[0].parts[0].grades[0].image).toMatch(
      /\/uploads\/catalog\/grade.webp$/,
    );
    const query = serviceFindMany.mock.calls[0][0];
    expect(query.select.partMappings.select.part.select.grades).toEqual(
      expect.objectContaining({
        where: { active: true, price: { not: null } },
      }),
    );
  });
});
