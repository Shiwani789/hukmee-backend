-- Keep existing catalogue data while allowing parts without a name or SKU.
ALTER TABLE "Part"
  ALTER COLUMN "sku" DROP NOT NULL,
  ALTER COLUMN "name" DROP NOT NULL;
