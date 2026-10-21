import { authenticatedContext } from "../../utils/auth-context";
import { asyncHandler } from "../../utils/async-handler";
import { validatedBody } from "../../utils/validated-request";
import { updateUserProfileSchema } from "../../validation/user";
import { UserService } from "./user.service";

const service = new UserService();

export class UserController {
  getProfile = asyncHandler(async (req, res) => {
    res.json({
      data: await service.getProfile(authenticatedContext(req).userId),
    });
  });
  updateProfile = asyncHandler(async (req, res) => {
    const input = validatedBody(updateUserProfileSchema, res);
    // Profile image URL is injected by the upload middleware before validation
    if (req.file) {
      input.profileImage = `${req.protocol}://${req.get("host")}/uploads/profiles/${req.file.filename}`;
    }
    res.json({
      data: await service.updateProfile(
        authenticatedContext(req).userId,
        input,
      ),
    });
  });
}

export const userController = new UserController();
