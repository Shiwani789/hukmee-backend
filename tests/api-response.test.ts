import { standardizeSuccessPayload } from "../src/utils/api-response";

describe("standard API success metadata", () => {
  it("adds success metadata while preserving data and status-independent fields", () => {
    expect(
      standardizeSuccessPayload(
        { data: { accepted: true }, trace: "kept" },
        "POST",
        "/auth/login",
      ),
    ).toEqual({
      data: { accepted: true },
      trace: "kept",
      success: true,
      message: "If the account is eligible, an OTP has been sent.",
    });
  });

  it("keeps explicit messages and does not rewrite error responses", () => {
    expect(
      standardizeSuccessPayload(
        { data: {}, success: true, message: "Custom operation completed." },
        "POST",
        "/auth/admin/login",
      ),
    ).toEqual({
      data: {},
      success: true,
      message: "Custom operation completed.",
    });
    const error = { error: { code: "NOT_FOUND", message: "Missing" } };
    expect(standardizeSuccessPayload(error, "GET", "/missing")).toBe(error);
    const unsuccessful = { success: false, message: "Rejected" };
    expect(standardizeSuccessPayload(unsuccessful, "POST", "/anything")).toBe(
      unsuccessful,
    );
  });

  it("uses operation-appropriate auth and catalogue messages", () => {
    expect(
      standardizeSuccessPayload({ data: {} }, "POST", "/auth/admin/login"),
    ).toMatchObject({
      success: true,
      message: "Login successful.",
    });
    expect(
      standardizeSuccessPayload({ data: {} }, "PATCH", "/catalog/brands/123"),
    ).toMatchObject({
      success: true,
      message: "Record updated successfully.",
    });
  });
});
