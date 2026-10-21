import { z } from "zod";

export const technicianRouteParamsSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({}),
});
