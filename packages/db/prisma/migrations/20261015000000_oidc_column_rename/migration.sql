-- Generic OIDC rename (readiness §5 step 3): gideonSub → oidcSub,
-- gideonTenantId → oidcTenantId, gideonRefreshToken → oidcRefreshToken.
-- Pure renames: stored values are already opaque IdP subjects, so no
-- backfill or data change is involved. Historical migrations keep the old
-- names; only the live columns move.
--
-- Contract: apply only after old nodes are drained. RENAME breaks old code
-- instantly in both directions (old code reads gideonSub, new code reads
-- oidcSub) — a rolling deploy with mixed nodes fails its first user write.
-- Ship with a full stop, migrate, then restart. Take a backup first; the
-- rename is forward-only.
-- Explicit transaction control makes the renames atomic regardless of
-- whether Prisma splits the script into individual statements.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- Contract-phase approval gate (enforced, not documentary): a single
-- `prisma migrate deploy` would otherwise apply this file while old nodes
-- still run — every surviving old node then crashes on its first user
-- write. Abort unless the operator approved the phase, except on databases
-- with no users (fresh dev, CI, and preview databases apply untouched).
-- Approve by adding `options=-c app.oidc_rename_approved=yes` to
-- DATABASE_URL for the rename deploy only (URL-encode the flag as usual).
-- If this gate rejects a migrate deploy, Prisma records a failed migration.
-- Before retrying with approval, run from packages/db:
--   pnpm exec prisma migrate resolve --rolled-back 20261015000000_oidc_column_rename
DO $$
DECLARE
  users INT;
  approved TEXT;
BEGIN
  SELECT count(*) INTO users FROM "User";
  approved := current_setting('app.oidc_rename_approved', true);
  IF users > 0 AND approved IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'oidc rename: % user(s) present but the rename phase is not approved. Drain old nodes first, then mark 20261015000000_oidc_column_rename rolled back with prisma migrate resolve --rolled-back before re-running with options=-c app.oidc_rename_approved=yes in DATABASE_URL.', users;
  END IF;
END $$;

-- Idempotent renames: only move a column when the old name exists and the
-- new name does not (safe retry after a partial manual fix; no-op on
-- re-run after success).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'gideonSub'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'oidcSub'
  ) THEN
    ALTER TABLE "User" RENAME COLUMN "gideonSub" TO "oidcSub";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'gideonTenantId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'oidcTenantId'
  ) THEN
    ALTER TABLE "User" RENAME COLUMN "gideonTenantId" TO "oidcTenantId";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Session' AND column_name = 'gideonRefreshToken'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Session' AND column_name = 'oidcRefreshToken'
  ) THEN
    ALTER TABLE "Session" RENAME COLUMN "gideonRefreshToken" TO "oidcRefreshToken";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'User_gideonSub_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'User_oidcSub_key'
  ) THEN
    ALTER INDEX "User_gideonSub_key" RENAME TO "User_oidcSub_key";
  END IF;
END $$;

COMMIT;
