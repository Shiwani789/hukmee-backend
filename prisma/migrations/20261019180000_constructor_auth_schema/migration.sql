-- Align the auth role and permission layout with Constructo while preserving
-- the existing HUKMEE user, profile, and revocable hashed-session data.

CREATE TYPE "AccountStatus" AS ENUM (
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'BANNED',
  'PENDING'
);

-- Preserve the old join table long enough to backfill each user's primary role.
ALTER TABLE "UserRole" RENAME TO "_LegacyUserRole";

ALTER TYPE "RoleName" RENAME TO "UserRole";
ALTER TYPE "UserRole" RENAME VALUE 'TECHNICIAN' TO 'WORKER';

ALTER TABLE "Role"
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Permission"
  ADD COLUMN "action" TEXT,
  ADD COLUMN "resource" TEXT;

UPDATE "Permission"
SET
  "resource" = CASE
    WHEN POSITION(':' IN "key") > 0 THEN split_part("key", ':', 1)
    ELSE "key"
  END,
  "action" = CASE
    WHEN POSITION(':' IN "key") > 0 THEN split_part("key", ':', 2)
    ELSE 'manage'
  END;

ALTER TABLE "Permission"
  ALTER COLUMN "action" SET NOT NULL,
  ALTER COLUMN "resource" SET NOT NULL,
  ALTER COLUMN "description" DROP NOT NULL;
CREATE UNIQUE INDEX "Permission_action_resource_key" ON "Permission"("action", "resource");
DROP INDEX "Permission_key_key";
ALTER TABLE "Permission" DROP COLUMN "key";

ALTER TABLE "User" RENAME COLUMN "passwordHash" TO "password";
ALTER TABLE "User"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "profileImage" TEXT,
  ADD COLUMN "roleId" UUID,
  ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

UPDATE "User" AS account
SET
  "firstName" = profile."displayName",
  "profileImage" = profile."profileImage"
FROM "UserProfile" AS profile
WHERE profile."userId" = account."id";

UPDATE "User"
SET "status" = CASE WHEN "isActive" THEN 'ACTIVE'::"AccountStatus" ELSE 'INACTIVE'::"AccountStatus" END;

INSERT INTO "Role" ("id", "name")
VALUES (gen_random_uuid(), 'USER'::"UserRole")
ON CONFLICT ("name") DO NOTHING;

UPDATE "User" AS account
SET "roleId" = (
  SELECT assignment."roleId"
  FROM "_LegacyUserRole" AS assignment
  JOIN "Role" AS assigned_role ON assigned_role."id" = assignment."roleId"
  WHERE assignment."userId" = account."id"
  ORDER BY CASE assigned_role."name"
    WHEN 'SUPER_ADMIN' THEN 1
    WHEN 'ADMIN' THEN 2
    WHEN 'VENDOR' THEN 3
    WHEN 'WORKER' THEN 4
    WHEN 'DELIVERY_PARTNER' THEN 5
    WHEN 'USER' THEN 6
    ELSE 7
  END
  LIMIT 1
)
WHERE account."roleId" IS NULL;

UPDATE "User"
SET "roleId" = (SELECT "id" FROM "Role" WHERE "name" = 'USER'::"UserRole" LIMIT 1)
WHERE "roleId" IS NULL;

ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

ALTER TABLE "Session"
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "userAgent" TEXT;
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- Prisma's implicit many-to-many relation table for Permission[] on Role.
CREATE TABLE "_PermissionToRole" (
  "A" UUID NOT NULL,
  "B" UUID NOT NULL,
  CONSTRAINT "_PermissionToRole_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX "_PermissionToRole_B_index" ON "_PermissionToRole"("B");
INSERT INTO "_PermissionToRole" ("A", "B")
SELECT "permissionId", "roleId" FROM "RolePermission"
ON CONFLICT DO NOTHING;
ALTER TABLE "_PermissionToRole"
  ADD CONSTRAINT "_PermissionToRole_A_fkey" FOREIGN KEY ("A") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "_PermissionToRole_B_fkey" FOREIGN KEY ("B") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE "RolePermission";
DROP TABLE "_LegacyUserRole";
