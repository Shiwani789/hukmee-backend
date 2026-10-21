ALTER TABLE "DeviceBrand"
ADD COLUMN "imageUrl" TEXT;

ALTER TABLE "DeviceModel"
ADD COLUMN "imageUrl" TEXT;

ALTER TABLE "RepairService"
ADD COLUMN "imageUrl" TEXT;

ALTER TABLE "Part"
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "sellingPrice" DECIMAL(12, 2);
