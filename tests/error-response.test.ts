import type { Response } from "express";
import { errorResponse } from "../src/utils/error-response";

function responseWithRequestId(requestId?: string) {
  const result: { status?: number; body?: unknown } = {};
  const response = {
    locals: { requestId },
    status(status: number) {
      result.status = status;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return body;
    },
  } as unknown as Response;
  return { response, result };
}

describe("standard error response compatibility", () => {
  it("returns standard fields and legacy aliases with validation details", () => {
    const { response, result } = responseWithRequestId("req-123");
    const errors = [{ field: "body.name", message: "Required" }];

    errorResponse(response, 400, "VALIDATION_ERROR", "Invalid input", errors);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      success: false,
      message: "Invalid input",
      code: "VALIDATION_ERROR",
      errors,
      requestId: "req-123",
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        details: errors,
        requestId: "req-123",
      },
    });
  });

  it("omits optional details when they are not applicable", () => {
    const { response, result } = responseWithRequestId();

    errorResponse(response, 429, "RATE_LIMITED", "Try again later");

    expect(result.body).toEqual({
      success: false,
      message: "Try again later",
      code: "RATE_LIMITED",
      error: { code: "RATE_LIMITED", message: "Try again later" },
    });
  });
});
