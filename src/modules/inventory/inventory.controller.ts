import { asyncHandler } from "../../utils/async-handler";
import { InventoryService } from "./inventory.service";
import { validatedParams, validatedQuery } from "../../utils/validated-request";
import { hubIdSchema, hubMovementsSchema } from "../../validation/inventory";

const service = new InventoryService();

export class InventoryController {
  listHubs = asyncHandler(async (_req, res) => {
    res.json({ data: await service.listHubs() });
  });
  getHubStock = asyncHandler(async (_req, res) => {
    const { hubId } = validatedParams(hubIdSchema, res);
    res.json({ data: await service.getHubStock(hubId) });
  });
  listHubMovements = asyncHandler(async (_req, res) => {
    const { hubId } = validatedParams(hubMovementsSchema, res);
    const query = validatedQuery(hubMovementsSchema, res);
    res.json({ data: await service.listHubMovements(hubId, query) });
  });
}

export const inventoryController = new InventoryController();
