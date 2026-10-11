-- Phase 3 (remove-cross-tenant-roles, HOLD — DO NOT MOVE INTO prisma/migrations/
-- until Release B acceptance passes): drop legacy platform-role storage.
-- Validated 2026-10-11 against a clone of the migrated+seeded dev database
-- (applied cleanly; columns/table verified gone; clone dropped afterwards).
-- Promotion: copy this directory to prisma/migrations/<timestamp>_drop_platform_role_storage/
-- and run `prisma migrate deploy` in staging first.
-- NOTE: IntegrationPlatformCredential is NOT dropped here — the
-- integration-platform repository still reads/writes it. Drop that table
-- only once the credential store is retired.
-- Revoke surviving impersonation sessions BEFORE dropping the marker
-- column. Nothing reads impersonatedBy anymore, so these rows authenticate
-- as their victims with no audit marker. The API also deletes them once at
-- boot (NativeSessionService.onModuleInit); this covers promotion paths
-- that drop the column without a prior app boot.
DELETE FROM "Session" WHERE "impersonatedBy" IS NOT NULL;
ALTER TABLE "Organization" DROP COLUMN "isInternal";
ALTER TABLE "Session" DROP COLUMN "impersonatedBy";
ALTER TABLE "User" DROP COLUMN "isPlatformAdmin", DROP COLUMN "role";
