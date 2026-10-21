-- AlterTable
ALTER TABLE "RepairBooking" ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- RenameIndex
ALTER INDEX "VendorIdentityDocument_kycApplicationId_documentType_createdAt_" RENAME TO "VendorIdentityDocument_kycApplicationId_documentType_create_idx";
