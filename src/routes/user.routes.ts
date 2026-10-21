import { Router } from "express";
import addressRoutes from "../modules/address/address.routes";
import deviceRoutes from "../modules/devices/device.routes";
import userRoutes from "../modules/user/user.routes";

/** User-facing route group. Feature routers retain their own auth and ownership rules. */
const userRoutesGroup = Router();
userRoutesGroup.use("/users", userRoutes);
userRoutesGroup.use("/devices", deviceRoutes);
userRoutesGroup.use("/addresses", addressRoutes);

export default userRoutesGroup;
