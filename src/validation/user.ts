import { z } from "zod";

export const updateUserProfileSchema = z.object({
  body: z
    .object({
      firstName: z.string().trim().min(1).max(80).optional(),
      lastName: z.string().trim().min(1).max(80).optional(),
      displayName: z.string().trim().min(1).max(120).optional(),
      email: z
        .string()
        .email()
        .transform((value) => value.trim())
        .optional(),
      phone: z.string().trim().min(7).max(24).optional(),
      profileImage: z.string().optional(),
    })
    .refine(
      (value) => Object.keys(value).length > 0,
      "Provide at least one profile field to update",
    ),
  params: z.object({}),
  query: z.object({}),
});
export type UpdateUserProfileInput = z.infer<
  typeof updateUserProfileSchema
>["body"];
