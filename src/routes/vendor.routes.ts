import { Router } from "express";
import { vendorKycRoutes } from "../modules/vendor-kyc/vendor-kyc.routes";

const vendorRoutes = Router();
vendorRoutes.use("/kyc", vendorKycRoutes);

export default vendorRoutes;
