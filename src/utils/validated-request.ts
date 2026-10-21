import type { Response } from "express";
import type { ZodType, output } from "zod";

type RequestParts = { body: unknown; params: unknown; query: unknown };
const validatedInputs = new WeakMap<Response, Map<ZodType, unknown>>();

export function rememberValidatedInput(
  res: Response,
  schema: ZodType,
  input: unknown,
): void {
  const bySchema = validatedInputs.get(res) ?? new Map<ZodType, unknown>();
  bySchema.set(schema, input);
  validatedInputs.set(res, bySchema);
}

function validatedResult<T extends ZodType<RequestParts>>(
  schema: T,
  res: Response,
): output<T> {
  const input = validatedInputs.get(res)?.get(schema);
  if (input === undefined)
    throw new Error("Validated request data is unavailable for this schema");
  return schema.parse(input);
}

export function validatedBody<T extends ZodType<RequestParts>>(
  schema: T,
  res: Response,
): output<T>["body"] {
  return validatedResult(schema, res).body;
}

export function validatedParams<T extends ZodType<RequestParts>>(
  schema: T,
  res: Response,
): output<T>["params"] {
  return validatedResult(schema, res).params;
}

export function validatedQuery<T extends ZodType<RequestParts>>(
  schema: T,
  res: Response,
): output<T>["query"] {
  return validatedResult(schema, res).query;
}
