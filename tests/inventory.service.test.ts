import type { PrismaClient } from "@prisma/client";
import { InventoryService } from "../src/modules/inventory/inventory.service";

const hubId = "00000000-0000-4000-8000-000000000001";
const movementId = "00000000-0000-4000-8000-000000000002";

describe("inventory read service", () => {
  it("lists hubs using active-only filtering and stable ordering", async () => {
    const expected = [{ id: hubId, code: "PUN-1", name: "Pune" }];
    const findMany = jest.fn().mockResolvedValue(expected);
    const service = new InventoryService({
      hub: { findMany },
    } as unknown as PrismaClient);

    await expect(service.listHubs()).resolves.toEqual(expected);
    expect(findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    });
  });

  it("filters stock to active parts after verifying the hub is active", async () => {
    const stock = [{ partId: "part-1", quantity: 4 }];
    const findMany = jest.fn().mockResolvedValue(stock);
    const service = new InventoryService({
      hub: { findFirst: jest.fn().mockResolvedValue({ id: hubId }) },
      hubInventory: { findMany },
    } as unknown as PrismaClient);

    await expect(service.getHubStock(hubId)).resolves.toEqual(stock);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hubId, part: { is: { active: true } } },
      }),
    );
  });

  it("rejects inactive hubs and cursors belonging to another hub", async () => {
    const stockQuery = jest.fn();
    const service = new InventoryService({
      hub: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: hubId }),
      },
      hubInventory: { findMany: stockQuery },
      inventoryMovement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient);

    await expect(service.getHubStock(hubId)).rejects.toMatchObject({
      status: 404,
      code: "HUB_NOT_FOUND",
    });
    expect(stockQuery).not.toHaveBeenCalled();
    await expect(
      service.listHubMovements(hubId, { limit: 20, cursor: movementId }),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_CURSOR" });
  });

  it("uses bounded newest-first cursor pagination", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new InventoryService({
      hub: { findFirst: jest.fn().mockResolvedValue({ id: hubId }) },
      inventoryMovement: {
        findFirst: jest.fn().mockResolvedValue({ id: movementId }),
        findMany,
      },
    } as unknown as PrismaClient);

    await service.listHubMovements(hubId, { limit: 20, cursor: movementId });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hubId },
        take: 20,
        cursor: { id: movementId },
        skip: 1,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });
});
