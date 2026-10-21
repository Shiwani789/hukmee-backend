import { prisma } from "../../config/database";
import { AppError } from "../../utils/errors";
import type { CreateDeviceInput } from "../../validation/device";

export class DeviceService {
  private requireUser(roles: string[]) {
    if (!roles.includes("USER")) {
      throw new AppError(403, "FORBIDDEN", "User role is required");
    }
  }

  async list(userId: string, roles: string[]) {
    this.requireUser(roles);
    return prisma.userDevice.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { model: { include: { brand: true } } },
    });
  }

  async create(userId: string, roles: string[], input: CreateDeviceInput) {
    this.requireUser(roles);
    const model = await prisma.deviceModel.findFirst({
      where: { id: input.modelId, active: true, brand: { active: true } },
      select: { id: true },
    });
    if (!model)
      throw new AppError(
        404,
        "DEVICE_MODEL_NOT_FOUND",
        "Active device model not found",
      );
    return prisma.userDevice.create({
      data: {
        userId,
        modelId: model.id,
        ...(input.nickname ? { nickname: input.nickname } : {}),
        ...(input.serialNumber ? { serialNumber: input.serialNumber } : {}),
      },
      include: { model: { include: { brand: true } } },
    });
  }

  async get(userId: string, deviceId: string) {
    const device = await prisma.userDevice.findFirst({
      where: { id: deviceId, user: { id: userId } },
      include: { model: { include: { brand: true } } },
    });
    if (!device)
      throw new AppError(404, "DEVICE_NOT_FOUND", "Device not found");
    return device;
  }
}
