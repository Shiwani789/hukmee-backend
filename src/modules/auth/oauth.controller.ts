import type { Request, Response } from "express";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/async-handler";
import {
  findOrCreateGoogleUser,
  findOrCreateFacebookUser,
  createOAuthSession,
} from "./oauth.service";
import { AppError } from "../../utils/errors";
import { errorResponse } from "../../utils/error-response";
import { validatedQuery } from "../../utils/validated-request";
import { oauthCallbackSchema } from "../../validation/oauth";

// ─── Helpers ────────────────────────────────────────────────────────────────

const getSessionCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: (env.NODE_ENV === "production" ? "none" : "lax") as "none" | "lax",
  path: "/",
  maxAge: env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
});

export class OAuthController {
// ─── Google OAuth ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/auth/google
 * Redirect user to Google OAuth login page.
 * Same as davee backend googleLogin.
 */
googleLogin = asyncHandler(async (
  _req: Request,
  res: Response,
) => {
  try {
    const clientId = env.GOOGLE_CLIENT_ID;
    const redirectUri = env.GOOGLE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return errorResponse(
        res,
        503,
        "OAUTH_NOT_CONFIGURED",
        "Google OAuth is not configured",
      );
    }

    const scope = encodeURIComponent("openid profile email");
    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${scope}`;

    return res.redirect(authUrl);
  } catch {
    return errorResponse(
      res,
      500,
      "INTERNAL_ERROR",
      "Something went wrong. Please try again later.",
    );
  }
});

/**
 * GET /api/v1/auth/google/callback
 * Google redirects here after user authentication.
 * Same as davee backend googleCallback.
 */
googleCallback = asyncHandler(async (
  req: Request,
  res: Response,
) => {
  const frontendUrl = env.FRONTEND_URL;
  try {
    const { code } = validatedQuery(oauthCallbackSchema, res);
    if (!code) {
      throw new AppError(
        400,
        "OAUTH_NO_CODE",
        "Authorization code not provided",
      );
    }

    // Exchange code for token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!tokenRes.ok)
      throw new AppError(
        400,
        "OAUTH_TOKEN_EXCHANGE_FAILED",
        "Failed to exchange Google code",
      );
    const tokenData = (await tokenRes.json()) as { access_token: string };

    // Get user profile
    const profileRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    );

    if (!profileRes.ok)
      throw new AppError(
        400,
        "OAUTH_PROFILE_FAILED",
        "Failed to fetch Google profile",
      );
    const profile = (await profileRes.json()) as {
      id: string;
      name: string;
      email: string;
      picture: string;
    };

    const { userId } = await findOrCreateGoogleUser({
      id: profile.id,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
    });

    const { sessionToken } = await createOAuthSession(userId);

    res.cookie("session_token", sessionToken, getSessionCookieOptions());

    return res.redirect(`${frontendUrl}/auth/success`);
  } catch (error: unknown) {
    return res.redirect(
      `${frontendUrl}?error=${encodeURIComponent(safeOAuthError(error))}`,
    );
  }
});

// ─── Facebook OAuth ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/auth/facebook
 * Redirect user to Facebook OAuth login page.
 * Same as davee backend facebookLogin.
 */
facebookLogin = asyncHandler(async (
  _req: Request,
  res: Response,
) => {
  try {
    const clientId = env.FACEBOOK_CLIENT_ID;
    const redirectUri = env.FACEBOOK_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return errorResponse(
        res,
        503,
        "OAUTH_NOT_CONFIGURED",
        "Facebook OAuth is not configured",
      );
    }

    const scope = encodeURIComponent("email,public_profile");
    const authUrl =
      `https://www.facebook.com/v13.0/dialog/oauth` +
      `?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${scope}`;

    return res.redirect(authUrl);
  } catch {
    return errorResponse(
      res,
      500,
      "INTERNAL_ERROR",
      "Something went wrong. Please try again later.",
    );
  }
});

/**
 * GET /api/v1/auth/facebook/callback
 * Facebook redirects here after user authentication.
 * Same as davee backend facebookCallback.
 */
facebookCallback = asyncHandler(async (
  req: Request,
  res: Response,
) => {
  const frontendUrl = env.FRONTEND_URL;
  try {
    const { code } = validatedQuery(oauthCallbackSchema, res);
    if (!code)
      throw new AppError(
        400,
        "OAUTH_NO_CODE",
        "Authorization code not provided",
      );

    // Exchange code for token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v13.0/oauth/access_token` +
        `?client_id=${env.FACEBOOK_CLIENT_ID}` +
        `&redirect_uri=${env.FACEBOOK_REDIRECT_URI}` +
        `&client_secret=${env.FACEBOOK_CLIENT_SECRET}` +
        `&code=${code}`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (!tokenRes.ok)
      throw new AppError(
        400,
        "OAUTH_TOKEN_EXCHANGE_FAILED",
        "Failed to exchange Facebook code",
      );
    const tokenData = (await tokenRes.json()) as { access_token: string };

    // Get user profile
    const profileRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${tokenData.access_token}`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (!profileRes.ok)
      throw new AppError(
        400,
        "OAUTH_PROFILE_FAILED",
        "Failed to fetch Facebook profile",
      );
    const profile = (await profileRes.json()) as {
      id: string;
      name: string;
      email?: string;
      picture?: { data?: { url?: string } };
    };

    const { userId } = await findOrCreateFacebookUser({
      id: profile.id,
      email: profile.email || `${profile.id}@facebook.com`,
      name: profile.name,
      picture: profile.picture?.data?.url ?? null,
    });

    const { sessionToken } = await createOAuthSession(userId);
    res.cookie("session_token", sessionToken, getSessionCookieOptions());

    return res.redirect(`${frontendUrl}/auth/success`);
  } catch (error: unknown) {
    return res.redirect(
      `${frontendUrl}?error=${encodeURIComponent(safeOAuthError(error))}`,
    );
  }
});

}

export const oauthController = new OAuthController();
export const googleLogin = oauthController.googleLogin;
export const googleCallback = oauthController.googleCallback;
export const facebookLogin = oauthController.facebookLogin;
export const facebookCallback = oauthController.facebookCallback;

function safeOAuthError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return "Sign-in could not be completed. Please try again.";
}
