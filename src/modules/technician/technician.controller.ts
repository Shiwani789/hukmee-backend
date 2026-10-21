import { authenticatedContext } from "../../utils/auth-context";
import { asyncHandler } from "../../utils/async-handler";
import { TechnicianService } from "./technician.service";

const service = new TechnicianService();

export class TechnicianController {
  getOwnProfile = asyncHandler(async (req, res) => {
    res.json({
      data: await service.getOwnProfile(authenticatedContext(req).userId),
    });
  });
  getOwnOnboardingStatus = asyncHandler(async (req, res) => {
    res.json({
      data: await service.getOwnOnboardingStatus(
        authenticatedContext(req).userId,
      ),
    });
  });
}

export const technicianController = new TechnicianController();
