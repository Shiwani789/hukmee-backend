CREATE TYPE "AddressType" AS ENUM ('HOME', 'WORK', 'OTHER');

ALTER TABLE "Address"
  ADD COLUMN "recipientName" TEXT,
  ADD COLUMN "phone" VARCHAR(24),
  ADD COLUMN "type" "AddressType" NOT NULL DEFAULT 'HOME',
  ADD COLUMN "country" TEXT,
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Address"
SET "country" = "countryCode";

ALTER TABLE "Address"
  ALTER COLUMN "countryCode" DROP NOT NULL;

CREATE UNIQUE INDEX "Address_one_default_per_user_idx"
  ON "Address"("userId")
  WHERE "isDefault" = true;
