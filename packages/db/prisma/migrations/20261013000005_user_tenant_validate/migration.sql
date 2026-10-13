-- Tenant-scoped user identity, CONTRACT validation phase.
--
-- Runs after 20261013000004_user_tenant_enforce in its own transaction (Prisma
-- wraps each migration file). ...0004 attaches the composite unique, enforces
-- NOT NULL, and adds the normalization CHECK as NOT VALID, then stops so its
-- open transaction (drop + split + attach) stays short. This file finishes
-- the job with the two steps that are safe to run after the split:
--
--   * VALIDATE CONSTRAINT "User_email_normalized": takes SHARE UPDATE
--     EXCLUSIVE (reads/writes allowed) instead of the full-table validating
--     ADD lock. The re-normalization loop in ...0004 already removed padded
--     addresses, so validation scans but never rewrites.
--   * The "User_tenantId_immutable" trigger: ownership never moves after
--     creation (cross-organization users are split rows, never re-homed).
--     Created here — after the split has finished moving tenantId values —
--     so the trigger can never fire on the backfill or clone writes above.
--
-- Both statements are idempotent (VALIDATE on an already-valid constraint is
-- a no-op; DROP TRIGGER IF EXISTS precedes creation) and safe to retry.

SET LOCAL lock_timeout = '10s';

-- Contract-phase approval gate (same as ...0004): this file must never run
-- ahead of the approved contract deploy. No-op on userless databases.
-- If this gate rejects a migrate deploy, Prisma records a failed migration.
-- Before retrying with approval, run from packages/db:
--   pnpm exec prisma migrate resolve --rolled-back 20261013000005_user_tenant_validate
DO $$
DECLARE
  users INT;
  approved TEXT;
BEGIN
  SELECT count(*) INTO users FROM "User";
  approved := current_setting('app.tenant_contract_approved', true);
  IF users > 0 AND approved IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'user tenant contract: validation phase is not approved. Mark 20261013000005_user_tenant_validate rolled back with prisma migrate resolve --rolled-back, then re-run with options=-c app.tenant_contract_approved=yes in DATABASE_URL.';
  END IF;
END $$;

ALTER TABLE "User" VALIDATE CONSTRAINT "User_email_normalized";

-- Immutability enforcement: tenant ownership never moves after creation.
CREATE OR REPLACE FUNCTION _user_tenantId_immutable() RETURNS trigger AS $fn$
BEGIN
  IF OLD."tenantId" IS DISTINCT FROM NEW."tenantId" THEN
    RAISE EXCEPTION 'User.tenantId is immutable (user %: % -> %)', OLD.id, OLD."tenantId", NEW."tenantId";
  END IF;
  RETURN NEW;
END $fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "User_tenantId_immutable" ON "User";
CREATE TRIGGER "User_tenantId_immutable"
  BEFORE UPDATE OF "tenantId" ON "User"
  FOR EACH ROW EXECUTE FUNCTION _user_tenantId_immutable();
