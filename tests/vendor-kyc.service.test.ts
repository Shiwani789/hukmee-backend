import { AppError } from "../src/utils/errors";
import { VendorKycService } from "../src/modules/vendor-kyc/vendor-identity.service";

describe("vendor identity KYC policy and input validation", () => {
  const service = new VendorKycService();

  it("keeps Aadhaar and PAN optional until policy configuration requires them", () => {
    const policy = service.getDocumentPolicy();
    expect(policy.documents.AADHAAR).toMatchObject({
      enabled: true,
      required: false,
      numberRequired: false,
      frontRequired: false,
      backRequired: false,
    });
    expect(policy.documents.PAN).toMatchObject({
      enabled: true,
      required: false,
      numberRequired: false,
      frontRequired: false,
      backRequired: false,
    });
  });

  it.each([
    ["AADHAAR", "1234"],
    ["PAN", "ABCDE12345"],
  ])(
    "rejects an invalid %s number without echoing its value",
    async (type, number) => {
      await expect(
        service.uploadDocument(
          "00000000-0000-4000-8000-000000000000",
          { documentType: type, documentNumber: number },
          {},
        ),
      ).rejects.toMatchObject({
        code: "INVALID_DOCUMENT_NUMBER",
        message: expect.not.stringContaining(number),
      } satisfies Partial<AppError>);
    },
  );
});
