CREATE TYPE "VendorKycStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED');
CREATE TYPE "VendorIdentityDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED');

CREATE TABLE "VendorKycApplication" (
  "id" UUID NOT NULL,
  "vendorUserId" UUID NOT NULL,
  "status" "VendorKycStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" UUID,
  "adminFeedback" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VendorKycApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VendorIdentityDocument" (
  "id" UUID NOT NULL,
  "kycApplicationId" UUID NOT NULL,
  "documentType" TEXT NOT NULL,
  "encryptedDocumentNumber" TEXT,
  "maskedDocumentNumber" TEXT,
  "nameOnDocument" TEXT,
  "frontStorageKey" TEXT,
  "frontMimeType" TEXT,
  "backStorageKey" TEXT,
  "backMimeType" TEXT,
  "status" "VendorIdentityDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "adminFeedback" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "resubmittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorIdentityDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VendorKycReviewLog" (
  "id" UUID NOT NULL,
  "applicationId" UUID NOT NULL,
  "documentId" UUID,
  "reviewerUserId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "previousStatus" TEXT,
  "newStatus" TEXT,
  "feedback" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorKycReviewLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorKycApplication_vendorUserId_key" ON "VendorKycApplication"("vendorUserId");
CREATE INDEX "VendorKycApplication_status_submittedAt_idx" ON "VendorKycApplication"("status", "submittedAt");
CREATE INDEX "VendorIdentityDocument_kycApplicationId_documentType_createdAt_idx" ON "VendorIdentityDocument"("kycApplicationId", "documentType", "createdAt");
CREATE INDEX "VendorIdentityDocument_status_uploadedAt_idx" ON "VendorIdentityDocument"("status", "uploadedAt");
CREATE INDEX "VendorKycReviewLog_applicationId_createdAt_idx" ON "VendorKycReviewLog"("applicationId", "createdAt");
CREATE INDEX "VendorKycReviewLog_documentId_createdAt_idx" ON "VendorKycReviewLog"("documentId", "createdAt");
CREATE INDEX "VendorKycReviewLog_reviewerUserId_createdAt_idx" ON "VendorKycReviewLog"("reviewerUserId", "createdAt");

ALTER TABLE "VendorKycApplication" ADD CONSTRAINT "VendorKycApplication_vendorUserId_fkey" FOREIGN KEY ("vendorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorKycApplication" ADD CONSTRAINT "VendorKycApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorIdentityDocument" ADD CONSTRAINT "VendorIdentityDocument_kycApplicationId_fkey" FOREIGN KEY ("kycApplicationId") REFERENCES "VendorKycApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorKycReviewLog" ADD CONSTRAINT "VendorKycReviewLog_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "VendorKycApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorKycReviewLog" ADD CONSTRAINT "VendorKycReviewLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "VendorIdentityDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorKycReviewLog" ADD CONSTRAINT "VendorKycReviewLog_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
