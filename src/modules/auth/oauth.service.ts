import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../../config/database";

export class OAuthService {
// ─── Google OAuth ───────────────────────────────────────────────────────────

/**
 * Find or create a user from Google OAuth profile data.
 * Maps to davee's findOrCreateGoogleUser.
 */
findOrCreateGoogleUser = async (profile: {
  id: string;
  email: string;
  name: string;
  picture?: string | null;
}): Promise<{ userId: string }> => {
  const email = profile.email.toLowerCase();

  const existingUser = await prisma.user.findFirst({
    where: { email },
    select: { id: true },
  });

  if (existingUser) return { userId: existingUser.id };

  const userRole = await prisma.role.upsert({
    where: { name: "USER" },
    update: {},
    create: { name: "USER" },
  });

  const displayName = profile.name || email.split("@")[0] || email;
  const password = await argon2.hash(
    `oauth_google_${profile.id}_${Date.now()}`,
    {
      type: argon2.argon2id,
    },
  );

  const user = await prisma.user.create({
    data: {
      email,
      password,
      isActive: true,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      role: { connect: { id: userRole.id } },
      displayName,
      firstName: displayName,
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "auth.user.registered_via_google",
      entityType: "User",
      entityId: user.id,
    },
  });

  return { userId: user.id };
};

// ─── Facebook OAuth ─────────────────────────────────────────────────────────

/**
 * Find or create a user from Facebook OAuth profile data.
 * Reuses same create logic as Google (profile shape is compatible).
 */
findOrCreateFacebookUser = async (profile: {
  id: string;
  email: string;
  name: string;
  picture?: string | null;
}): Promise<{ userId: string }> => {
  // Reuse google flow — same logic, profile shape matches
  return this.findOrCreateGoogleUser(profile);
};

// ─── Session ─────────────────────────────────────────────────────────────────

/**
 * Create a secure opaque session token for OAuth user.
 * Stores in DB as refreshTokenHash (hukmee session pattern).
 */
createOAuthSession = async (
  userId: string,
): Promise<{ sessionToken: string; expiresAt: Date }> => {
  const sessionId = crypto.randomUUID();
  const rawToken = `${sessionId}.${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await prisma.session.create({
    data: {
      id: sessionId,
      userId,
      refreshTokenHash: rawToken,
      expiresAt,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "auth.session.created_via_oauth",
      entityType: "Session",
      entityId: sessionId,
    },
  });

  return { sessionToken: rawToken, expiresAt };
};

// ─── OTP helpers (davee compat) ──────────────────────────────────────────────

generateOTP = (): string => {
  return String(Math.floor(100000 + Math.random() * 900000));
};
}

export const oauthService = new OAuthService();
export const findOrCreateGoogleUser = oauthService.findOrCreateGoogleUser;
export const findOrCreateFacebookUser = oauthService.findOrCreateFacebookUser;
export const createOAuthSession = oauthService.createOAuthSession;
export const generateOTP = oauthService.generateOTP;
