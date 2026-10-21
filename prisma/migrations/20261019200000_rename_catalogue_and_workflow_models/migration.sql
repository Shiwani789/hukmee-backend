-- Prisma model renames; PostgreSQL table renames preserve existing rows/FKs.
ALTER TABLE "DeviceBrand" RENAME TO "Brand";
ALTER TABLE "DeviceModel" RENAME TO "Model";
ALTER TABLE "RepairCategory" RENAME TO "Category";
ALTER TABLE "RepairBooking" RENAME TO "Booking";
ALTER TABLE "RepairInspection" RENAME TO "Inspection";
ALTER TABLE "RepairEvidence" RENAME TO "Evidence";
