/**
 * Catalogue search, filter, sort, and pagination tests.
 *
 * Covers:
 *   - Public APIs: active-only records, search, brandId/modelId filters,
 *     sortOrder, minPrice/maxPrice (services), invalid query params → 400
 *   - Admin APIs: auth + ADMIN role required, pagination metadata,
 *     search, active filter, brandId/modelId/categoryId filters,
 *     sortBy (allowlisted), sortOrder, price-range filter
 *   - Device-service compatibility: public services filtered by modelId,
 *     inactive records never returned
 */
import express from "express";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { errorHandler } from "../src/middlewares/errors";

const brandId = "00000000-0000-4000-8000-000000000001";
const modelId = "00000000-0000-4000-8000-000000000002";
const serviceId = "00000000-0000-4000-8000-000000000003";

// ── Fixtures ──────────────────────────────────────────────────────────
const activeBrand = {
  id: brandId,
  name: "Apple",
  image: null,
  active: true,
  createdAt: new Date("2024-01-01"),
};
const inactiveBrand = {
  id: "00000000-0000-4000-8000-000000000009",
  name: "Zzz",
  active: false,
  image: null,
  createdAt: new Date("2023-01-01"),
};

const activeModel = {
  id: modelId,
  name: "iPhone 15",
  image: null,
  active: true,
  brandId,
  brand: activeBrand,
  createdAt: new Date("2024-01-01"),
};
const inactiveModel = {
  id: "00000000-0000-4000-8000-000000000099",
  name: "Obsolete",
  active: false,
  brandId,
  brand: activeBrand,
  image: null,
  createdAt: new Date("2023-01-01"),
};

const activeService = {
  id: serviceId,
  name: "Screen Repair",
  active: true,
  description: "Fix broken screens",
  basePrice: 2999,
  image: null,
  category: { id: "cat-1", name: "Hardware" },
  compatibility: [{ modelId, model: { ...activeModel, brand: activeBrand } }],
  partMappings: [],
  createdAt: new Date("2024-01-01"),
};
const expensiveService = {
  id: "00000000-0000-4000-8000-000000000004",
  name: "Battery Replacement",
  active: true,
  description: "Replace battery",
  basePrice: 9999,
  image: null,
  category: { id: "cat-1", name: "Hardware" },
  compatibility: [],
  partMappings: [],
  createdAt: new Date("2024-01-02"),
};
const inactiveService = {
  id: "00000000-0000-4000-8000-000000000005",
  name: "Old Fix",
  active: false,
  basePrice: 500,
  image: null,
  category: { id: "cat-1", name: "Hardware" },
  compatibility: [],
  partMappings: [],
  createdAt: new Date("2023-01-01"),
};

describe("Catalogue search, filters, sort, and pagination", () => {
  let app: express.Express;

  // ── Prisma mocks ────────────────────────────────────────────────────
  const brandFindMany = jest.fn();
  const brandCount = jest.fn().mockResolvedValue(2);
  const brandFindUnique = jest.fn().mockResolvedValue(activeBrand);
  const brandCreate = jest.fn().mockResolvedValue(activeBrand);
  const brandUpdate = jest
    .fn()
    .mockResolvedValue({ ...activeBrand, active: false });

  const modelFindMany = jest.fn();
  const modelCount = jest.fn().mockResolvedValue(1);
  const modelFindUnique = jest.fn().mockResolvedValue(activeModel);
  const modelFindFirst = jest.fn().mockResolvedValue({ id: modelId });

  const serviceFindMany = jest.fn();
  const serviceCount = jest.fn().mockResolvedValue(2);
  const serviceFindUnique = jest.fn().mockResolvedValue(activeService);

  beforeAll(async () => {
    const db = {
      brand: {
        findMany: brandFindMany,
        count: brandCount,
        findUnique: brandFindUnique,
        create: brandCreate,
        update: brandUpdate,
      },
      deviceModel: {
        findMany: modelFindMany,
        findFirst: modelFindFirst,
        count: modelCount,
        findUnique: modelFindUnique,
        create: jest.fn().mockResolvedValue(activeModel),
        update: jest.fn(),
      },
      repairService: {
        findMany: serviceFindMany,
        count: serviceCount,
        findUnique: serviceFindUnique,
        create: jest.fn(),
        update: jest.fn(),
      },
      category: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "cat-1", name: "Hardware" }),
      },
      part: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((fn: (tx: PrismaClient) => unknown) =>
        fn(db as unknown as PrismaClient),
      ),
    } as unknown as PrismaClient;

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
            userId: req.header("x-test-user")!,
            sessionId: "sess",
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
            req.auth && allowed.some((r) => req.auth?.roles.includes(r))
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
    // Default: return both active + inactive so tests can verify filtering
    brandFindMany.mockResolvedValue([activeBrand, inactiveBrand]);
    modelFindMany.mockResolvedValue([activeModel, inactiveModel]);
    modelFindFirst.mockResolvedValue({ id: modelId });
    serviceFindMany.mockResolvedValue([
      activeService,
      expensiveService,
      inactiveService,
    ]);
  });

  const asAdmin = (r: request.Test) =>
    r.set("x-test-user", "admin").set("x-test-role", "ADMIN");

  // ── 1. PUBLIC — BRANDS ───────────────────────────────────────────────
  describe("Public GET /brands", () => {
    it("returns 200 and passes active:true filter to Prisma", async () => {
      brandFindMany.mockResolvedValue([activeBrand]);
      const res = await request(app).get("/api/v1/catalog/brands");
      expect(res.status).toBe(200);
      expect(brandFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
      // HTTP response serialises Date → ISO string; compare key fields only
      expect(res.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: activeBrand.id,
            name: activeBrand.name,
            active: activeBrand.active,
          }),
        ]),
      );
    });

    it("returns an absolute image URL using BASE_URL", async () => {
      brandFindMany.mockResolvedValue([
        { ...activeBrand, image: "/uploads/catalog/brand.png" },
      ]);
      const res = await request(app).get("/api/v1/catalog/brands");
      const baseUrl = (
        process.env.BASE_URL || `http://localhost:${process.env.PORT || 4000}`
      ).replace(/\/$/, "");
      expect(res.body.data[0].image).toBe(
        `${baseUrl}/uploads/catalog/brand.png`,
      );
    });

    it("passes search param to Prisma as insensitive contains", async () => {
      brandFindMany.mockResolvedValue([activeBrand]);
      await request(app).get("/api/v1/catalog/brands?search=apple");
      expect(brandFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { name: { contains: "apple", mode: "insensitive" } },
            ]),
          }),
        }),
      );
    });

    it("rejects search longer than 100 chars with 400", async () => {
      const res = await request(app).get(
        `/api/v1/catalog/brands?search=${"a".repeat(101)}`,
      );
      expect(res.status).toBe(400);
    });

    it("rejects invalid sortOrder with 400", async () => {
      const res = await request(app).get(
        "/api/v1/catalog/brands?sortOrder=random",
      );
      expect(res.status).toBe(400);
    });

    it("accepts valid sortOrder=desc", async () => {
      brandFindMany.mockResolvedValue([activeBrand]);
      const res = await request(app).get(
        "/api/v1/catalog/brands?sortOrder=desc",
      );
      expect(res.status).toBe(200);
      expect(brandFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: "desc" } }),
      );
    });
  });

  // ── 2. PUBLIC — MODELS ───────────────────────────────────────────────
  describe("Public GET /models", () => {
    it("returns only active models (active:true + brand.active:true)", async () => {
      modelFindMany.mockResolvedValue([activeModel]);
      const res = await request(app).get("/api/v1/catalog/models");
      expect(res.status).toBe(200);
      expect(modelFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            active: true,
            brand: { active: true },
          }),
        }),
      );
    });

    it("filters by brandId when provided", async () => {
      modelFindMany.mockResolvedValue([activeModel]);
      await request(app).get(`/api/v1/catalog/models?brandId=${brandId}`);
      expect(modelFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ brandId }),
        }),
      );
    });

    it("rejects invalid (non-UUID) brandId with 400", async () => {
      const res = await request(app).get(
        "/api/v1/catalog/models?brandId=bad-id",
      );
      expect(res.status).toBe(400);
    });

    it("passes search to Prisma", async () => {
      modelFindMany.mockResolvedValue([activeModel]);
      await request(app).get("/api/v1/catalog/models?search=iphone");
      expect(modelFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { name: { contains: "iphone", mode: "insensitive" } },
            ]),
          }),
        }),
      );
    });
  });

  // ── 3. PUBLIC — SERVICES ─────────────────────────────────────────────
  describe("Public GET /services", () => {
    it("returns only active services (active:true)", async () => {
      serviceFindMany.mockResolvedValue([activeService]);
      const res = await request(app).get(
        `/api/v1/catalog/services?modelId=${modelId}`,
      );
      expect(res.status).toBe(200);
      expect(serviceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
    });

    it("filters by modelId compatibility", async () => {
      serviceFindMany.mockResolvedValue([activeService]);
      await request(app).get(`/api/v1/catalog/services?modelId=${modelId}`);
      expect(serviceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            compatibility: {
              some: expect.objectContaining({ modelId }),
            },
          }),
        }),
      );
    });

    it("rejects invalid modelId (non-UUID) with 400", async () => {
      const res = await request(app).get(
        "/api/v1/catalog/services?modelId=bad",
      );
      expect(res.status).toBe(400);
    });

    it("applies minPrice / maxPrice filter", async () => {
      serviceFindMany.mockResolvedValue([activeService]);
      await request(app).get(
        `/api/v1/catalog/services?modelId=${modelId}&minPrice=1000&maxPrice=5000`,
      );
      expect(serviceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            basePrice: { gte: 1000, lte: 5000 },
          }),
        }),
      );
    });

    it("applies search param for service name", async () => {
      serviceFindMany.mockResolvedValue([activeService]);
      await request(app).get(
        `/api/v1/catalog/services?modelId=${modelId}&search=screen`,
      );
      expect(serviceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { name: { contains: "screen", mode: "insensitive" } },
            ]),
          }),
        }),
      );
    });
  });

  // ── 4. ADMIN — BRANDS (paginated, sortBy, search, active filter) ─────
  describe("Admin GET /brands/paginated", () => {
    it("requires ADMIN role — 401 without auth, 403 with USER role", async () => {
      expect(
        (await request(app).get("/api/v1/catalog/brands/paginated")).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .get("/api/v1/catalog/brands/paginated")
            .set("x-test-user", "u")
            .set("x-test-role", "USER")
        ).status,
      ).toBe(403);
    });

    it("returns paginated result with metadata", async () => {
      brandFindMany.mockResolvedValue([activeBrand]);
      brandCount.mockResolvedValue(1);
      const res = await asAdmin(
        request(app).get("/api/v1/catalog/brands/paginated?page=1&pageSize=10"),
      );
      expect(res.status).toBe(200);
      expect(res.body.data.pagination).toEqual({
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
      });
    });

    it("passes search to Prisma", async () => {
      brandFindMany.mockResolvedValue([activeBrand]);
      brandCount.mockResolvedValue(1);
      await asAdmin(
        request(app).get("/api/v1/catalog/brands/paginated?search=apple"),
      );
      expect(brandFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { name: { contains: "apple", mode: "insensitive" } },
            ]),
          }),
        }),
      );
    });

    it("filters by active status", async () => {
      brandFindMany.mockResolvedValue([inactiveBrand]);
      brandCount.mockResolvedValue(1);
      await asAdmin(
        request(app).get("/api/v1/catalog/brands/paginated?active=false"),
      );
      expect(brandFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: false }),
        }),
      );
    });

    it("sorts by name desc", async () => {
      brandFindMany.mockResolvedValue([activeBrand]);
      brandCount.mockResolvedValue(1);
      await asAdmin(
        request(app).get(
          "/api/v1/catalog/brands/paginated?sortBy=name&sortOrder=desc",
        ),
      );
      expect(brandFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ name: "desc" }] }),
      );
    });

    it("rejects unsupported sortBy value with 400", async () => {
      const res = await asAdmin(
        request(app).get(
          "/api/v1/catalog/brands/paginated?sortBy=injected_field",
        ),
      );
      expect(res.status).toBe(400);
    });

    it("rejects pageSize > 100 with 400", async () => {
      const res = await asAdmin(
        request(app).get("/api/v1/catalog/brands/paginated?pageSize=101"),
      );
      expect(res.status).toBe(400);
    });
  });

  // ── 5. ADMIN — MODELS (brandId filter, search, sort) ─────────────────
  describe("Admin GET /models/paginated", () => {
    it("filters by brandId", async () => {
      modelFindMany.mockResolvedValue([activeModel]);
      modelCount.mockResolvedValue(1);
      await asAdmin(
        request(app).get(`/api/v1/catalog/models/paginated?brandId=${brandId}`),
      );
      expect(modelFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ brandId }),
        }),
      );
    });

    it("rejects invalid brandId in admin list with 400", async () => {
      const res = await asAdmin(
        request(app).get("/api/v1/catalog/models/paginated?brandId=not-a-uuid"),
      );
      expect(res.status).toBe(400);
    });

    it("shows inactive models when active=false", async () => {
      modelFindMany.mockResolvedValue([inactiveModel]);
      modelCount.mockResolvedValue(1);
      await asAdmin(
        request(app).get("/api/v1/catalog/models/paginated?active=false"),
      );
      expect(modelFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: false }),
        }),
      );
    });

    it("sorts by createdAt asc (allowlisted)", async () => {
      modelFindMany.mockResolvedValue([activeModel]);
      modelCount.mockResolvedValue(1);
      await asAdmin(
        request(app).get(
          "/api/v1/catalog/models/paginated?sortBy=createdAt&sortOrder=asc",
        ),
      );
      expect(modelFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ createdAt: "asc" }] }),
      );
    });
  });

  // ── 6. ADMIN — SERVICES (categoryId, modelId, price-range) ───────────
  describe("Admin GET /services/paginated", () => {
    it("filters by categoryId", async () => {
      serviceFindMany.mockResolvedValue([activeService]);
      serviceCount.mockResolvedValue(1);
      await asAdmin(
        request(app).get(
          "/api/v1/catalog/services/paginated?categoryId=00000000-0000-4000-8000-000000000010",
        ),
      );
      expect(serviceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            categoryId: "00000000-0000-4000-8000-000000000010",
          }),
        }),
      );
    });

    it("filters by modelId via compatibility", async () => {
      serviceFindMany.mockResolvedValue([activeService]);
      serviceCount.mockResolvedValue(1);
      await asAdmin(
        request(app).get(
          `/api/v1/catalog/services/paginated?modelId=${modelId}`,
        ),
      );
      expect(serviceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            compatibility: { some: { modelId } },
          }),
        }),
      );
    });

    it("applies price-range filter (minPrice, maxPrice)", async () => {
      serviceFindMany.mockResolvedValue([activeService]);
      serviceCount.mockResolvedValue(1);
      await asAdmin(
        request(app).get(
          "/api/v1/catalog/services/paginated?minPrice=1000&maxPrice=5000",
        ),
      );
      expect(serviceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            basePrice: { gte: 1000, lte: 5000 },
          }),
        }),
      );
    });

    it("sorts by basePrice desc (allowlisted)", async () => {
      serviceFindMany.mockResolvedValue([expensiveService, activeService]);
      serviceCount.mockResolvedValue(2);
      await asAdmin(
        request(app).get(
          "/api/v1/catalog/services/paginated?sortBy=basePrice&sortOrder=desc",
        ),
      );
      expect(serviceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ basePrice: "desc" }] }),
      );
    });

    it("rejects unsupported sortBy field with 400", async () => {
      const res = await asAdmin(
        request(app).get("/api/v1/catalog/services/paginated?sortBy=id"),
      );
      expect(res.status).toBe(400);
    });

    it("shows inactive services when active=false", async () => {
      serviceFindMany.mockResolvedValue([inactiveService]);
      serviceCount.mockResolvedValue(1);
      await asAdmin(
        request(app).get("/api/v1/catalog/services/paginated?active=false"),
      );
      expect(serviceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: false }),
        }),
      );
    });
  });

  // ── 7. ADMIN CRUD — brand create / update / deactivate ───────────────
  describe("Admin brand writes", () => {
    it("creates brand and returns 201", async () => {
      const res = await asAdmin(
        request(app).post("/api/v1/catalog/brands"),
      ).send({ name: "Samsung" });
      expect(res.status).toBe(201);
      expect(brandCreate).toHaveBeenCalledWith({ data: { name: "Samsung" } });
    });

    it("rejects blank brand name with 400", async () => {
      const res = await asAdmin(
        request(app).post("/api/v1/catalog/brands"),
      ).send({ name: "  " });
      expect(res.status).toBe(400);
      expect(brandCreate).not.toHaveBeenCalled();
    });

    it("rejects dangerous image with 400", async () => {
      const res = await asAdmin(
        request(app).post("/api/v1/catalog/brands"),
      ).send({ name: "X", image: "javascript:alert(1)" });
      expect(res.status).toBe(400);
    });

    it("updates brand and returns 200", async () => {
      const res = await asAdmin(
        request(app).patch(`/api/v1/catalog/brands/${brandId}`),
      ).send({ name: "Updated" });
      expect(res.status).toBe(200);
      expect(brandUpdate).toHaveBeenCalledWith({
        where: { id: brandId },
        data: { name: "Updated" },
      });
    });

    it("deactivates brand (soft-delete) and returns 200", async () => {
      const res = await asAdmin(
        request(app).delete(`/api/v1/catalog/brands/${brandId}`),
      );
      expect(res.status).toBe(200);
      expect(brandUpdate).toHaveBeenCalledWith({
        where: { id: brandId },
        data: { active: false },
      });
    });
  });

  // ── 8. Public — inactive records never appear ─────────────────────────
  describe("Public APIs never return inactive records", () => {
    it("only returns active brands on public GET /brands", async () => {
      brandFindMany.mockResolvedValue([activeBrand]); // simulate DB active filter
      const res = await request(app).get("/api/v1/catalog/brands");
      expect(res.status).toBe(200);
      expect(brandFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
    });

    it("only returns active models on public GET /models", async () => {
      modelFindMany.mockResolvedValue([activeModel]);
      const res = await request(app).get("/api/v1/catalog/models");
      expect(res.status).toBe(200);
      expect(modelFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            active: true,
            brand: { active: true },
          }),
        }),
      );
    });

    it("only returns active services on public GET /services", async () => {
      serviceFindMany.mockResolvedValue([activeService]);
      const res = await request(app).get(
        `/api/v1/catalog/services?modelId=${modelId}`,
      );
      expect(res.status).toBe(200);
      expect(serviceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
    });
  });
});
