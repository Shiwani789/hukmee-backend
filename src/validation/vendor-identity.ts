import { z } from "zod";

const empty = z.object({});
function request<B extends z.ZodType>(
  body: B,
): z.ZodObject<{
  body: B;
  params: typeof empty;
  query: typeof empty;
}>;
function request<B extends z.ZodType, P extends z.ZodType>(
  body: B,
  params: P,
): z.ZodObject<{ body: B; params: P; query: typeof empty }>;
function request<B extends z.ZodType, P extends z.ZodType, Q extends z.ZodType>(
  body: B,
  params: P,
  query: Q,
): z.ZodObject<{ body: B; params: P; query: Q }>;
function request(
  body: z.ZodType = empty,
  params: z.ZodType = empty,
  query: z.ZodType = empty,
) {
  return z.object({ body, params, query });
}

const typePattern = /^[A-Z][A-Z0-9_]{1,39}$/;
const reviewStatus = z.enum(["APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"]);

export const personalDetailsSchema = request(
  z.object({ fullName: z.string().trim().min(2).max(160) }),
);
export const addressDetailsSchema = request(
  z.object({
    line1: z.string().trim().min(3).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    postalCode: z.string().trim().min(3).max(20),
    countryCode: z.string().trim().length(2).toUpperCase(),
  }),
);
export const professionalDetailsSchema = request(
  z.object({
    experienceYears: z.number().int().min(0).max(60),
    services: z.array(z.string().uuid()).min(1).max(100),
    description: z.string().trim().max(2000).optional(),
  }),
);
export const bankDetailsSchema = request(
  z.object({
    accountHolderName: z.string().trim().min(2).max(160),
    accountNumber: z
      .string()
      .trim()
      .min(6)
      .max(34)
      .regex(/^[A-Za-z0-9]+$/),
    ifscCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
    bankName: z.string().trim().min(2).max(120),
    branchName: z.string().trim().max(120).optional(),
  }),
);
export const uploadIdentitySchema = request(
  z.object({
    documentType: z.string().trim().toUpperCase().regex(typePattern),
    documentNumber: z.string().trim().max(64).optional(),
    nameOnDocument: z.string().trim().min(1).max(160).optional(),
  }),
);
export const documentParamsSchema = request(
  empty,
  z.object({ documentId: z.uuid(), side: z.string() }),
);
export const applicationParamsSchema = request(
  empty,
  z.object({ applicationId: z.uuid() }),
);
export const adminListSchema = request(
  empty,
  empty,
  z.object({
    status: z
      .enum([
        "DRAFT",
        "PENDING_REVIEW",
        "APPROVED",
        "REJECTED",
        "RESUBMISSION_REQUIRED",
      ])
      .optional(),
    page: z.coerce.number().optional(),
    limit: z.coerce.number().optional(),
  }),
);
export const documentReviewSchema = request(
  z.object({
    status: reviewStatus,
    feedback: z.string().trim().max(2000).optional(),
  }),
  z.object({ documentId: z.uuid() }),
);
export const applicationReviewSchema = request(
  z.object({
    status: reviewStatus,
    feedback: z.string().trim().max(2000).optional(),
  }),
  z.object({ applicationId: z.uuid() }),
);
export const rejectApplicationSchema = request(
  z.object({ reason: z.string().trim().min(1).max(2000) }),
  z.object({ applicationId: z.uuid() }),
);
