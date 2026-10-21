import { z } from "zod";

export const updateNotificationPreferencesSchema = z.object({
  body: z.object({
    pushEnabled: z.boolean(),
    smsEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    promotionsEnabled: z.boolean(),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});
