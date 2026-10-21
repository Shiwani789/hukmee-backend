import { authenticatedContext } from "../../utils/auth-context";
import type { Request, Response } from "express";
import { env } from "../../config/env";
import { AppError } from "../../utils/errors";
import { asyncHandler } from "../../utils/async-handler";
import { AuthService, ALLOWED_REGISTRATION_ROLES } from "./auth.service";
import { requestOtp, resetPassword, verifyOtp } from "./otp.service";
import {
  validatedBody,
  validatedParams,
  validatedQuery,
} from "../../utils/validated-request";
import {
  adminLoginSchema,
  compatibilityIdentifierSchema,
  compatibilityOtpLoginSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  identifierOnlySchema,
  loginSchema,
  otpLoginSchema,
  otpRequestSchema,
  otpVerifySchema,
  passwordLoginSchema,
  passwordResetSchema,
  refreshSchema,
  registerSchema,
  registrationVerifySchema,
  resendOtpSchema,
  sessionIdParamsSchema,
} from "../../validation/auth";

const service = new AuthService();
const CUSTOM_OTP_TTL_MS = 5 * 60 * 1000;
const pendingCustomOTPs = new Map<
  string,
  { role: string; expiresAt: number }
>();
const pendingOtpCleanup = setInterval(() => {
  const now = Date.now();
  for (const [identifier, request] of pendingCustomOTPs) {
    if (request.expiresAt <= now) pendingCustomOTPs.delete(identifier);
  }
}, 60_000);
pendingOtpCleanup.unref?.();

const normalizeIdentifier = (identifier: string) =>
  identifier.trim().toLowerCase();
const sessionCookieName = "session_token";
const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: (env.NODE_ENV === "production" ? "none" : "lax") as "none" | "lax",
  path: "/",
  maxAge: env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
});
const setSessionCookie = (res: Response, token: string) => {
  res.cookie(sessionCookieName, token, sessionCookieOptions());
};
const clearSessionCookie = (res: Response) => {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });
};
const cookieToken = (req: Request) => {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== sessionCookieName)
      continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
};
const establishExpressSession = async (
  req: Request,
  result: Awaited<ReturnType<AuthService["login"]>>,
) => {
  const authSessionId = result.refreshToken.split(".", 1)[0];
  if (!authSessionId) throw new Error("Issued refresh token is malformed");
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
  req.session.userId = result.user.id;
  req.session.authSessionId = authSessionId;
  req.session.roles = result.user.roles;
  await new Promise<void>((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
};
const destroyExpressSession = async (req: Request, res: Response) => {
  await new Promise<void>((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
  res.clearCookie("connect.sid", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });
  clearSessionCookie(res);
};

export class AuthController {
  register = asyncHandler(async (_req, res) => {
    const input = validatedBody(registerSchema, res);
    const { registrationId, identifier } =
      await service.beginRegistration(input);
    try {
      await requestOtp(identifier, true);
    } catch (error) {
      service.cancelPendingRegistration(identifier, registrationId);
      throw error;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(202).json({ data: { accepted: true } });
  });
  verifyRegistration = asyncHandler(async (req, res) => {
    const { identifier, otp } = validatedBody(registrationVerifySchema, res);
    await verifyOtp(identifier, otp);
    const result = await service.completeRegistration(identifier);
    await establishExpressSession(req, result);
    setSessionCookie(res, result.refreshToken);
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ data: result });
  });
  login = asyncHandler(async (_req, res) => {
    const { identifier } = validatedBody(loginSchema, res);
    await requestOtp(identifier, true);
    res.setHeader("Cache-Control", "no-store");
    res.status(202).json({ data: { accepted: true } });
  });
  passwordLogin = asyncHandler(async (req, res) => {
    const { identifier, password } = validatedBody(passwordLoginSchema, res);
    const result = await service.login(
      identifier,
      password,
      undefined,
      req.ip,
      req.headers["user-agent"],
    );
    await establishExpressSession(req, result);
    setSessionCookie(res, result.refreshToken);
    res.setHeader("Cache-Control", "no-store");
    res.json({ data: result });
  });
  adminLogin = asyncHandler(async (req, res) => {
    const { email, password } = validatedBody(adminLoginSchema, res);
    const result = await service.login(
      email,
      password,
      ["ADMIN", "SUPER_ADMIN"],
      req.ip,
      req.headers["user-agent"],
    );
    await establishExpressSession(req, result);
    setSessionCookie(res, result.refreshToken);
    res.setHeader("Cache-Control", "no-store");
    res.json({ data: result });
  });
  sendOtp = asyncHandler(async (_req, res) => {
    const { identifier } = validatedBody(identifierOnlySchema, res);
    const { role } = validatedQuery(identifierOnlySchema, res);
    if (role === "ADMIN" || role === "SUPER_ADMIN")
      throw new AppError(403, "FORBIDDEN", "Admin OTP login is not allowed");
    await requestOtp(identifier, true);
    res.setHeader("Cache-Control", "no-store");
    res.status(202).json({ data: { accepted: true } });
  });
  sendOtpCompatibility = asyncHandler(async (_req, res) => {
    const { identifier, phone } = validatedBody(
      compatibilityIdentifierSchema,
      res,
    );
    const normalizedInput = identifier ?? phone;
    if (!normalizedInput)
      throw new AppError(400, "VALIDATION_ERROR", "Identifier is required");
    const { role } = validatedQuery(compatibilityIdentifierSchema, res);
    if (role === "ADMIN" || role === "SUPER_ADMIN")
      throw new AppError(403, "FORBIDDEN", "Admin OTP login is not allowed");
    if (
      role &&
      !(ALLOWED_REGISTRATION_ROLES as readonly string[]).includes(role)
    )
      throw new AppError(
        400,
        "INVALID_ROLE",
        `Invalid role. Allowed: ${ALLOWED_REGISTRATION_ROLES.join(", ")}.`,
      );
    const normalizedIdentifier = normalizeIdentifier(normalizedInput);
    const requestedRole = role ?? "USER";
    const delivery = await requestOtp(normalizedIdentifier, true);
    pendingCustomOTPs.set(normalizedIdentifier, {
      role: requestedRole,
      expiresAt: Date.now() + CUSTOM_OTP_TTL_MS,
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      message:
        delivery === "static"
          ? "OTP sent successfully. Use static OTP 123456."
          : "If the account is eligible, an OTP has been sent.",
    });
  });
  // ─── RESEND OTP (davee compatible) ────────────────────────────────
  resendOtp = asyncHandler(async (_req, res) => {
    const { identifier } = validatedBody(resendOtpSchema, res);
    const { role } = validatedQuery(resendOtpSchema, res);

    if (role === "ADMIN" || role === "SUPER_ADMIN")
      throw new AppError(403, "FORBIDDEN", "Admin OTP login is not allowed");

    const delivery = await requestOtp(identifier, true);
    res.setHeader("Cache-Control", "no-store");
    res.status(202).json({
      success: true,
      message:
        delivery === "static"
          ? "OTP sent successfully. Use static OTP 123456."
          : "If the account is eligible, an OTP has been sent.",
    });
  });
  verifyLogin = asyncHandler(async (req, res) => {
    const { identifier, otp } = validatedBody(otpLoginSchema, res);
    const { role } = validatedQuery(otpLoginSchema, res);
    if (role === "ADMIN" || role === "SUPER_ADMIN")
      throw new AppError(403, "FORBIDDEN", "Admin OTP login is not allowed");
    await verifyOtp(identifier, otp);
    const result = await service.loginWithOTP(
      {
        [identifier.includes("@") ? "email" : "phone"]: identifier,
        roleType: role ?? "USER",
      },
      req.ip,
      req.headers["user-agent"],
    );
    await establishExpressSession(req, result);
    setSessionCookie(res, result.refreshToken);
    res.setHeader("Cache-Control", "no-store");
    res.json({ data: result });
  });
  verifyLoginCompatibility = asyncHandler(async (req, res) => {
    const {
      identifier: bodyIdentifier,
      phone,
      otp,
    } = validatedBody(compatibilityOtpLoginSchema, res);
    const identifier = bodyIdentifier ?? phone;
    if (!identifier)
      throw new AppError(400, "VALIDATION_ERROR", "Identifier is required");
    const { role } = validatedQuery(compatibilityOtpLoginSchema, res);
    if (role === "ADMIN" || role === "SUPER_ADMIN")
      throw new AppError(403, "FORBIDDEN", "Admin OTP login is not allowed");
    const normalizedIdentifier = normalizeIdentifier(identifier);
    const pending = pendingCustomOTPs.get(normalizedIdentifier);
    if (!pending || pending.expiresAt <= Date.now()) {
      pendingCustomOTPs.delete(normalizedIdentifier);
      throw new AppError(
        400,
        "OTP_NOT_FOUND",
        "OTP request expired or not found. Please request OTP again.",
      );
    }
    const { userId } = await verifyOtp(normalizedIdentifier, otp);
    if (userId) {
      const expectedRole =
        pending.role === "TECHNICIAN" ? "WORKER" : pending.role;
      const actualUser = await service.checkUserRole(userId);
      if (actualUser && actualUser !== expectedRole) {
        pendingCustomOTPs.delete(normalizedIdentifier);
        throw new AppError(
          400,
          "ROLE_MISMATCH",
          "This account is registered with a different role.",
        );
      }
    }
    pendingCustomOTPs.delete(normalizedIdentifier);
    const result = await service.loginWithOTP(
      {
        [normalizedIdentifier.includes("@") ? "email" : "phone"]:
          normalizedIdentifier,
        roleType: role ?? pending.role,
      },
      req.ip,
      req.headers["user-agent"],
    );
    await establishExpressSession(req, result);
    setSessionCookie(res, result.refreshToken);
    res.setHeader("Cache-Control", "no-store");
    const responseUser = Object.fromEntries(
      Object.entries(result.user).filter(
        ([key]) => key !== "roles" && key !== "permissions",
      ),
    );
    res.json({
      success: true,
      message: "Login successful",
      data: { ...result, user: responseUser },
    });
  });
  forgotPassword = asyncHandler(async (_req, res) => {
    const { identifier } = validatedBody(forgotPasswordSchema, res);
    await requestOtp(identifier);
    res.setHeader("Cache-Control", "no-store");
    res.status(202).json({ data: { accepted: true } });
  });
  deleteAccount = asyncHandler(async (req, res) => {
    const { password } = validatedBody(deleteAccountSchema, res);
    await service.deleteAccount(authenticatedContext(req).userId, password);
    await destroyExpressSession(req, res);
    res.status(200).json({
      success: true,
      message: "Account deleted successfully.",
    });
  });
  refresh = asyncHandler(async (req, res) => {
    const { refreshToken } = validatedBody(refreshSchema, res);
    const token = refreshToken ?? cookieToken(req);
    if (!token)
      throw new AppError(
        401,
        "INVALID_REFRESH_TOKEN",
        "Refresh token is required",
      );
    const result = await service.refresh(token);
    await establishExpressSession(req, result);
    setSessionCookie(res, result.refreshToken);
    res.setHeader("Cache-Control", "no-store");
    res.json({ data: result });
  });
  requestOtp = asyncHandler(async (_req, res) => {
    const { identifier } = validatedBody(otpRequestSchema, res);
    await requestOtp(identifier);
    res.setHeader("Cache-Control", "no-store");
    res.status(202).json({ data: { accepted: true } });
  });
  verifyOtp = asyncHandler(async (_req, res) => {
    const { identifier, code } = validatedBody(otpVerifySchema, res);
    const result = await verifyOtp(identifier, code);
    if (!result.userId)
      throw new AppError(
        400,
        "OTP_NOT_FOUND",
        "OTP is not linked to an existing account.",
      );
    res.setHeader("Cache-Control", "no-store");
    res.json({ data: result });
  });
  passwordReset = asyncHandler(async (req, res) => {
    const { identifier, code, newPassword } = validatedBody(
      passwordResetSchema,
      res,
    );
    await resetPassword(identifier, code, newPassword);
    await destroyExpressSession(req, res);
    res.setHeader("Cache-Control", "no-store");
    res.json({ data: { reset: true } });
  });
  me = asyncHandler(async (req, res) => {
    res.json({ data: await service.getUser(authenticatedContext(req).userId) });
  });
  sessions = asyncHandler(async (req, res) => {
    res.json({
      data: await service.listSessions(authenticatedContext(req).userId),
    });
  });
  revokeSession = asyncHandler(async (req, res) => {
    const { sessionId } = validatedParams(sessionIdParamsSchema, res);
    const revoked = await service.revokeSession(
      authenticatedContext(req).userId,
      sessionId,
    );
    if (!revoked) throw new AppError(404, "NOT_FOUND", "Session not found");
    if (sessionId === authenticatedContext(req).sessionId)
      await destroyExpressSession(req, res);
    res.status(204).end();
  });
  logout = asyncHandler(async (req, res) => {
    await service.revokeSession(
      authenticatedContext(req).userId,
      authenticatedContext(req).sessionId,
    );
    await destroyExpressSession(req, res);
    res.status(200).json({
      success: true,
      message: "Logged out successfully.",
    });
  });
  logoutAll = asyncHandler(async (req, res) => {
    const count = await service.revokeAll(authenticatedContext(req).userId);
    await destroyExpressSession(req, res);
    res.json({ data: { revokedSessions: count } });
  });
}

export const authController = new AuthController();
