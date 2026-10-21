import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env";
import { prisma } from "../config/database";
import { AppError } from "../utils/errors";
import { asyncHandler } from "../utils/async-handler";

const roleAccessInclude = {
  role: { include: { permissions: true } },
} as const;

function authRoles(role: string): string[] {
  return role === "WORKER" ? ["WORKER", "TECHNICIAN"] : [role];
}

function authPermissions(role: {
  permissions: { action: string; resource: string }[];
}): string[] {
  return role.permissions.map(
    ({ action, resource }) => `${resource}:${action}`,
  );
}

// Express request augmentation is the supported typing pattern for request-scoped auth.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionId: string;
        roles: string[];
        permissions: string[];
      };
    }
  }
}
export const authenticate: RequestHandler = asyncHandler(
  async (req, _res, next) => {
    if (req.session?.userId) {
      const session = req.session.authSessionId
        ? await prisma.session.findFirst({
            where: {
              id: req.session.authSessionId,
              userId: req.session.userId,
              revokedAt: null,
              expiresAt: { gt: new Date() },
              user: { isActive: true, isDeleted: false, status: "ACTIVE" },
            },
            include: {
              user: { include: roleAccessInclude },
            },
          })
        : null;
      if (!session)
        throw new AppError(
          401,
          "SESSION_REVOKED",
          "Session is no longer active",
        );
      req.auth = {
        userId: session.userId,
        sessionId: session.id,
        roles: authRoles(session.user.role.name),
        permissions: authPermissions(session.user.role),
      };
      return next();
    }
    const cookieToken = readSessionCookie(req.header("cookie"));
    if (cookieToken) {
      const session = await prisma.session.findFirst({
        where: {
          refreshTokenHash: createHash("sha256")
            .update(cookieToken)
            .digest("hex"),
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { isActive: true, isDeleted: false, status: "ACTIVE" },
        },
        include: {
          user: { include: roleAccessInclude },
        },
      });
      if (session) {
        const roles = authRoles(session.user.role.name);
        const permissions = authPermissions(session.user.role);
        req.auth = {
          userId: session.userId,
          sessionId: session.id,
          roles,
          permissions,
        };
        return next();
      }
    }
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer "))
      throw new AppError(
        401,
        "UNAUTHORIZED",
        "Authentication required. Please log in.",
      );
    let claims: jwt.JwtPayload;
    try {
      claims = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, {
        algorithms: ["HS256"],
        issuer: "hukmee-api",
        audience: "hukmee-clients",
      }) as jwt.JwtPayload;
    } catch {
      throw new AppError(
        401,
        "INVALID_TOKEN",
        "Access token is invalid or expired",
      );
    }
    if (typeof claims.sub !== "string" || typeof claims.sid !== "string")
      throw new AppError(401, "INVALID_TOKEN", "Access token is invalid");
    const session = await prisma.session.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true, isDeleted: false, status: "ACTIVE" },
      },
      include: {
        user: { include: roleAccessInclude },
      },
    });
    if (!session)
      throw new AppError(401, "SESSION_REVOKED", "Session is no longer active");
    const roles = authRoles(session.user.role.name);
    const permissions = authPermissions(session.user.role);
    req.auth = {
      userId: session.userId,
      sessionId: session.id,
      roles,
      permissions,
    };
    next();
  },
);

function readSessionCookie(header?: string): string | undefined {
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== "session_token")
      continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export { requireRole } from "./role";
export { requirePermission } from "./permission";
