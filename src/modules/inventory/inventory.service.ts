import { prisma } from "../../config/database";
import { AppError } from "../../utils/errors";
import type { HubMovementsQuery } from "../../validation/inventory";

export class InventoryService {
  constructor(private readonly db: typeof prisma = prisma) {}

  listHubs() {
    return this.db.hub.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    });
  }

  async getHubStock(hubId: string) {
    await this.requireActiveHub(hubId);
    return this.db.hubInventory.findMany({
      where: { hubId, part: { is: { active: true } } },
      orderBy: { part: { name: "asc" } },
      select: {
        partId: true,
        quantity: true,
        part: { select: { sku: true, name: true } },
      },
    });
  }

  async listHubMovements(hubId: string, query: HubMovementsQuery) {
    await this.requireActiveHub(hubId);
    if (query.cursor) {
      const cursor = await this.db.inventoryMovement.findFirst({
        where: { id: query.cursor, hubId },
        select: { id: true },
      });
      if (!cursor)
        throw new AppError(400, "INVALID_CURSOR", "Movement cursor is invalid");
    }
    return this.db.inventoryMovement.findMany({
      where: { hubId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        partId: true,
        quantityDelta: true,
        type: true,
        reference: true,
        createdAt: true,
        part: { select: { id: true, sku: true, name: true } },
      },
    });
  }

  private async requireActiveHub(hubId: string) {
    const hub = await this.db.hub.findFirst({
      where: { id: hubId, active: true },
      select: { id: true },
    });
    if (!hub) throw new AppError(404, "HUB_NOT_FOUND", "Hub not found");
  }
}
