import { Router } from "express";
import catalogRoutes from "../modules/catalog/catalog.routes";
import { adminVendorKycRoutes } from "../modules/vendor-kyc/vendor-kyc.routes";

/** Administrative APIs; each feature router owns its permission boundary. */
const adminRoutes = Router();
adminRoutes.use("/catalog", catalogRoutes);
adminRoutes.use("/vendor-kyc", adminVendorKycRoutes);

export default adminRoutes;
