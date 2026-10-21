import { z } from "zod";

export const hubIdSchema = z.object({
  body: z.object({}),
  params: z.object({ hubId: z.uuid() }),
  query: z.object({}),
});

export const hubMovementsSchema = z.object({
  body: z.object({}),
  params: z.object({ hubId: z.uuid() }),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.uuid().optional(),
  }),
});

export type HubMovementsQuery = z.infer<typeof hubMovementsSchema>["query"];
