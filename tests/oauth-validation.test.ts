import { oauthCallbackSchema } from "../src/validation/oauth";

describe("OAuth callback query validation", () => {
  it("accepts provider authorization codes", () => {
    expect(
      oauthCallbackSchema.safeParse({
        body: {},
        params: {},
        query: { code: "provider-code" },
      }).success,
    ).toBe(true);
  });

  it("accepts callbacks without a code so the existing redirect error flow handles them", () => {
    expect(
      oauthCallbackSchema.safeParse({ body: {}, params: {}, query: {} })
        .success,
    ).toBe(true);
  });

  it("rejects repeated query parameters instead of passing arrays to providers", () => {
    expect(
      oauthCallbackSchema.safeParse({
        body: {},
        params: {},
        query: { code: ["first", "second"] },
      }).success,
    ).toBe(false);
  });
});
