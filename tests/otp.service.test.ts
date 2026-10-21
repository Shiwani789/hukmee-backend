import { randomUUID } from "node:crypto";

const mockEnvironment = {
  NODE_ENV: "development",
  OTP_DEV_STATIC_CODE: "123456" as string | undefined,
  OTP_CHALLENGE_TTL_SECONDS: 300,
  OTP_MAX_ATTEMPTS: 3,
  OTP_PROVIDER_URL: undefined as string | undefined,
  OTP_PROVIDER_TOKEN: undefined as string | undefined,
  JWT_ACCESS_SECRET: "test-secret-used-for-otp-digest",
};
let mockUser: { id: string } | null = { id: "user-1" };
const mockPrisma = {
  user: {
    findFirst: jest.fn(async (): Promise<{ id: string } | null> => mockUser),
    update: jest.fn(async () => mockUser),
  },
  session: { updateMany: jest.fn(async () => ({ count: 0 })) },
  auditLog: { create: jest.fn(async () => ({})) },
  $transaction: jest.fn(
    async <T>(callback: (tx: never) => Promise<T>): Promise<T> =>
      callback(mockPrisma as never),
  ),
};

let requestOtp: typeof import("../src/modules/auth/otp.service").requestOtp;
let verifyOtp: typeof import("../src/modules/auth/otp.service").verifyOtp;

beforeAll(async () => {
  jest.doMock("../src/config/env", () => ({ env: mockEnvironment }));
  jest.doMock("../src/config/database", () => ({ prisma: mockPrisma }));
  ({ requestOtp, verifyOtp } = await import("../src/modules/auth/otp.service"));
});

beforeEach(() => {
  mockUser = { id: `user-${randomUUID()}` };
  mockEnvironment.NODE_ENV = "development";
  mockEnvironment.OTP_DEV_STATIC_CODE = "123456";
  mockEnvironment.OTP_CHALLENGE_TTL_SECONDS = 300;
  mockEnvironment.OTP_MAX_ATTEMPTS = 3;
  mockEnvironment.OTP_PROVIDER_URL = undefined;
  mockEnvironment.OTP_PROVIDER_TOKEN = undefined;
  mockPrisma.user.findFirst.mockImplementation(async () => mockUser);
  mockPrisma.user.update.mockImplementation(async () => mockUser);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("process-local OTP issue and verification", () => {
  it("verifies the configured local development code for the same identifier", async () => {
    const identifier = `+1${randomUUID().replaceAll("-", "")}`;
    const userId = mockUser!.id;
    await requestOtp(identifier);

    await expect(verifyOtp(identifier, "123456")).resolves.toEqual({ userId });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { phoneVerifiedAt: expect.any(Date) },
    });
  });

  it("rejects an incorrect code and limits repeated attempts", async () => {
    const identifier = `+1${randomUUID().replaceAll("-", "")}`;
    await requestOtp(identifier);

    await expect(verifyOtp(identifier, "000000")).rejects.toMatchObject({
      code: "INVALID_OTP",
    });
    await expect(verifyOtp(identifier, "000000")).rejects.toMatchObject({
      code: "INVALID_OTP",
    });
    await expect(verifyOtp(identifier, "000000")).rejects.toMatchObject({
      code: "OTP_ATTEMPTS_EXCEEDED",
    });
    await expect(verifyOtp(identifier, "123456")).rejects.toMatchObject({
      code: "OTP_ATTEMPTS_EXCEEDED",
    });
  });

  it("returns an expired-code error when the stored expiry has passed", async () => {
    const identifier = `+1${randomUUID().replaceAll("-", "")}`;
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await requestOtp(identifier);
    jest.setSystemTime(new Date("2026-01-01T00:05:01Z"));

    await expect(verifyOtp(identifier, "123456")).rejects.toMatchObject({
      code: "OTP_EXPIRED",
    });
  });

  it("replaces the previous code on resend", async () => {
    const identifier = `+1${randomUUID().replaceAll("-", "")}`;
    await requestOtp(identifier);
    mockEnvironment.OTP_DEV_STATIC_CODE = "654321";
    await requestOtp(identifier);

    await expect(verifyOtp(identifier, "123456")).rejects.toMatchObject({
      code: "INVALID_OTP",
    });
    await expect(verifyOtp(identifier, "654321")).resolves.toEqual({
      userId: mockUser!.id,
    });
  });

  it("reports missing and already-consumed OTPs", async () => {
    const missingIdentifier = `+1${randomUUID().replaceAll("-", "")}`;
    await expect(verifyOtp(missingIdentifier, "123456")).rejects.toMatchObject({
      code: "OTP_NOT_FOUND",
    });

    const identifier = `+1${randomUUID().replaceAll("-", "")}`;
    await requestOtp(identifier);
    await verifyOtp(identifier, "123456");
    await expect(verifyOtp(identifier, "123456")).rejects.toMatchObject({
      code: "OTP_ALREADY_USED",
    });
  });

  it("does not issue a code for unknown accounts", async () => {
    const identifier = `+1${randomUUID().replaceAll("-", "")}`;
    mockUser = null;
    await requestOtp(identifier);

    await expect(verifyOtp(identifier, "123456")).rejects.toMatchObject({
      code: "OTP_NOT_FOUND",
    });
  });

  it("does not allow the configured static code outside development", async () => {
    mockEnvironment.NODE_ENV = "production";

    await expect(
      requestOtp(`+1${randomUUID().replaceAll("-", "")}`),
    ).rejects.toMatchObject({
      code: "OTP_PROVIDER_UNAVAILABLE",
    });
  });

  it("sends provider OTPs only after provider confirmation", async () => {
    const identifier = `+1${randomUUID().replaceAll("-", "")}`;
    mockEnvironment.OTP_DEV_STATIC_CODE = undefined;
    mockEnvironment.OTP_PROVIDER_URL = "https://sms.example.test/send";
    mockEnvironment.OTP_PROVIDER_TOKEN = "test-provider-token";
    const fetch = jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: true } as Response);

    await expect(requestOtp(identifier)).resolves.toBe("provider");
    const request = fetch.mock.calls[0]?.[1];
    const payload = JSON.parse(String(request?.body)) as { code: string };
    expect(payload.code).toMatch(/^\d{6}$/);
    await expect(verifyOtp(identifier, payload.code)).resolves.toEqual({
      userId: mockUser!.id,
    });
  });

  it("removes a challenge when provider delivery fails", async () => {
    const identifier = `+1${randomUUID().replaceAll("-", "")}`;
    mockEnvironment.OTP_DEV_STATIC_CODE = undefined;
    mockEnvironment.OTP_PROVIDER_URL = "https://sms.example.test/send";
    mockEnvironment.OTP_PROVIDER_TOKEN = "test-provider-token";
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: false } as Response);

    await expect(requestOtp(identifier)).rejects.toMatchObject({
      status: 503,
      code: "OTP_DELIVERY_FAILED",
    });
    await expect(verifyOtp(identifier, "123456")).rejects.toMatchObject({
      code: "OTP_NOT_FOUND",
    });
  });

  it("treats provider timeouts as delivery failures", async () => {
    const identifier = `+1${randomUUID().replaceAll("-", "")}`;
    mockEnvironment.OTP_DEV_STATIC_CODE = undefined;
    mockEnvironment.OTP_PROVIDER_URL = "https://sms.example.test/send";
    mockEnvironment.OTP_PROVIDER_TOKEN = "test-provider-token";
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("timeout"));

    await expect(requestOtp(identifier)).rejects.toMatchObject({
      status: 503,
      code: "OTP_DELIVERY_FAILED",
    });
    await expect(verifyOtp(identifier, "123456")).rejects.toMatchObject({
      code: "OTP_NOT_FOUND",
    });
  });
});
