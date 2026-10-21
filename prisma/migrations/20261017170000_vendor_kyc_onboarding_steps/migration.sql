ALTER TABLE "VendorKycApplication"
  ADD COLUMN "personalDetails" JSONB,
  ADD COLUMN "addressDetails" JSONB,
  ADD COLUMN "professionalDetails" JSONB,
  ADD COLUMN "encryptedBankDetails" TEXT;
