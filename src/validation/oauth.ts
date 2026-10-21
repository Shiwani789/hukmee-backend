import { z } from "zod";

export const oauthCallbackSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({ code: z.string().optional() }),
});
