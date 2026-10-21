import {
  addressDetailsSchema,
  adminListSchema,
  uploadIdentitySchema,
} from "../src/validation/vendor-identity";

const parts = (body: unknown = {}, params: unknown = {}, query: unknown = {}) =>
  ({ body, params, query }) as const;

describe("vendor KYC request validation", () => {
  it("normalizes address country codes", () => {
    const result = addressDetailsSchema.parse(
      parts({
        line1: "123 Main Street",
        city: "Delhi",
        state: "Delhi",
        postalCode: "110001",
        countryCode: "in",
      }),
    );
    expect(result.body.countryCode).toBe("IN");
  });

  it("parses admin pagination while leaving established clamping to the service", () => {
    const result = adminListSchema.parse(
      parts({}, {}, { page: "0", limit: "200" }),
    );
    expect(result.query).toEqual({ page: 0, limit: 200 });
  });

  it("normalizes document type and rejects malformed values", () => {
    expect(
      uploadIdentitySchema.parse(parts({ documentType: "passport" })).body
        .documentType,
    ).toBe("PASSPORT");
    expect(
      uploadIdentitySchema.safeParse(parts({ documentType: "bad type" }))
        .success,
    ).toBe(false);
  });
});
