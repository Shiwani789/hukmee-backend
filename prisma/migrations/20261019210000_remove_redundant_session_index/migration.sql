-- The composite index already supports userId-only lookups via its leftmost column.
DROP INDEX IF EXISTS "Session_userId_idx";
