import { authenticatedContext } from "../../utils/auth-context";
import { asyncHandler } from "../../utils/async-handler";
import { validatedBody, validatedParams } from "../../utils/validated-request";
import { AddressService } from "./address.service";
import {
  addressIdSchema,
  createAddressSchema,
  updateAddressSchema,
} from "../../validation/address";

const service = new AddressService();

export class AddressController {
  list = asyncHandler(async (req, res) => {
    res.json({ data: await service.list(authenticatedContext(req).userId) });
  });
  get = asyncHandler(async (req, res) => {
    const { addressId } = validatedParams(addressIdSchema, res);
    res.json({
      data: await service.get(authenticatedContext(req).userId, addressId),
    });
  });
  create = asyncHandler(async (req, res) => {
    const input = validatedBody(createAddressSchema, res);
    res.status(201).json({
      data: await service.create(authenticatedContext(req).userId, input),
    });
  });
  update = asyncHandler(async (req, res) => {
    const { addressId } = validatedParams(updateAddressSchema, res);
    const input = validatedBody(updateAddressSchema, res);
    res.json({
      data: await service.update(
        authenticatedContext(req).userId,
        addressId,
        input,
      ),
    });
  });
  delete = asyncHandler(async (req, res) => {
    const { addressId } = validatedParams(addressIdSchema, res);
    res.json({
      data: await service.delete(authenticatedContext(req).userId, addressId),
    });
  });
}

export const addressController = new AddressController();
