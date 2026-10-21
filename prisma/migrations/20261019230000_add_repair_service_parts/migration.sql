-- A part can be reused by multiple repair services. The explicit join table
-- keeps the relationship independently queryable without duplicating prices.
CREATE TABLE "RepairServicePart" (
  "serviceId" UUID NOT NULL,
  "partId" UUID NOT NULL,
  CONSTRAINT "RepairServicePart_pkey" PRIMARY KEY ("serviceId", "partId")
);

CREATE INDEX "RepairServicePart_partId_idx" ON "RepairServicePart"("partId");

ALTER TABLE "RepairServicePart"
  ADD CONSTRAINT "RepairServicePart_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "RepairService"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RepairServicePart_partId_fkey"
    FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
