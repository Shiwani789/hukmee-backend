import { Router } from "express";
import { env } from "../../config/env";
import { authenticate } from "../../middlewares/auth";
import {
  googleLogin,
  googleCallback,
  facebookLogin,
  facebookCallback,
} from "./oauth.controller";
import { authController } from "./auth.controller";
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
import { createRedisRateLimitStore } from "../../utils/redis-rate-limit-store";
import { validate } from "../../utils/validate";
import { oauthCallbackSchema } from "../../validation/oauth";

const router = Router();
export const authRateLimitConfig = {
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: "draft-8" as const,
  legacyHeaders: false,
  ...(env.NODE_ENV === "test"
    ? {}
    : {
        store: createRedisRateLimitStore("hukmee:rl:auth:"),
      }),
};

// ─── Registration ─────────────────────────────────────────────────────────────
// Step 1: POST /auth/register            body: { displayName|name, email|phone, password, role? }
// Step 2: POST /auth/verify-registration body: { identifier, otp }
router.post("/register", validate(registerSchema), authController.register);
router.post(
  "/verify-registration",
  validate(registrationVerifySchema),
  authController.verifyRegistration,
);

// ─── OTP Login (2-step, davee style) ─────────────────────────────────────────
// Step 1: POST /auth/login               body: { identifier }      → sends OTP
// Step 2: POST /auth/verify-login        body: { identifier, otp } → creates session
router.post("/login", validate(loginSchema), authController.login);
router.post(
  "/verify-login",
  validate(otpLoginSchema),
  authController.verifyLogin,
);

// ─── Password Login ───────────────────────────────────────────────────────────
router.post(
  "/password/login",
  validate(passwordLoginSchema),
  authController.passwordLogin,
);

// ─── Admin Login (password-based) ────────────────────────────────────────────
router.post(
  "/admin/login",
  validate(adminLoginSchema),
  authController.adminLogin,
);

// ─── OTP Send / Resend / Verify (short paths, mobile clients) ─────────────────
router.post(
  "/send-otp",
  validate(identifierOnlySchema),
  authController.sendOtp,
);
router.post("/resend-otp", validate(resendOtpSchema), authController.resendOtp);
router.post(
  "/verify-otp",
  validate(otpLoginSchema),
  authController.verifyLogin,
);

// ─── OTP Custom Paths (davee compatibility) ───────────────────────────────────
router.post(
  "/custom/send-otp",
  validate(compatibilityIdentifierSchema),
  authController.sendOtpCompatibility,
);
router.post(
  "/custom/resend-otp",
  validate(resendOtpSchema),
  authController.resendOtp,
);
router.post(
  "/custom/verify-otp",
  validate(compatibilityOtpLoginSchema),
  authController.verifyLoginCompatibility,
);

// ─── Token Refresh ────────────────────────────────────────────────────────────
router.post("/refresh", validate(refreshSchema), authController.refresh);

// ─── Generic OTP Request / Verify ────────────────────────────────────────────
router.post(
  "/otp/request",
  validate(otpRequestSchema),
  authController.requestOtp,
);
router.post("/otp/verify", validate(otpVerifySchema), authController.verifyOtp);

// ─── Password Reset ───────────────────────────────────────────────────────────
router.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  authController.forgotPassword,
);
router.post(
  "/password-reset",
  validate(passwordResetSchema),
  authController.passwordReset,
);
router.post(
  "/reset-password",
  validate(passwordResetSchema),
  authController.passwordReset,
);

// ─── Authenticated Routes ─────────────────────────────────────────────────────
router.get("/me", authenticate, authController.me);
router.get("/sessions", authenticate, authController.sessions);
router.delete(
  "/sessions/:sessionId",
  authenticate,
  validate(sessionIdParamsSchema),
  authController.revokeSession,
);
router.post("/logout", authenticate, authController.logout);
router.post("/logout-all", authenticate, authController.logoutAll);
router.post(
  "/delete-account",
  authenticate,
  validate(deleteAccountSchema),
  authController.deleteAccount,
);

// ─── OAuth (Google + Facebook, same as davee backend) ────────────────────────
router.get("/google", googleLogin);
router.get("/google/callback", validate(oauthCallbackSchema), googleCallback);
router.get("/facebook", facebookLogin);
router.get(
  "/facebook/callback",
  validate(oauthCallbackSchema),
  facebookCallback,
);

export default router;
