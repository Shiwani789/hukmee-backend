import { Router } from "express";
import { sendRateLimitResponse } from "../utils/rate-limit-response";
import rateLimit from "express-rate-limit";
import { authRateLimitConfig } from "../modules/auth/auth.routes";
import authRoutes from "../modules/auth/auth.routes";
import catalogRoutes from "../modules/catalog/catalog.routes";
import bookingRoutes from "../modules/bookings/booking.routes";
import inventoryRoutes from "../modules/inventory/inventory.routes";
import userRoutes from "./user.routes";
import adminRoutes from "./admin.routes";
import vendorRoutes from "./vendor.routes";
import technicianRoutes from "./technician.routes";

const routes = Router();

routes.use(
  "/auth",
  rateLimit({
    ...authRateLimitConfig,
    handler: (_req, res) => sendRateLimitResponse(res),
  }),
  authRoutes,
);
routes.use("/catalog", catalogRoutes);
routes.use(userRoutes);
routes.use("/bookings", bookingRoutes);
routes.use("/inventory", inventoryRoutes);
routes.use("/technicians", technicianRoutes);
routes.use("/vendor", vendorRoutes);
routes.use("/admin", adminRoutes);

export default routes;
