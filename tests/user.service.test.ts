import type { PrismaClient } from "@prisma/client";
import { UserService } from "../src/modules/user/user.service";

describe("user profile ownership", () => {
  function makeService() {
    const user = {
      id: "user-1",
      email: "asha@example.test",
      phone: null as string | null,
      displayName: "Asha",
      profileImage: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const db = {
      user: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === user.id ? user : null,
        update: async ({ data }: { data: Partial<typeof user> }) => {
          Object.assign(user, data);
          return user;
        },
        findUniqueOrThrow: async () => user,
      },
      $transaction: async (callback: (tx: unknown) => unknown) => callback(db),
    } as unknown as PrismaClient;
    return new UserService(db);
  }

  it("returns and updates only the authenticated user's display name", async () => {
    const service = makeService();
    expect(await service.getProfile("user-1")).toMatchObject({
      user: { id: "user-1" },
      displayName: "Asha",
    });
    expect(
      await service.updateProfile("user-1", { displayName: "Asha Patel" }),
    ).toMatchObject({ displayName: "Asha Patel" });
  });

  it("returns not found when the user does not exist", async () => {
    await expect(makeService().getProfile("other-user")).rejects.toMatchObject({
      status: 404,
      code: "USER_NOT_FOUND",
    });
  });
});
