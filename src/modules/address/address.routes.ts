import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requireRole } from "../../middlewares/role";
import { validate } from "../../utils/validate";
import {
  addressIdSchema,
  createAddressSchema,
  updateAddressSchema,
} from "../../validation/address";
import { addressController } from "./address.controller";

const router = Router();
router.use(authenticate, requireRole("USER"));
router.get("/", addressController.list);
router.post("/", validate(createAddressSchema), addressController.create);
router.get("/:addressId", validate(addressIdSchema), addressController.get);
router.patch(
  "/:addressId",
  validate(updateAddressSchema),
  addressController.update,
);
router.delete(
  "/:addressId",
  validate(addressIdSchema),
  addressController.delete,
);

export default router;
