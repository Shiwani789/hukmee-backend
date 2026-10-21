import { authenticatedContext } from "../../utils/auth-context";
import { asyncHandler } from "../../utils/async-handler";
import { DeviceService } from "./device.service";
import { createDeviceSchema, deviceIdSchema } from "../../validation/device";
import { validatedBody, validatedParams } from "../../utils/validated-request";

const service = new DeviceService();

export class DeviceController {
  list = asyncHandler(async (req, res) => {
    const { userId, roles } = authenticatedContext(req);
    res.json({ data: await service.list(userId, roles) });
  });
  create = asyncHandler(async (req, res) => {
    const { userId, roles } = authenticatedContext(req);
    res.status(201).json({
      data: await service.create(
        userId,
        roles,
        validatedBody(createDeviceSchema, res),
      ),
    });
  });
  get = asyncHandler(async (req, res) => {
    const { deviceId } = validatedParams(deviceIdSchema, res);
    res.json({
      data: await service.get(authenticatedContext(req).userId, deviceId),
    });
  });
}

export const deviceController = new DeviceController();
