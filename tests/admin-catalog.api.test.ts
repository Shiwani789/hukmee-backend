import express from "express";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { errorHandler } from "../src/middlewares/errors";

describe("admin catalogue CRUD", () => {
  const brand = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Hukmee",
    active: true,
  };
  const findBrand = jest.fn(async () => brand);
  const createBrand = jest.fn(async ({ data }: { data: { name: string } }) => ({
    ...brand,
    ...data,
  }));
  const updateBrand = jest.fn(
    async ({ data }: { data: Partial<typeof brand> }) => ({
      ...brand,
      ...data,
    }),
  );
  const findBrands = jest.fn(async () => [brand]);
  const countBrands = jest.fn(async () => 1);
  const createPart = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "part-1",
      ...data,
    }),
  );
  let app: express.Express;

  beforeAll(async () => {
    const db: Record<string, unknown> = {
      brand: {
        findUnique: findBrand,
        findMany: findBrands,
        count: countBrands,
        create: createBrand,
        update: updateBrand,
      },
      part: { create: createPart },
      deviceModel: { count: jest.fn().mockResolvedValue(0) },
    };
    db.$transaction = jest.fn((callback: (tx: PrismaClient) => unknown) =>
      callback(db as unknown as PrismaClient),
    );
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
          const role = req.header("x-test-role") ?? "USER";
          req.auth = {
            userId: "admin",
            sessionId: "test",
            roles: [role],
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
    app.use("/api/v1/catalog", routes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper — sends as ADMIN role (Davai style: role-based, no permission header)
  const asAdmin = (r: request.Test) =>
    r.set("x-test-user", "admin").set("x-test-role", "ADMIN");

  it("requires ADMIN role and validates input before writes", async () => {
    // No auth → 401
    expect(
      (
        await request(app)
          .post("/api/v1/catalog/brands")
          .send({ name: "Hukmee" })
      ).status,
    ).toBe(401);
    // Wrong role → 403
    expect(
      (
        await request(app)
          .post("/api/v1/catalog/brands")
          .set("x-test-user", "admin")
          .set("x-test-role", "USER")
          .send({ name: "Hukmee" })
      ).status,
    ).toBe(403);
    // Blank name → 400
    const invalid = await asAdmin(
      request(app).post("/api/v1/catalog/brands"),
    ).send({ name: " " });
    expect(invalid.status).toBe(400);
    expect(createBrand).not.toHaveBeenCalled();
  });

  it("creates and lists brands with pagination", async () => {
    const created = await asAdmin(
      request(app).post("/api/v1/catalog/brands"),
    ).send({ name: "Hukmee" });
    expect(created.status).toBe(201);
    expect(createBrand).toHaveBeenCalledWith({ data: { name: "Hukmee" } });
    const listed = await asAdmin(
      request(app).get("/api/v1/catalog/brands/paginated?page=1&pageSize=10"),
    );
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual({
      items: [brand],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
  });

  it("accepts an optional image reference and rejects unsupported image values", async () => {
    const withImage = await asAdmin(
      request(app).post("/api/v1/catalog/brands"),
    ).send({ name: "Hukmee", image: "/uploads/catalog/brand.png" });
    expect(withImage.status).toBe(201);
    expect(createBrand).toHaveBeenCalledWith({
      data: { name: "Hukmee", image: "/uploads/catalog/brand.png" },
    });

    const invalid = await asAdmin(
      request(app).post("/api/v1/catalog/brands"),
    ).send({ name: "Hukmee", image: "javascript:alert(1)" });
    expect(invalid.status).toBe(400);
  });

  it("requires sellingPrice when creating a Part", async () => {
    const missingPrice = await asAdmin(
      request(app).post("/api/v1/catalog/parts"),
    ).send({ sku: "P-1", name: "Screen" });
    expect(missingPrice.status).toBe(400);
    expect(createPart).not.toHaveBeenCalled();

    const created = await asAdmin(
      request(app).post("/api/v1/catalog/parts"),
    ).send({ sku: "P-1", name: "Screen", sellingPrice: 129.99 });
    expect(created.status).toBe(201);
    expect(createPart).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { sku: "P-1", name: "Screen", sellingPrice: 129.99 },
      }),
    );
  });

  it("allows creating a Part without a name or SKU", async () => {
    const created = await asAdmin(
      request(app).post("/api/v1/catalog/parts"),
    ).send({ sellingPrice: 129.99 });

    expect(created.status).toBe(201);
    expect(createPart).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { sellingPrice: 129.99 } }),
    );
  });

  it("gets, updates, and deactivates a brand", async () => {
    const id = brand.id;
    expect(
      (await asAdmin(request(app).get(`/api/v1/catalog/brands/${id}`))).status,
    ).toBe(200);
    const updated = await asAdmin(
      request(app).patch(`/api/v1/catalog/brands/${id}`),
    ).send({ name: "Updated" });
    expect(updated.status).toBe(200);
    expect(updateBrand).toHaveBeenCalledWith({
      where: { id },
      data: { name: "Updated" },
    });
    const deleted = await asAdmin(
      request(app).delete(`/api/v1/catalog/brands/${id}`),
    );
    expect(deleted.status).toBe(200);
    expect(updateBrand).toHaveBeenLastCalledWith({
      where: { id },
      data: { active: false },
    });
  });
});
