-- Add ownership separately so ACCESS EXCLUSIVE ends before the backfill.
-- No FK: first login can create a user before its organization row exists.
BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
COMMIT;
