import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    BASE_URL: z.string().url().optional(),
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (value) =>
          value.startsWith("postgresql://") || value.startsWith("postgres://"),
        "must be a PostgreSQL URL",
      ),
    REDIS_URL: z
      .string()
      .default("redis://localhost:6379")
      .refine(
        (value) =>
          value.startsWith("redis://") || value.startsWith("rediss://"),
        "must be a Redis URL",
      ),
    REDIS_HOST: z.string().trim().min(1).optional(),
    REDIS_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    REDIS_PASSWORD: z.string().optional(),
    JWT_ACCESS_SECRET: z.string().min(32),
    SESSION_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z
      .string()
      .regex(/^\d+(ms|s|m|h|d|w|y)$/)
      .default("15m"),
    REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    CORS_ORIGINS: z.string().default("http://localhost:3000"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    CACHE_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_PROVIDER_URL: z.string().url().optional(),
    OTP_PROVIDER_TOKEN: z.string().min(1).optional(),
    OTP_CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().optional(),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().optional(),
    OTP_DEV_STATIC_CODE: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    KYC_DOCUMENT_ENCRYPTION_KEY: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
    VENDOR_KYC_DOCUMENT_POLICY: z.string().optional(),
    VENDOR_KYC_BANK_DETAILS_REQUIRED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    // OAuth
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_REDIRECT_URI: z.string().url().optional(),
    FACEBOOK_CLIENT_ID: z.string().optional(),
    FACEBOOK_CLIENT_SECRET: z.string().optional(),
    FACEBOOK_REDIRECT_URI: z.string().url().optional(),
    FRONTEND_URL: z.string().url().default("http://localhost:3001"),
  })
  .superRefine((value, context) => {
    const providerConfigured = Boolean(
      value.OTP_PROVIDER_URL || value.OTP_PROVIDER_TOKEN,
    );
    if (Boolean(value.OTP_PROVIDER_URL) !== Boolean(value.OTP_PROVIDER_TOKEN)) {
      context.addIssue({
        code: "custom",
        path: ["OTP_PROVIDER_URL"],
        message: "OTP provider URL and token must be set together",
      });
    }
    if (
      providerConfigured &&
      (!value.OTP_CHALLENGE_TTL_SECONDS || !value.OTP_MAX_ATTEMPTS)
    ) {
      context.addIssue({
        code: "custom",
        path: ["OTP_CHALLENGE_TTL_SECONDS"],
        message:
          "OTP TTL and attempt limit are required when an OTP provider is configured",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      value.OTP_PROVIDER_URL &&
      !value.OTP_PROVIDER_URL.startsWith("https://")
    ) {
      context.addIssue({
        code: "custom",
        path: ["OTP_PROVIDER_URL"],
        message: "OTP provider must use HTTPS in production",
      });
    }
    if (value.NODE_ENV === "production" && value.OTP_DEV_STATIC_CODE) {
      context.addIssue({
        code: "custom",
        path: ["OTP_DEV_STATIC_CODE"],
        message: "Static OTP is only allowed outside production",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(
    `Invalid environment configuration: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
  );
}
export const env = parsed.data;
