-- Pre-build the tenant-scoped User indexes CONCURRENTLY (no outage window).
--
-- When: on large User tables, run this AFTER the expand-phase migrations
-- have added the column (20261013000001_user_tenant_ownership) and BEFORE
-- the deploy that introduces 20261013000002/03. On small tables skip this
-- entirely — the migration files build the same indexes inline in seconds.
-- Valid indexes are retained; invalid indexes from failed builds are rebuilt.
--
-- PostgreSQL rejects CREATE INDEX CONCURRENTLY inside a transaction block.
-- Run this psql script outside a transaction so each concurrent build commits.
-- The 0002/03 migration files detect the pre-built indexes (IF NOT EXISTS)
-- and the contract migration (20261013000004) attaches the UNIQUE constraint
-- to the pre-built index with a brief lock only.
--
-- Large-table runbook:
--   1. Deploy a release containing migrations through
--      20261013000001_user_tenant_ownership (adds the column).
--   2. Run this script (outside any transaction — plain psql, not migrate):
--        psql $DATABASE_URL -f scripts/prebuild-user-tenant-indexes.sql
--   3. Only after this script exits successfully, mark the inline builds done:
--        pnpm exec prisma migrate resolve --applied \
--          "20261013000002_user_tenant_email_unique_index"
--        pnpm exec prisma migrate resolve --applied \
--          "20261013000003_user_tenant_lookup_index"
--   4. Deploy normally from here (code, then the contract migration).
--
-- Definitions match Prisma's defaults for @@unique([tenantId, email]) and
-- @@index([tenantId]) exactly, so the contract migration's
-- ALTER ... USING INDEX finds them by name.

\set ON_ERROR_STOP on

-- Refuse name collisions or unexpected definitions before removing any index.
DO $$
DECLARE
  candidate RECORD;
BEGIN
  FOR candidate IN
    SELECT c.relname, i.*, am.amname
    FROM pg_class c
    LEFT JOIN pg_index i ON i.indexrelid = c.oid
    LEFT JOIN pg_am am ON am.oid = c.relam
    WHERE c.relnamespace = current_schema()::regnamespace
      AND c.relname IN ('User_tenantId_email_key', 'User_tenantId_idx')
  LOOP
    IF candidate.indrelid IS DISTINCT FROM '"User"'::regclass
      OR candidate.amname IS DISTINCT FROM 'btree'
      OR candidate.indpred IS NOT NULL OR candidate.indexprs IS NOT NULL
      OR candidate.indisunique IS DISTINCT FROM (candidate.relname = 'User_tenantId_email_key')
      OR candidate.indnatts IS DISTINCT FROM
        (CASE WHEN candidate.relname = 'User_tenantId_email_key' THEN 2 ELSE 1 END)
      OR pg_get_indexdef(candidate.indexrelid, 1, true) IS DISTINCT FROM '"tenantId"'
      OR (candidate.relname = 'User_tenantId_email_key'
        AND pg_get_indexdef(candidate.indexrelid, 2, true) IS DISTINCT FROM 'email')
    THEN
      RAISE EXCEPTION 'Tenant index % has an unexpected definition; repair it explicitly before retrying', candidate.relname;
    END IF;
  END LOOP;
END $$;

-- A failed concurrent build leaves its name reserved, so IF NOT EXISTS alone
-- cannot recover. psql executes each generated DROP outside a transaction.
SELECT format('DROP INDEX CONCURRENTLY %s', i.indexrelid::regclass)
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indrelid = '"User"'::regclass AND NOT i.indisvalid
  AND c.relnamespace = current_schema()::regnamespace
  AND c.relname IN ('User_tenantId_email_key', 'User_tenantId_idx')
\gexec

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "User_tenantId_email_key"
  ON "User"("tenantId", email);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_tenantId_idx"
  ON "User"("tenantId");

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = '"User"'::regclass AND i.indisvalid
      AND c.relnamespace = current_schema()::regnamespace
      AND c.relname IN ('User_tenantId_email_key', 'User_tenantId_idx')) <> 2
  THEN
    RAISE EXCEPTION 'Tenant indexes are not valid; do not mark index migrations applied';
  END IF;
END $$;
