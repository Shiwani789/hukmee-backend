import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { env } from "../../config/env";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/errors";

const OTP_RETENTION_MS = 24 * 60 * 60 * 1000;

type OtpRecord = {
  userId: string | null;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  consumedAt?: number;
};

// Like the Constructor auth flow, OTP state lives in the auth service rather
// than a Prisma model. This is intentionally process-local and is suited to
// the current single-instance development setup.
const otpStore = new Map<string, OtpRecord>();

function normalize(identifier: string): string {
  return identifier.trim().toLowerCase();
}

function digest(identifier: string, code: string): Buffer {
  return createHmac("sha256", env.JWT_ACCESS_SECRET)
    .update(`${normalize(identifier)}:${code}`)
    .digest();
}

function configured(): boolean {
  return Boolean(
    env.OTP_PROVIDER_URL &&
      env.OTP_PROVIDER_TOKEN &&
      env.OTP_CHALLENGE_TTL_SECONDS &&
      env.OTP_MAX_ATTEMPTS,
  );
}

function nonProductionStaticCode(): string | undefined {
  return env.NODE_ENV === "production" ? undefined : env.OTP_DEV_STATIC_CODE;
}

function cleanExpiredRecords(now: number): void {
  for (const [identifier, record] of otpStore) {
    if (now - record.expiresAt > OTP_RETENTION_MS) otpStore.delete(identifier);
  }
}

type OtpFailure = "missing" | "expired" | "used" | "attempts" | "invalid";

function throwOtpFailure(failure: OtpFailure): never {
  if (failure === "expired") {
    throw new AppError(
      400,
      "OTP_EXPIRED",
      "OTP has expired. Please request a new one.",
    );
  }
  if (failure === "used") {
    throw new AppError(
      400,
      "OTP_ALREADY_USED",
      "OTP has already been used. Please request a new one.",
    );
  }
  if (failure === "attempts") {
    throw new AppError(
      429,
      "OTP_ATTEMPTS_EXCEEDED",
      "Too many attempts. Please request a new OTP.",
    );
  }
  if (failure === "missing") {
    throw new AppError(
      400,
      "OTP_NOT_FOUND",
      "No active OTP was found. Please request a new one.",
    );
  }
  throw new AppError(400, "INVALID_OTP", "Invalid OTP. Please try again.");
}

async function consumeOtp(
  identifier: string,
  code: string,
): Promise<string | null> {
  const normalized = normalize(identifier);
  const record = otpStore.get(normalized);
  if (!record) throwOtpFailure("missing");
  if (record.consumedAt) throwOtpFailure("used");

  const now = Date.now();
  if (record.expiresAt <= now) throwOtpFailure("expired");
  const maxAttempts = env.OTP_MAX_ATTEMPTS ?? 5;
  if (record.attempts >= maxAttempts) throwOtpFailure("attempts");

  const expected = Buffer.from(record.codeHash, "hex");
  const actual = digest(normalized, code);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    record.attempts += 1;
    throwOtpFailure(record.attempts >= maxAttempts ? "attempts" : "invalid");
  }

  record.consumedAt = now;
  return record.userId;
}


export class OtpService {
  async requestOtp(
  identifier: string,
  allowUnregistered = false,
): Promise<"static" | "provider" | "suppressed"> {
  const staticCode = nonProductionStaticCode();
  if (!staticCode && !configured()) {
    throw new AppError(
      503,
      "OTP_PROVIDER_UNAVAILABLE",
      "OTP delivery is not configured",
    );
  }

  const normalized = normalize(identifier);
  const user = await prisma.user.findFirst({
    where: normalized.includes("@")
      ? { email: normalized }
      : { phone: normalized },
  });
  // Keep the send response independent of account existence.
  if (!user && !allowUnregistered) return "suppressed";

  const now = Date.now();
  cleanExpiredRecords(now);
  const ttlSeconds = env.OTP_CHALLENGE_TTL_SECONDS ?? 300;
  const code = staticCode ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
  otpStore.set(normalized, {
    userId: user?.id ?? null,
    codeHash: digest(normalized, code).toString("hex"),
    createdAt: now,
    expiresAt: now + ttlSeconds * 1000,
    attempts: 0,
  });

  if (staticCode) return "static";

  try {
    const response = await fetch(env.OTP_PROVIDER_URL!, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OTP_PROVIDER_TOKEN!}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        recipient: identifier,
        code,
        expiresInSeconds: ttlSeconds,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("OTP provider rejected delivery");
    return "provider";
  } catch {
    otpStore.delete(normalized);
    throw new AppError(
      503,
      "OTP_DELIVERY_FAILED",
      "OTP delivery is temporarily unavailable",
    );
  }
}

  async verifyOtp(
  identifier: string,
  code: string,
): Promise<{ userId: string | null }> {
  const userId = await consumeOtp(identifier, code);
  if (userId) {
    const normalized = normalize(identifier);
    await prisma.user.update({
      where: { id: userId },
      data: normalized.includes("@")
        ? { emailVerifiedAt: new Date() }
        : { phoneVerifiedAt: new Date() },
    });
  }
  return { userId };
}

  async resetPassword(
  identifier: string,
  code: string,
  newPassword: string,
): Promise<void> {
  const userId = await consumeOtp(identifier, code);
  if (!userId) throwOtpFailure("missing");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        password: await argon2.hash(newPassword, { type: argon2.argon2id }),
      },
    });
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "auth.password.reset",
        entityType: "User",
        entityId: userId,
        metadata: {
          identifierType: normalize(identifier).includes("@")
            ? "email"
            : "phone",
        },
      },
    });
  });
}
}

export const otpService = new OtpService();
export const requestOtp = otpService.requestOtp.bind(otpService);
export const verifyOtp = otpService.verifyOtp.bind(otpService);
export const resetPassword = otpService.resetPassword.bind(otpService);
