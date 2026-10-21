import { Router } from "express";
import { validate } from "../../utils/validate";
import { authenticate } from "../../middlewares/auth";
import { requireRole } from "../../middlewares/role";
import { createDeviceSchema, deviceIdSchema } from "../../validation/device";
import { deviceController } from "./device.controller";

const router = Router();
router.use(authenticate, requireRole("USER"));
router.get("/", deviceController.list);
router.post("/", validate(createDeviceSchema), deviceController.create);
router.get("/:deviceId", validate(deviceIdSchema), deviceController.get);

export default router;
