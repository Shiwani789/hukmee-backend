-- This migration depends on the auth and table-rename migrations that precede it.
-- Rename the implicit relation table in place so existing role permissions survive.

-- Drop and recreate the foreign keys with the generated Prisma constraint names.
ALTER TABLE "_PermissionToRole" DROP CONSTRAINT "_PermissionToRole_A_fkey";
ALTER TABLE "_PermissionToRole" DROP CONSTRAINT "_PermissionToRole_B_fkey";
ALTER TABLE "_PermissionToRole" RENAME CONSTRAINT "_PermissionToRole_AB_pkey" TO "_RolePermissions_AB_pkey";
ALTER TABLE "_PermissionToRole" RENAME TO "_RolePermissions";
ALTER INDEX "_PermissionToRole_B_index" RENAME TO "_RolePermissions_B_index";

ALTER TABLE "_RolePermissions"
  ADD CONSTRAINT "_RolePermissions_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "_RolePermissions_B_fkey"
    FOREIGN KEY ("B") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "User_roleId_idx";

ALTER TABLE "Booking" RENAME CONSTRAINT "RepairBooking_pkey" TO "Booking_pkey";
ALTER TABLE "Brand" RENAME CONSTRAINT "DeviceBrand_pkey" TO "Brand_pkey";
ALTER TABLE "Category" RENAME CONSTRAINT "RepairCategory_pkey" TO "Category_pkey";
ALTER TABLE "Evidence" RENAME CONSTRAINT "RepairEvidence_pkey" TO "Evidence_pkey";
ALTER TABLE "Inspection" RENAME CONSTRAINT "RepairInspection_pkey" TO "Inspection_pkey";
ALTER TABLE "Model" RENAME CONSTRAINT "DeviceModel_pkey" TO "Model_pkey";

ALTER TABLE "Role" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Booking" RENAME CONSTRAINT "RepairBooking_addressId_fkey" TO "Booking_addressId_fkey";
ALTER TABLE "Booking" RENAME CONSTRAINT "RepairBooking_deviceId_fkey" TO "Booking_deviceId_fkey";
ALTER TABLE "Booking" RENAME CONSTRAINT "RepairBooking_serviceId_fkey" TO "Booking_serviceId_fkey";
ALTER TABLE "Booking" RENAME CONSTRAINT "RepairBooking_userId_fkey" TO "Booking_userId_fkey";
ALTER TABLE "Evidence" RENAME CONSTRAINT "RepairEvidence_inspectionId_fkey" TO "Evidence_inspectionId_fkey";
ALTER TABLE "Inspection" RENAME CONSTRAINT "RepairInspection_bookingId_fkey" TO "Inspection_bookingId_fkey";
ALTER TABLE "Model" RENAME CONSTRAINT "DeviceModel_brandId_fkey" TO "Model_brandId_fkey";

ALTER INDEX "RepairBooking_reference_key" RENAME TO "Booking_reference_key";
ALTER INDEX "RepairBooking_status_createdAt_idx" RENAME TO "Booking_status_createdAt_idx";
ALTER INDEX "RepairBooking_userId_createdAt_idx" RENAME TO "Booking_userId_createdAt_idx";
ALTER INDEX "DeviceBrand_name_key" RENAME TO "Brand_name_key";
ALTER INDEX "RepairCategory_name_key" RENAME TO "Category_name_key";
ALTER INDEX "RepairEvidence_inspectionId_idx" RENAME TO "Evidence_inspectionId_idx";
ALTER INDEX "RepairInspection_bookingId_key" RENAME TO "Inspection_bookingId_key";
ALTER INDEX "DeviceModel_brandId_active_idx" RENAME TO "Model_brandId_active_idx";
ALTER INDEX "DeviceModel_brandId_name_key" RENAME TO "Model_brandId_name_key";
