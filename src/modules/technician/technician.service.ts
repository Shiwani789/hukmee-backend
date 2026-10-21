import { prisma } from "../../config/database";
import { AppError } from "../../utils/errors";

export class TechnicianService {
  constructor(private readonly db: typeof prisma = prisma) {}

  async getOwnProfile(userId: string) {
    const profile = await this.db.technicianProfile.findUnique({
      where: { userId },
      select: {
        active: true,
        approvedAt: true,
        skills: {
          orderBy: { service: { name: "asc" } },
          select: {
            serviceId: true,
            service: { select: { name: true, active: true } },
          },
        },
      },
    });
    if (!profile) {
      throw new AppError(
        404,
        "TECHNICIAN_PROFILE_NOT_FOUND",
        "Technician profile not found",
      );
    }
    return profile;
  }

  async getOwnOnboardingStatus(userId: string) {
    const profile = await this.db.technicianProfile.findUnique({
      where: { userId },
      select: { active: true, approvedAt: true },
    });
    if (!profile) {
      throw new AppError(
        404,
        "TECHNICIAN_PROFILE_NOT_FOUND",
        "Technician profile not found",
      );
    }
    // The current schema has no submission/rejection state. Return persisted
    // approval metadata as-is instead of inferring an onboarding state.
    return profile;
  }
}
