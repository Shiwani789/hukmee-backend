import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/permission";
import { validate } from "../../utils/validate";
import { inventoryController } from "./inventory.controller";
import { hubIdSchema, hubMovementsSchema } from "../../validation/inventory";

const router = Router();
router.use(authenticate, requirePermission("inventory:manage"));
router.get("/hubs", inventoryController.listHubs);
router.get(
  "/hubs/:hubId/stock",
  validate(hubIdSchema),
  inventoryController.getHubStock,
);
router.get(
  "/hubs/:hubId/movements",
  validate(hubMovementsSchema),
  inventoryController.listHubMovements,
);

export default router;
