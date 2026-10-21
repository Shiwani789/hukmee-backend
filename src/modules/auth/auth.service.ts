import argon2 from "argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { Prisma, type UserRole } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/errors";
import type { RegisterInput } from "../../validation/auth";

const USER_ROLE: UserRole = "USER";
const refreshLifetimeMs = env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000;
const pendingRegistrationTtlMs = (env.OTP_CHALLENGE_TTL_SECONDS ?? 300) * 1000;

type PendingRegistration = {
  registrationId: string;
  email?: string;
  phone?: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  expiresAt: number;
};

const pendingRegistrations = new Map<string, PendingRegistration>();
const pendingRegistrationCleanup = setInterval(() => {
  const now = Date.now();
  for (const [identifier, pending] of pendingRegistrations) {
    if (pending.expiresAt <= now) pendingRegistrations.delete(identifier);
  }
}, 60_000);
pendingRegistrationCleanup.unref?.();

// ─── Allowed public registration roles (same as davee backend) ────────────────
export const ALLOWED_REGISTRATION_ROLES = [
  "USER",
  "WORKER",
  "TECHNICIAN",
  "VENDOR",
  "DELIVERY_PARTNER",
] as const;
export type AllowedRegistrationRole =
  (typeof ALLOWED_REGISTRATION_ROLES)[number];
const userInclude = {
  role: { include: { permissions: true } },
} satisfies Prisma.UserInclude;

type UserRecord = Prisma.UserGetPayload<{ include: typeof userInclude }>;
type Db = Prisma.TransactionClient;

export type PublicUser = {
  id: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  role: string;
  roles: string[];
  permissions: string[];
};

export type AuthResult = {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

function normalizeRole(role: string): UserRole {
  const normalized = role.toUpperCase();
  return (normalized === "TECHNICIAN" ? "WORKER" : normalized) as UserRole;
}

const refreshDigest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    isActive: user.isActive,
    createdAt: user.createdAt,
    role: user.role.name,
    roles:
      user.role.name === "WORKER" ? ["WORKER", "TECHNICIAN"] : [user.role.name],
    permissions: user.role.permissions.map(
      ({ resource, action }) => `${resource}:${action}`,
    ),
  };
}

function accessToken(user: UserRecord, sessionId: string): string {
  const publicUser = toPublicUser(user);
  return jwt.sign(
    {
      sid: sessionId,
      roles: publicUser.roles,
      permissions: publicUser.permissions,
    },
    env.JWT_ACCESS_SECRET,
    {
      algorithm: "HS256",
      subject: user.id,
      issuer: "hukmee-api",
      audience: "hukmee-clients",
      expiresIn: env.JWT_ACCESS_TTL as NonNullable<SignOptions["expiresIn"]>,
    },
  );
}

async function writeAudit(
  db: Db,
  actorUserId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
): Promise<void> {
  await db.auditLog.create({
    data: { actorUserId, action, entityType, entityId },
  });
}

async function issueSession(
  db: Db,
  user: UserRecord,
  ipAddress?: string,
  userAgent?: string,
): Promise<AuthResult> {
  const sessionId = randomUUID();
  const refreshToken = `${sessionId}.${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + refreshLifetimeMs);
  await db.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      refreshTokenHash: refreshDigest(refreshToken),
      expiresAt,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    },
  });
  await writeAudit(db, user.id, "auth.session.created", "Session", sessionId);
  return {
    user: toPublicUser(user),
    accessToken: accessToken(user, sessionId),
    refreshToken,
    expiresAt,
  };
}

export class AuthService {
  async beginRegistration(
    input: RegisterInput,
  ): Promise<{ registrationId: string; identifier: string }> {
    const email = input.email?.trim().toLowerCase();
    const phone = input.phone?.trim();
    const identifier = email ?? phone!;
    const normalizedIdentifier = identifier.toLowerCase();
    const where = email ? { email } : { phone: phone! };

    const existing = await prisma.user.findFirst({
      where,
      select: { id: true },
    });
    if (existing)
      throw new AppError(409, "ACCOUNT_EXISTS", "Account already exists");

    const now = Date.now();
    for (const [key, pending] of pendingRegistrations) {
      if (pending.expiresAt <= now) pendingRegistrations.delete(key);
    }

    const role = normalizeRole(input.role ?? USER_ROLE);
    const pending: PendingRegistration = {
      registrationId: randomUUID(),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      passwordHash: await argon2.hash(input.password, {
        type: argon2.argon2id,
      }),
      displayName: (input.displayName ?? input.name ?? "").trim(),
      role,
      expiresAt: now + pendingRegistrationTtlMs,
    };
    pendingRegistrations.set(normalizedIdentifier, pending);
    return { registrationId: pending.registrationId, identifier };
  }

  cancelPendingRegistration(identifier: string, registrationId: string): void {
    const key = identifier.trim().toLowerCase();
    if (pendingRegistrations.get(key)?.registrationId === registrationId)
      pendingRegistrations.delete(key);
  }

  async completeRegistration(identifier: string): Promise<AuthResult> {
    const key = identifier.trim().toLowerCase();
    const pending = pendingRegistrations.get(key);
    if (!pending || pending.expiresAt <= Date.now()) {
      pendingRegistrations.delete(key);
      throw new AppError(
        400,
        "OTP_NOT_FOUND",
        "Registration request expired or not found. Please start again.",
      );
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const role = await tx.role.upsert({
          where: { name: pending.role },
          update: {},
          create: { name: pending.role },
        });
        const user = await tx.user.create({
          data: {
            ...(pending.email
              ? { email: pending.email, emailVerifiedAt: new Date() }
              : {}),
            ...(pending.phone
              ? { phone: pending.phone, phoneVerifiedAt: new Date() }
              : {}),
            password: pending.passwordHash,
            isActive: true,
            status: "ACTIVE",
            lastLoginAt: new Date(),
            role: { connect: { id: role.id } },
            displayName: pending.displayName,
            firstName: pending.displayName,
          },
          include: userInclude,
        });
        await writeAudit(tx, user.id, "auth.user.registered", "User", user.id);
        return issueSession(tx, user);
      });
      pendingRegistrations.delete(key);
      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(409, "ACCOUNT_EXISTS", "Account already exists");
      }
      throw error;
    }
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const email = input.email?.trim().toLowerCase();
    const phone = input.phone?.trim();
    const displayName = (input.displayName ?? input.name ?? "").trim();

    try {
      return await prisma.$transaction(async (tx) => {
        const roleName = normalizeRole(input.role ?? USER_ROLE);
        const role = await tx.role.upsert({
          where: { name: roleName },
          update: {},
          create: { name: roleName },
        });
        const user = await tx.user.create({
          data: {
            ...(email ? { email } : {}),
            ...(phone ? { phone } : {}),
            password: await argon2.hash(input.password, {
              type: argon2.argon2id,
            }),
            role: { connect: { id: role.id } },
            displayName,
            firstName: displayName,
            status: "ACTIVE",
          },
          include: userInclude,
        });
        await writeAudit(tx, user.id, "auth.user.registered", "User", user.id);
        return issueSession(tx, user);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(409, "ACCOUNT_EXISTS", "Account already exists");
      }
      throw error;
    }
  }

  async login(
    identifier: string,
    password: string,
    allowedRoles?: UserRole[],
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResult> {
    const normalized = identifier.includes("@")
      ? identifier.trim().toLowerCase()
      : identifier.trim();
    const user = await prisma.user.findFirst({
      where: {
        isActive: true,
        isDeleted: false,
        status: "ACTIVE",
        OR: identifier.includes("@")
          ? [{ email: normalized }]
          : [{ phone: normalized }],
      },
      include: userInclude,
    });
    if (!user?.password || !(await argon2.verify(user.password, password))) {
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid email/phone or password.",
      );
    }
    if (allowedRoles && !allowedRoles.includes(user.role.name))
      throw new AppError(403, "FORBIDDEN", "Admin access only");
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
        include: userInclude,
      });
      await writeAudit(
        tx,
        current.id,
        "auth.login.succeeded",
        "User",
        current.id,
      );
      return issueSession(tx, current, ipAddress, userAgent);
    });
    return updated;
  }

  async createSessionForUser(
    userId: string,
    requiredRole?: UserRole | string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId, isActive: true, isDeleted: false, status: "ACTIVE" },
      include: userInclude,
    });
    if (!user)
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid email/phone or password.",
      );
    if (
      requiredRole &&
      user.role.name !==
        (requiredRole ? normalizeRole(requiredRole) : undefined)
    )
      throw new AppError(403, "FORBIDDEN", "Requested role is not assigned");
    return prisma.$transaction(async (tx) => {
      const current = await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
        include: userInclude,
      });
      await writeAudit(
        tx,
        current.id,
        "auth.login.otp_succeeded",
        "User",
        current.id,
      );
      return issueSession(tx, current, ipAddress, userAgent);
    });
  }

  async checkUserRole(userId: string): Promise<UserRole | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: { select: { name: true } } },
    });
    return user?.role.name ?? null;
  }

  /**
   * Login or auto-register via OTP (same as davee loginWithOTP flow).
   * If user does not exist, creates account implicitly (OTP proves ownership).
   */
  async loginWithOTP(
    data: { email?: string; phone?: string; roleType: string },
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResult> {
    const normalizedRole = normalizeRole(data.roleType);
    const ADMIN_ROLES: string[] = ["ADMIN", "SUPER_ADMIN"];
    if (ADMIN_ROLES.includes(normalizedRole))
      throw new AppError(
        403,
        "FORBIDDEN",
        "Admin login/signup is not allowed from this OTP endpoint.",
      );
    if (
      !(ALLOWED_REGISTRATION_ROLES as readonly string[]).includes(
        normalizedRole,
      )
    )
      throw new AppError(
        400,
        "INVALID_ROLE",
        `Invalid role. Allowed: ${ALLOWED_REGISTRATION_ROLES.join(", ")}.`,
      );

    const normalized = (data.email ?? data.phone ?? "").trim().toLowerCase();
    const existingUser = await prisma.user.findFirst({
      where: data.email ? { email: normalized } : { phone: normalized },
      include: userInclude,
    });

    let userId: string;

    if (!existingUser) {
      // Implicit registration: OTP verifies ownership
      userId = await prisma.$transaction(async (tx) => {
        const role = await tx.role.upsert({
          where: { name: normalizedRole },
          update: {},
          create: { name: normalizedRole },
        });
        const displayName =
          (data.email
            ? data.email.split("@")[0] || data.email
            : (data.phone ?? "User")) ?? "User";
        const created = await tx.user.create({
          data: {
            ...(data.email ? { email: normalized } : {}),
            ...(data.phone ? { phone: data.phone.trim() } : {}),
            password: await argon2.hash(normalizedRole + Date.now(), {
              type: argon2.argon2id,
            }),
            isActive: true,
            ...(data.email ? { emailVerifiedAt: new Date() } : {}),
            ...(data.phone ? { phoneVerifiedAt: new Date() } : {}),
            role: { connect: { id: role.id } },
            displayName,
            firstName: displayName,
            status: "ACTIVE",
          },
        });
        await writeAudit(
          tx,
          created.id,
          "auth.user.registered_via_otp",
          "User",
          created.id,
        );
        return created.id;
      });
    } else {
      // User exists — check active and role match
      if (
        !existingUser.isActive ||
        existingUser.isDeleted ||
        existingUser.status !== "ACTIVE"
      )
        throw new AppError(403, "FORBIDDEN", "Account is not active.");
      const userRoleName = existingUser.role.name;
      if (userRoleName && userRoleName !== normalizedRole) {
        const roleName =
          userRoleName.charAt(0).toUpperCase() +
          userRoleName.slice(1).toLowerCase();
        const type = data.phone ? "phone number" : "email";
        const shortType = data.phone ? "number" : "email";
        throw new AppError(
          400,
          "ROLE_MISMATCH",
          `This ${type} is already registered with a ${roleName} account. Please use a different ${shortType}.`,
        );
      }
      // Update verification status if needed
      if (
        (data.email && !existingUser.emailVerifiedAt) ||
        (data.phone && !existingUser.phoneVerifiedAt)
      ) {
        await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            ...(data.email ? { emailVerifiedAt: new Date() } : {}),
            ...(data.phone ? { phoneVerifiedAt: new Date() } : {}),
          },
        });
      }
      userId = existingUser.id;
    }

    return prisma.$transaction(async (tx) => {
      const current = await tx.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
        include: userInclude,
      });
      await writeAudit(
        tx,
        current.id,
        "auth.login.otp_succeeded",
        "User",
        current.id,
      );
      return issueSession(tx, current, ipAddress, userAgent);
    });
  }

  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.password || !(await argon2.verify(user.password, password)))
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid email/phone or password.",
      );
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          isDeleted: true,
          deletedAt: new Date(),
          status: "INACTIVE",
        },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await writeAudit(tx, userId, "auth.account.deactivated", "User", userId);
    });
  }

  async refresh(token: string): Promise<AuthResult> {
    const sessionId = token.split(".", 1)[0];
    if (!sessionId)
      throw new AppError(
        401,
        "INVALID_REFRESH_TOKEN",
        "Refresh token is invalid",
      );
    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        include: { user: { include: userInclude } },
      });
      if (
        !session ||
        !session.user.isActive ||
        session.user.isDeleted ||
        session.user.status !== "ACTIVE" ||
        session.expiresAt <= new Date()
      ) {
        throw new AppError(
          401,
          "INVALID_REFRESH_TOKEN",
          "Refresh token is invalid or expired",
        );
      }
      const reused = refreshDigest(token) !== session.refreshTokenHash;
      if (session.revokedAt || reused) {
        await tx.session.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await writeAudit(
          tx,
          session.userId,
          "auth.refresh.reuse_detected",
          "Session",
          session.id,
        );
        return { refreshReuseDetected: true as const };
      }

      const nextRefreshToken = `${session.id}.${randomBytes(32).toString("base64url")}`;
      const nextExpiry = new Date(Date.now() + refreshLifetimeMs);
      const rotated = await tx.session.updateMany({
        where: {
          id: session.id,
          refreshTokenHash: session.refreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: {
          refreshTokenHash: refreshDigest(nextRefreshToken),
          expiresAt: nextExpiry,
        },
      });
      if (rotated.count !== 1) {
        throw new AppError(
          401,
          "INVALID_REFRESH_TOKEN",
          "Refresh token is no longer valid",
        );
      }
      await writeAudit(
        tx,
        session.userId,
        "auth.refresh.rotated",
        "Session",
        session.id,
      );
      return {
        user: toPublicUser(session.user),
        accessToken: accessToken(session.user, session.id),
        refreshToken: nextRefreshToken,
        expiresAt: nextExpiry,
      };
    });
    if ("refreshReuseDetected" in result) {
      throw new AppError(
        401,
        "REFRESH_TOKEN_REUSED",
        "Refresh token is no longer valid",
      );
    }
    return result;
  }

  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const result = await prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count)
      await writeAudit(
        prisma,
        userId,
        "auth.session.revoked",
        "Session",
        sessionId,
      );
    return result.count > 0;
  }

  async revokeAll(userId: string): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const result = await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await writeAudit(tx, userId, "auth.sessions.revoked_all", "User", userId);
      return result.count;
    });
  }

  async listSessions(userId: string) {
    return prisma.session.findMany({
      where: { userId },
      select: { id: true, createdAt: true, expiresAt: true, revokedAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async getUser(userId: string): Promise<PublicUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: userInclude,
    });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Account not found");
    return toPublicUser(user);
  }
}
