-- Tenant lookup index for the new User.tenantId ownership column.
--
-- Plain (blocking) build, NOT concurrent: see 20261013000002 for why
-- CONCURRENTLY cannot run under `prisma migrate deploy`. Apply off-peak on
-- large tables. Large tables (no outage window): follow
-- packages/db/scripts/prebuild-user-tenant-indexes.sql — pre-build
-- CONCURRENTLY outside `migrate deploy`, then
-- `prisma migrate resolve --applied` this migration so deploy skips it.
-- When the index already exists, the statement below is a no-op and takes
-- no blocking lock. The index name matches Prisma's default for
-- @@index([tenantId]).
--
-- Enforced (not opt-in): the guard below aborts on large tables whose index
-- was not pre-built, instead of blocking writes for the build duration.
-- Small tables and pre-built indexes pass straight through.
DO $$
DECLARE
  est BIGINT;
  prebuilt BOOLEAN;
  index_valid BOOLEAN;
BEGIN
  SELECT reltuples::BIGINT INTO est FROM pg_class WHERE oid = '"User"'::regclass;
  SELECT i.indisvalid INTO index_valid
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = '"User"'::regclass
    AND c.relnamespace = current_schema()::regnamespace
    AND c.relname = 'User_tenantId_idx';
  prebuilt := index_valid IS NOT NULL;
  IF prebuilt AND NOT index_valid THEN
    RAISE EXCEPTION 'Tenant index User_tenantId_idx is not valid. Run packages/db/scripts/prebuild-user-tenant-indexes.sql to repair it before retrying; do not mark this migration applied.';
  END IF;
  IF NOT prebuilt AND est > 100000 THEN
    RAISE EXCEPTION 'user tenant index: "User" holds an estimated % rows. Pre-build CONCURRENTLY first (packages/db/scripts/prebuild-user-tenant-indexes.sql), then `prisma migrate resolve --applied "20261013000003_user_tenant_lookup_index"`. The 100000-row heuristic is deliberately conservative; small tables build inline in seconds.', est;
  END IF;
END $$;
SET LOCAL lock_timeout = '10s';
CREATE INDEX IF NOT EXISTS "User_tenantId_idx"
  ON "User"("tenantId");
