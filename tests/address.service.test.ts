import type { PrismaClient } from "@prisma/client";
import { AddressService } from "../src/modules/address/address.service";
import { createAddressSchema } from "../src/validation/address";

describe("user address ownership", () => {
  const address = {
    id: "address-1",
    userId: "user-1",
    line1: "123 Main Street",
    line2: null,
    city: "Pune",
    region: "MH",
    postalCode: "411001",
    countryCode: "IN",
  };

  function makeService(ownerUserId = "user-1") {
    const db = {
      address: {
        findMany: async ({ where }: { where: { userId: string } }) =>
          where.userId === ownerUserId ? [address] : [],
        findFirst: async ({
          where,
        }: {
          where: { id: string; userId: string };
        }) =>
          where.id === address.id && where.userId === address.userId
            ? address
            : null,
        create: async ({ data }: { data: Record<string, unknown> }) => data,
        updateMany: async ({
          where,
        }: {
          where: { id: string; userId: string };
        }) =>
          where.id === address.id && where.userId === address.userId
            ? { count: 1 }
            : { count: 0 },
        findUniqueOrThrow: async () => address,
        deleteMany: async ({
          where,
        }: {
          where: { id: string; userId: string };
        }) =>
          where.id === address.id && where.userId === address.userId
            ? { count: 1 }
            : { count: 0 },
      },
    } as unknown as PrismaClient;
    return new AddressService(db);
  }

  it("creates and lists only the authenticated user's addresses", async () => {
    const service = makeService();
    const input = createAddressSchema.parse({
      body: {
        label: "Home",
        line1: "123 Main Street",
        city: "Pune",
        postalCode: "411001",
        countryCode: "IN",
      },
      params: {},
      query: {},
    }).body;
    const created = await service.create("user-1", input);
    expect(created).toMatchObject({ userId: "user-1" });
    expect(await service.list("user-1")).toEqual([address]);
  });

  it("does not expose or mutate another user's address", async () => {
    const service = makeService();
    await expect(service.get("other-user", "address-1")).rejects.toMatchObject({
      status: 404,
      code: "ADDRESS_NOT_FOUND",
    });
    await expect(
      service.update("user-1", "another-address", { city: "Mumbai" }),
    ).rejects.toMatchObject({ status: 404, code: "ADDRESS_NOT_FOUND" });
  });

  it("replaces a customer's default address in a serializable transaction", async () => {
    const previousDefault: {
      id: string;
      userId: string;
      isDefault: boolean;
    } = { id: "old", userId: "user-1", isDefault: true };
    const updateMany = jest.fn().mockImplementation(async () => {
      previousDefault.isDefault = false;
      return { count: 1 };
    });
    const create = jest.fn(
      async ({ data }: { data: Record<string, unknown> }) => data,
    );
    const tx = { address: { updateMany, create } };
    const transaction = jest.fn(
      async (callback: (client: unknown) => Promise<unknown>) => callback(tx),
    );
    const db = {
      address: tx.address,
      $transaction: transaction,
    } as unknown as PrismaClient;
    const service = new AddressService(db);
    const input = createAddressSchema.parse({
      body: {
        name: "Rahul",
        phone: "9876543210",
        type: "HOME",
        addressLine1: "12 Main Road",
        city: "Delhi",
        state: "Delhi",
        country: "India",
        pincode: "110001",
        isDefault: true,
      },
      params: {},
      query: {},
    }).body;

    const result = await service.create("user-1", input);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", isDefault: true },
      data: { isDefault: false },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1", isDefault: true }),
    });
    expect(result).toMatchObject({ userId: "user-1", isDefault: true });
    expect(previousDefault.isDefault).toBe(false);
  });
});
