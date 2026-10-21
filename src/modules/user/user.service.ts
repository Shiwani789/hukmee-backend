import { prisma } from "../../config/database";
import { AppError } from "../../utils/errors";

type UpdateUserProfileInput = {
  firstName?: string | undefined;
  lastName?: string | undefined;
  displayName?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  profileImage?: string | undefined;
};

export class UserService {
  constructor(private readonly db: typeof prisma = prisma) {}

  async getProfile(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        profileImage: true,
        createdAt: true,
        updatedAt: true,
        email: true,
        phone: true,
      },
    });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      profileImage: user.profileImage,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      user: { id: user.id, email: user.email, phone: user.phone },
    };
  }

  async updateProfile(userId: string, input: UpdateUserProfileInput) {
    try {
      await this.db.$transaction(async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: { firstName: true, lastName: true, email: true, phone: true },
        });
        if (!current)
          throw new AppError(404, "USER_NOT_FOUND", "User not found");
        if (input.phone !== undefined && input.phone.trim() !== current.phone)
          throw new AppError(
            400,
            "IDENTITY_FIELD_READ_ONLY",
            "Phone must match the number used to log in.",
          );
        const firstName = input.firstName ?? current.firstName;
        const lastName = input.lastName ?? current.lastName;
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(input.firstName !== undefined
              ? { firstName: input.firstName }
              : {}),
            ...(input.lastName !== undefined
              ? { lastName: input.lastName }
              : {}),
            ...(input.firstName !== undefined || input.lastName !== undefined
              ? { displayName: [firstName, lastName].filter(Boolean).join(" ") }
              : {}),
            ...(input.displayName !== undefined
              ? { displayName: input.displayName }
              : {}),
            ...(input.profileImage !== undefined
              ? { profileImage: input.profileImage }
              : {}),
            ...(input.email !== undefined
              ? { email: input.email.trim().toLowerCase() }
              : {}),
          },
        });
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      )
        throw new AppError(
          409,
          "EMAIL_ALREADY_IN_USE",
          "Email is already in use",
        );
      throw error;
    }

    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        profileImage: true,
        createdAt: true,
        updatedAt: true,
        email: true,
        phone: true,
      },
    });
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      profileImage: user.profileImage,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      user: { id: user.id, email: user.email, phone: user.phone },
    };
  }
}
