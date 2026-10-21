import { z } from "zod";

export const createDeviceSchema = z.object({
  body: z.object({
    modelId: z.uuid(),
    nickname: z.string().trim().min(1).max(80).optional(),
    serialNumber: z.string().trim().min(1).max(100).optional(),
  }),
  params: z.object({}),
  query: z.object({}),
});

export const deviceIdSchema = z.object({
  body: z.object({}),
  params: z.object({ deviceId: z.uuid() }),
  query: z.object({}),
});

export type CreateDeviceInput = z.infer<typeof createDeviceSchema>["body"];
