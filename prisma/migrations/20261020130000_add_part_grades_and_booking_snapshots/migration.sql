CREATE TABLE "PartGrade" (
    "id" UUID NOT NULL,
    "partId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2),
    "image" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartGrade_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Booking"
    ADD COLUMN "partGradeId" UUID,
    ADD COLUMN "partNameSnapshot" TEXT,
    ADD COLUMN "gradeNameSnapshot" TEXT,
    ADD COLUMN "gradePriceSnapshot" DECIMAL(12,2);

CREATE UNIQUE INDEX "PartGrade_partId_name_key" ON "PartGrade"("partId", "name");
CREATE INDEX "PartGrade_partId_active_idx" ON "PartGrade"("partId", "active");
CREATE INDEX "Booking_partGradeId_idx" ON "Booking"("partGradeId");

ALTER TABLE "PartGrade"
    ADD CONSTRAINT "PartGrade_partId_fkey"
    FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_partGradeId_fkey"
    FOREIGN KEY ("partGradeId") REFERENCES "PartGrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
