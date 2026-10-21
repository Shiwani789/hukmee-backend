import {
  compatibilityIdentifierSchema,
  compatibilityOtpLoginSchema,
} from "../src/validation/auth";

describe("custom send OTP request validation", () => {
  it("accepts a phone number in the compatibility body format", () => {
    const result = compatibilityIdentifierSchema.safeParse({
      body: { identifier: "9876543210" },
      params: {},
      query: {},
    });

    expect(result.success).toBe(true);
  });

  it("rejects a missing identifier with a validation issue", () => {
    const result = compatibilityIdentifierSchema.safeParse({
      body: {},
      params: {},
      query: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/identifier/i);
    }
  });

  it("rejects a malformed phone number", () => {
    const result = compatibilityIdentifierSchema.safeParse({
      body: { identifier: "not-a-phone" },
      params: {},
      query: {},
    });

    expect(result.success).toBe(false);
  });

  it("accepts the compatibility OTP verification body", () => {
    const result = compatibilityOtpLoginSchema.safeParse({
      body: { identifier: "9876543210", otp: "123456" },
      params: {},
      query: {},
    });

    expect(result.success).toBe(true);
  });

  it("rejects a missing OTP instead of passing an undefined body to the controller", () => {
    const result = compatibilityOtpLoginSchema.safeParse({
      body: { identifier: "9876543210" },
      params: {},
      query: {},
    });

    expect(result.success).toBe(false);
  });
});
