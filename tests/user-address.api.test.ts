import express from "express";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { errorHandler } from "../src/middlewares/errors";

const addressId = "00000000-0000-4000-8000-000000000201";

describe("user profile and address APIs", () => {
  const profile = {
    id: "user-1",
    email: "asha@example.test",
    phone: null as string | null,
    displayName: "Asha",
    profileImage: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const addresses = new Map<string, Record<string, unknown>>();
  let app: express.Express;

  beforeAll(async () => {
    const db = {
      user: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === "user-1" ? profile : null,
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          if (where.id !== "user-1") throw new Error("Unexpected missing user");
          Object.assign(profile, data);
          return profile;
        },
        findUniqueOrThrow: async () => profile,
      },
      $transaction: async (callback: (tx: unknown) => unknown) => callback(db),
      address: {
        findMany: async ({ where }: { where: { userId: string } }) =>
          [...addresses.values()].filter(
            (address) => address.userId === where.userId,
          ),
        findFirst: async ({
          where,
        }: {
          where: { id: string; userId: string };
        }) => {
          const address = addresses.get(where.id);
          return address?.userId === where.userId ? address : null;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const address = { ...data, id: addressId, createdAt: new Date() };
          addresses.set(addressId, address);
          return address;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: {
            id?: string;
            userId: string;
            isDefault?: boolean;
          };
          data: Record<string, unknown>;
        }) => {
          if (where.isDefault !== undefined) {
            let count = 0;
            for (const [id, address] of addresses) {
              if (
                address.userId === where.userId &&
                address.isDefault === where.isDefault
              ) {
                addresses.set(id, { ...address, ...data });
                count += 1;
              }
            }
            return { count };
          }
          const address = where.id ? addresses.get(where.id) : undefined;
          if (!address || address.userId !== where.userId) return { count: 0 };
          addresses.set(where.id!, { ...address, ...data });
          return { count: 1 };
        },
        findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
          const address = addresses.get(where.id);
          if (!address) throw new Error("Unexpected missing address");
          return address;
        },
        deleteMany: async ({
          where,
        }: {
          where: { id: string; userId: string };
        }) => {
          const address = addresses.get(where.id);
          if (!address || address.userId !== where.userId) return { count: 0 };
          addresses.delete(where.id);
          return { count: 1 };
        },
      },
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
          const userId = req.header("x-test-user");
          if (!userId)
            return next(
              new AppError(401, "UNAUTHORIZED", "Authentication required"),
            );
          req.auth = {
            userId,
            sessionId: "session-test",
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
    const [{ default: userRoutes }, { default: addressRoutes }] =
      await Promise.all([
        import("../src/modules/user/user.routes"),
        import("../src/modules/address/address.routes"),
      ]);
    app = express();
    app.use(express.json());
    app.use("/api/v1/users", userRoutes);
    app.use("/api/v1/addresses", addressRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => addresses.clear());

  it("protects profile read/update and validates update payloads", async () => {
    expect((await request(app).get("/api/v1/users/me")).status).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/v1/users/me")
          .set("x-test-user", "tech-1")
          .set("x-test-role", "TECHNICIAN")
      ).status,
    ).toBe(403);

    const profileResponse = await request(app)
      .get("/api/v1/users/me")
      .set("x-test-user", "user-1");
    expect(profileResponse.status).toBe(200);
    expect(profileResponse.body.data.displayName).toBe("Asha");

    const invalid = await request(app)
      .patch("/api/v1/users/me")
      .set("x-test-user", "user-1")
      .send({ displayName: "  " });
    expect(invalid.status).toBe(400);

    const updated = await request(app)
      .patch("/api/v1/users/me")
      .set("x-test-user", "user-1")
      .send({ displayName: "Asha Patel" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.displayName).toBe("Asha Patel");
  });

  it("creates, lists, updates and deletes only the signed-in user's addresses", async () => {
    expect((await request(app).get("/api/v1/addresses")).status).toBe(401);
    expect((await request(app).post("/api/v1/addresses").send({})).status).toBe(
      401,
    );

    const created = await request(app)
      .post("/api/v1/addresses")
      .set("x-test-user", "user-1")
      .send({
        label: "Home",
        line1: "123 Main Street",
        city: "Pune",
        postalCode: "411001",
        countryCode: "in",
      });
    expect(created.status).toBe(201);
    expect(created.body.data.countryCode).toBe("IN");
    expect(
      (await request(app).get("/api/v1/addresses").set("x-test-user", "user-2"))
        .body.data,
    ).toEqual([]);
    expect(
      (
        await request(app)
          .get(`/api/v1/addresses/${addressId}`)
          .set("x-test-user", "user-2")
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/v1/addresses/${addressId}`)
          .set("x-test-user", "user-2")
          .send({ city: "Chennai" })
      ).status,
    ).toBe(404);

    const invalidPatch = await request(app)
      .patch(`/api/v1/addresses/${addressId}`)
      .set("x-test-user", "user-1")
      .send({});
    expect(invalidPatch.status).toBe(400);

    const updated = await request(app)
      .patch(`/api/v1/addresses/${addressId}`)
      .set("x-test-user", "user-1")
      .send({ city: "Mumbai" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.city).toBe("Mumbai");

    const deleted = await request(app)
      .delete(`/api/v1/addresses/${addressId}`)
      .set("x-test-user", "user-1");
    expect(deleted.status).toBe(200);
  });

  it("creates an address from the customer flow payload and ignores a supplied userId", async () => {
    const created = await request(app)
      .post("/api/v1/addresses")
      .set("x-test-user", "user-1")
      .send({
        userId: "user-2",
        name: "Rahul",
        phone: "9876543210",
        type: "HOME",
        addressLine1: "12 Main Road",
        addressLine2: "Near Park",
        city: "Delhi",
        state: "Delhi",
        country: "India",
        pincode: "110001",
        latitude: 28.6139,
        longitude: 77.209,
        isDefault: true,
      });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      userId: "user-1",
      recipientName: "Rahul",
      phone: "9876543210",
      type: "HOME",
      line1: "12 Main Road",
      line2: "Near Park",
      city: "Delhi",
      region: "Delhi",
      country: "India",
      postalCode: "110001",
      latitude: 28.6139,
      longitude: 77.209,
      isDefault: true,
    });
  });

  it("validates required address fields, address type, phone, and coordinates", async () => {
    const baseAddress = {
      name: "Rahul",
      phone: "9876543210",
      type: "HOME",
      addressLine1: "12 Main Road",
      city: "Delhi",
      state: "Delhi",
      country: "India",
      pincode: "110001",
    };
    const create = (body: Record<string, unknown>) =>
      request(app)
        .post("/api/v1/addresses")
        .set("x-test-user", "user-1")
        .send(body);

    expect((await create({ name: "Rahul" })).status).toBe(400);
    expect((await create({ ...baseAddress, addressLine1: "" })).status).toBe(
      400,
    );
    expect((await create({ ...baseAddress, type: "VACATION" })).status).toBe(
      400,
    );
    expect(
      (await create({ ...baseAddress, phone: "not-a-phone" })).status,
    ).toBe(400);
    expect(
      (await create({ ...baseAddress, latitude: 91, longitude: 10 })).status,
    ).toBe(400);
    expect((await create({ ...baseAddress, latitude: 28 })).status).toBe(400);
  });

  it("transactionally replaces a customer's previous default address", async () => {
    addresses.set("old-default", {
      id: "old-default",
      userId: "user-1",
      isDefault: true,
    });
    const created = await request(app)
      .post("/api/v1/addresses")
      .set("x-test-user", "user-1")
      .send({
        name: "Rahul",
        phone: "9876543210",
        type: "HOME",
        addressLine1: "12 Main Road",
        city: "Delhi",
        state: "Delhi",
        country: "India",
        pincode: "110001",
        isDefault: true,
      });

    expect(created.status).toBe(201);
    expect(addresses.get("old-default")?.isDefault).toBe(false);
    expect(created.body.data.isDefault).toBe(true);
  });
});
