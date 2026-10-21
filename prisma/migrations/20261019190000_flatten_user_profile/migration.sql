-- Move profile and owned-record relations directly onto User.
ALTER TABLE "User" ADD COLUMN "displayName" TEXT;

UPDATE "User" AS account
SET "displayName" = profile."displayName"
FROM "UserProfile" AS profile
WHERE profile."userId" = account."id";

ALTER TABLE "Address" ADD COLUMN "userId" UUID;
UPDATE "Address" AS address
SET "userId" = profile."userId"
FROM "UserProfile" AS profile
WHERE address."userProfileId" = profile."id";
ALTER TABLE "Address" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Address_userId_idx" ON "Address"("userId");

ALTER TABLE "UserDevice" ADD COLUMN "userId" UUID;
UPDATE "UserDevice" AS device
SET "userId" = profile."userId"
FROM "UserProfile" AS profile
WHERE device."userProfileId" = profile."id";
ALTER TABLE "UserDevice" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "UserDevice_userId_idx" ON "UserDevice"("userId");

ALTER TABLE "Address" DROP CONSTRAINT "Address_userProfileId_fkey";
DROP INDEX "Address_userProfileId_idx";
ALTER TABLE "Address" DROP COLUMN "userProfileId";

ALTER TABLE "UserDevice" DROP CONSTRAINT "UserDevice_userProfileId_fkey";
DROP INDEX "UserDevice_userProfileId_idx";
ALTER TABLE "UserDevice" DROP COLUMN "userProfileId";

DROP TABLE "UserProfile";
