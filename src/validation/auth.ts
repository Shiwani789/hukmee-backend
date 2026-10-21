import { z } from "zod";

const password = z.string().min(12).max(128);
const identifier = z
  .string()
  .trim()
  .min(7)
  .max(254)
  .refine(
    (value) =>
      z.email().safeParse(value).success || /^\+?[0-9]{7,24}$/.test(value),
    "Provide a valid email address or phone number",
  );
const code = z.string().regex(/^\d{6}$/);

export const registerSchema = z.object({
  body: z
    .object({
      // Support both 'displayName' (hukmee native) and 'name' (davee compat)
      displayName: z.string().trim().min(1).max(120).optional(),
      name: z.string().trim().min(1).max(120).optional(),
      email: z.email().toLowerCase().optional(),
      phone: z.string().trim().min(7).max(24).optional(),
      password,
      role: z
        .enum(["USER", "WORKER", "TECHNICIAN", "VENDOR", "DELIVERY_PARTNER"])
        .optional(),
    })
    .refine((data) => data.displayName || data.name, {
      message: "displayName or name is required",
    })
    .refine((data) => data.email || data.phone, {
      message: "Provide an email address or phone number",
    }),
  params: z.object({}),
  query: z.object({}),
});

export const loginSchema = z.object({
  body: z.object({ identifier }),
  params: z.object({}),
  query: z.object({}),
});

export const passwordLoginSchema = z.object({
  body: z.object({ identifier, password: z.string().min(1).max(128) }),
  params: z.object({}),
  query: z.object({}),
});

export const adminLoginSchema = z.object({
  body: z.object({
    email: z.email().toLowerCase(),
    password: z.string().min(1).max(128),
  }),
  params: z.object({}),
  query: z.object({}),
});

export const identifierOnlySchema = z.object({
  body: z.object({ identifier }),
  params: z.object({}),
  query: z.object({
    role: z
      .enum([
        "USER",
        "WORKER",
        "TECHNICIAN",
        "VENDOR",
        "DELIVERY_PARTNER",
        "ADMIN",
        "SUPER_ADMIN",
      ])
      .optional(),
  }),
});

export const compatibilityIdentifierSchema = z.object({
  body: z
    .object({
      identifier: identifier.optional(),
      phone: identifier.optional(),
    })
    .refine((data) => data.identifier || data.phone, {
      message: "identifier (email or phone) is required",
    }),
  params: z.object({}),
  query: z.object({
    role: z
      .enum([
        "USER",
        "WORKER",
        "TECHNICIAN",
        "VENDOR",
        "DELIVERY_PARTNER",
        "ADMIN",
        "SUPER_ADMIN",
      ])
      .optional(),
  }),
});

export const resendOtpSchema = z.object({
  body: z.object({
    identifier,
  }),
  params: z.object({}),
  query: z.object({
    role: z
      .enum([
        "USER",
        "WORKER",
        "TECHNICIAN",
        "VENDOR",
        "DELIVERY_PARTNER",
        "ADMIN",
        "SUPER_ADMIN",
      ])
      .optional(),
  }),
});

export const otpLoginSchema = z.object({
  body: z.object({ identifier, otp: code }),
  params: z.object({}),
  query: z.object({
    role: z
      .enum([
        "USER",
        "WORKER",
        "TECHNICIAN",
        "VENDOR",
        "DELIVERY_PARTNER",
        "ADMIN",
        "SUPER_ADMIN",
      ])
      .optional(),
  }),
});

export const compatibilityOtpLoginSchema = z.object({
  body: z
    .object({
      identifier: identifier.optional(),
      phone: identifier.optional(),
      otp: code,
    })
    .refine((data) => data.identifier || data.phone, {
      message: "identifier and otp are required",
    }),
  params: z.object({}),
  query: z.object({
    role: z
      .enum([
        "USER",
        "WORKER",
        "TECHNICIAN",
        "VENDOR",
        "DELIVERY_PARTNER",
        "ADMIN",
        "SUPER_ADMIN",
      ])
      .optional(),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({ identifier }),
  params: z.object({}),
  query: z.object({}),
});

export const deleteAccountSchema = z.object({
  body: z.object({ password: z.string().min(1).max(128) }),
  params: z.object({}),
  query: z.object({}),
});

export const refreshSchema = z.object({
  body: z.object({ refreshToken: z.string().min(40).max(256).optional() }),
  params: z.object({}),
  query: z.object({}),
});

export const otpRequestSchema = z.object({
  body: z.object({
    identifier,
  }),
  params: z.object({}),
  query: z.object({}),
});

export const otpVerifySchema = z.object({
  body: z.object({
    identifier,
    code,
  }),
  params: z.object({}),
  query: z.object({}),
});

export const passwordResetSchema = z.object({
  body: z.object({ identifier, code, newPassword: password }),
  params: z.object({}),
  query: z.object({}),
});

export const registrationVerifySchema = z.object({
  body: z.object({ identifier, otp: code }),
  params: z.object({}),
  query: z.object({}),
});

export const sessionIdParamsSchema = z.object({
  body: z.object({}),
  params: z.object({ sessionId: z.uuid() }),
  query: z.object({}),
});

export type RegisterInput = z.infer<typeof registerSchema>["body"];
export type ResendOtpInput = z.infer<typeof resendOtpSchema>["body"];
