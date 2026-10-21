/* eslint-disable @typescript-eslint/no-explicit-any */
import argon2 from "argon2";
import { randomUUID } from "node:crypto";

const mockRole = { id: "role-user", name: "USER", permissions: [] };
const mockPrisma: Record<string, any> = {};

beforeAll(async () => {
  const user = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn(async ({ data }: any) => ({
      id: randomUUID(),
      email: data.email ?? null,
      phone: data.phone ?? null,
      isActive: data.isActive,
      isDeleted: false,
      status: data.status,
      createdAt: new Date(),
      role: mockRole,
    })),
  };
  const role = {
    upsert: jest.fn().mockResolvedValue(mockRole),
  };
  const session = { create: jest.fn().mockResolvedValue({}) };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };
  Object.assign(mockPrisma, {
    user,
    role,
    session,
    auditLog,
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(mockPrisma),
    ),
  });
  jest.doMock("../src/config/database", () => ({ prisma: mockPrisma }));
});

describe("OTP registration persistence", () => {
  it("keeps registration out of the database until verification completes", async () => {
    const { AuthService } = await import("../src/modules/auth/auth.service");
    const service = new AuthService();
    const email = `pending-${randomUUID()}@example.test`;
    const password = "Correct-Horse-Battery-9!";

    await service.beginRegistration({
      email,
      password,
      displayName: "Pending User",
    });

    expect(mockPrisma.user.create).not.toHaveBeenCalled();

    const result = await service.completeRegistration(email);
    const createArgs = mockPrisma.user.create.mock.calls.at(-1)?.[0];
    expect(result.user.email).toBe(email);
    expect(createArgs.data).toMatchObject({
      email,
      isActive: true,
      status: "ACTIVE",
      displayName: "Pending User",
    });
    expect(createArgs.data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(createArgs.data.password).not.toBe(password);
    await expect(
      argon2.verify(createArgs.data.password, password),
    ).resolves.toBe(true);
    expect(mockPrisma.session.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "auth.user.registered" }),
      }),
    );
  });

  it("rejects a duplicate contact before sending a registration OTP", async () => {
    const { AuthService } = await import("../src/modules/auth/auth.service");
    const service = new AuthService();
    mockPrisma.user.findFirst.mockResolvedValueOnce({ id: "existing-user" });

    await expect(
      service.beginRegistration({
        email: `existing-${randomUUID()}@example.test`,
        password: "Correct-Horse-Battery-9!",
        displayName: "Existing User",
      }),
    ).rejects.toMatchObject({ status: 409, code: "ACCOUNT_EXISTS" });
  });
});
