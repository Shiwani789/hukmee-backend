import { prisma } from "../../config/database";
import { AppError } from "../../utils/errors";
import type { CreateAddressInput, UpdateAddressInput } from "../../validation/address";
import { Prisma } from "@prisma/client";

export class AddressService {
  constructor(private readonly db: typeof prisma = prisma) {}

  async list(userId: string) {
    return this.db.address.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  async get(userId: string, addressId: string) {
    const address = await this.db.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!address)
      throw new AppError(404, "ADDRESS_NOT_FOUND", "Address not found");
    return address;
  }

  async create(userId: string, input: CreateAddressInput) {
    const createAddress = async (tx: Prisma.TransactionClient) => {
      if (input.isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const data: Prisma.AddressUncheckedCreateInput = {
        userId,
        recipientName: input.recipientName ?? null,
        phone: input.phone ?? null,
        type: input.type,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city,
        region: input.region ?? null,
        postalCode: input.postalCode,
        country: input.country,
        countryCode: input.countryCode ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        isDefault: input.isDefault,
        ...(input.label !== undefined ? { label: input.label } : {}),
      };
      return tx.address.create({ data });
    };

    if (input.isDefault) {
      return this.db.$transaction(createAddress, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    }
    return createAddress(this.db);
  }

  async update(userId: string, addressId: string, input: UpdateAddressInput) {
    const data: Prisma.AddressUpdateManyMutationInput = {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.line1 !== undefined ? { line1: input.line1 } : {}),
      ...(input.line2 !== undefined ? { line2: input.line2 } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.postalCode !== undefined
        ? { postalCode: input.postalCode }
        : {}),
      ...(input.countryCode !== undefined
        ? { countryCode: input.countryCode, country: input.countryCode }
        : {}),
    };
    const changed = await this.db.address.updateMany({
      where: { id: addressId, userId },
      data,
    });
    if (changed.count !== 1)
      throw new AppError(404, "ADDRESS_NOT_FOUND", "Address not found");
    return this.db.address.findUniqueOrThrow({ where: { id: addressId } });
  }

  async delete(userId: string, addressId: string) {
    const deleted = await this.db.address.deleteMany({
      where: { id: addressId, userId },
    });
    if (deleted.count !== 1)
      throw new AppError(404, "ADDRESS_NOT_FOUND", "Address not found");
    return { deleted: true };
  }
}
