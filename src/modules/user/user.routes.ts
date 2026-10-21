import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth";
import { requireRole } from "../../middlewares/role";
import { profileImageUpload } from "../../middlewares/upload";
import { authController } from "../auth/auth.controller";
import { deleteAccountSchema } from "../../validation/auth";
import { validate } from "../../utils/validate";
import { userController } from "./user.controller";
import { updateUserProfileSchema } from "../../validation/user";

const router = Router();
router.use(authenticate);
const includeUploadedProfileImage: RequestHandler = (req, _res, next) => {
  if (req.file) {
    req.body.profileImage = `${req.protocol}://${req.get("host")}/uploads/profiles/${req.file.filename}`;
  }
  next();
};

router.get("/me", requireRole("USER"), userController.getProfile);
router.patch(
  "/me",
  requireRole("USER"),
  validate(updateUserProfileSchema),
  userController.updateProfile,
);
router.get("/profile", requireRole("USER"), userController.getProfile);
router.put(
  "/profile",
  requireRole("USER"),
  profileImageUpload(),
  includeUploadedProfileImage,
  validate(updateUserProfileSchema),
  userController.updateProfile,
);
router.post("/logout", authController.logout);
router.delete(
  "/account",
  validate(deleteAccountSchema),
  authController.deleteAccount,
);

export default router;
