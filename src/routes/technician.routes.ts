import { Router } from "express";
import technicianRoutes from "../modules/technician/technician.routes";

const routes = Router();
routes.use("/", technicianRoutes);

export default routes;
