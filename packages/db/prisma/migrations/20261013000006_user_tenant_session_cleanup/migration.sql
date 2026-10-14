-- Tenant-scoped user identity, CONTRACT session cleanup.
--
-- Runs after 20261013000004_user_tenant_enforce (split) in its own
-- transaction (Prisma wraps each migration file). The split re-points Member
-- rows for secondary orgs at the clone, but pre-split sessions still point at
-- the primary user. The live membership check in HybridAuthGuard already
-- refuses those sessions (no Member row pairs the primary user with the
-- secondary org), so they authorize nothing — this delete removes the dead
-- rows and forces a fresh login, which re-links the clone via subject-first
-- login. Sessions already matching their user's tenant, and sessions with no
-- org, are left alone.
--
-- Split out of ...0004 on purpose: the delete scans Session with a join
-- against User and would lengthen the lock held by the split transaction.
-- This statement is idempotent (re-running only matches still-stale rows)
-- and safe to retry. Apply promptly after ...0004 so stale rows do not linger
-- (they are rejected, but they still occupy the table and confuse audits).
-- Forward-only with no reverse, like ...0004.

SET LOCAL lock_timeout = '10s';

-- Contract-phase approval gate (same as ...0004): this file must never run
-- ahead of the approved contract deploy. No-op on userless databases.
-- If this gate rejects a migrate deploy, Prisma records a failed migration.
-- Before retrying with approval, run from packages/db:
--   pnpm exec prisma migrate resolve --rolled-back 20261013000006_user_tenant_session_cleanup
DO $$
DECLARE
  users INT;
  approved TEXT;
BEGIN
  SELECT count(*) INTO users FROM "User";
  approved := current_setting('app.tenant_contract_approved', true);
  IF users > 0 AND approved IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'user tenant contract: session cleanup is not approved. Mark 20261013000006_user_tenant_session_cleanup rolled back with prisma migrate resolve --rolled-back, then re-run with options=-c app.tenant_contract_approved=yes in DATABASE_URL.';
  END IF;
END $$;

-- Batched delete (5000-row pages like the other backfills): a single
-- statement over Session-joined-User would hold its lock for the whole scan
-- on a large Session table. Idempotent — re-running only matches rows that
-- are still stale — and safe to retry.
DO $$
DECLARE
  n INT := 1;
BEGIN
  WHILE n > 0 LOOP
    DELETE FROM "Session" s
    WHERE s."id" IN (
      SELECT s2."id"
      FROM "Session" s2
      JOIN "User" u ON u.id = s2."userId"
      WHERE s2."activeOrganizationId" IS NOT NULL
        AND u."tenantId" IS DISTINCT FROM s2."activeOrganizationId"
      LIMIT 5000
    );
    GET DIAGNOSTICS n = ROW_COUNT;
  END LOOP;
END $$;
