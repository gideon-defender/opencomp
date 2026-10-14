-- Expand ownership after the column-only migration has committed its DDL.
-- Keep this file to ONE top-level DO statement: transaction control inside
-- DO is forbidden when the caller wraps it in a transaction or SQL batch.
-- Each 5000-row batch commits, releasing row locks. Completed batches survive
-- a later orphan/collision abort; resolve those rows and use migrate resolve
-- --rolled-back before retrying. Every batch only touches null ownership.
-- The contract migration repeats the eligibility rules for old-node writes.
DO $$
DECLARE
  n INT;
  missing TEXT;
  missing_count INT;
  dupes TEXT;
BEGIN
  -- Single membership takes precedence over a stale login stamp.
  n := 1;
  WHILE n > 0 LOOP
    PERFORM set_config('lock_timeout', '10s', true);
    UPDATE "User" u SET "tenantId" = candidate.tenant
    FROM (
      SELECT pending.id, min(m."organizationId") AS tenant
      FROM "User" pending JOIN "Member" m ON m."userId" = pending.id
      WHERE pending."tenantId" IS NULL
      GROUP BY pending.id
      HAVING count(DISTINCT m."organizationId") = 1
      LIMIT 5000
    ) candidate
    WHERE u.id = candidate.id AND u."tenantId" IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    COMMIT;
  END LOOP;

  -- Multiple memberships prefer a matching stamp, else the first org.
  n := 1;
  WHILE n > 0 LOOP
    PERFORM set_config('lock_timeout', '10s', true);
    UPDATE "User" u SET "tenantId" = candidate.tenant
    FROM (
      SELECT pending.id, COALESCE(
        min(m."organizationId") FILTER (WHERE m."organizationId" = pending."gideonTenantId"),
        min(m."organizationId")
      ) AS tenant
      FROM "User" pending JOIN "Member" m ON m."userId" = pending.id
      WHERE pending."tenantId" IS NULL
      GROUP BY pending.id
      HAVING count(DISTINCT m."organizationId") > 1
      LIMIT 5000
    ) candidate
    WHERE u.id = candidate.id AND u."tenantId" IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    COMMIT;
  END LOOP;

  -- Only membership-less users may fall back to the login stamp.
  n := 1;
  WHILE n > 0 LOOP
    PERFORM set_config('lock_timeout', '10s', true);
    UPDATE "User" u SET "tenantId" = candidate.tenant
    FROM (
      SELECT pending.id, pending."gideonTenantId" AS tenant
      FROM "User" pending
      WHERE pending."tenantId" IS NULL AND pending."gideonTenantId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Member" WHERE "userId" = pending.id)
      LIMIT 5000
    ) candidate
    WHERE u.id = candidate.id AND u."tenantId" IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    COMMIT;
  END LOOP;

  -- Only membership-less users may fall back to their latest session.
  n := 1;
  WHILE n > 0 LOOP
    PERFORM set_config('lock_timeout', '10s', true);
    UPDATE "User" u SET "tenantId" = candidate.tenant
    FROM (
      SELECT pending.id, recent."activeOrganizationId" AS tenant
      FROM "User" pending
      JOIN LATERAL (
        SELECT "activeOrganizationId" FROM "Session"
        WHERE "userId" = pending.id AND "activeOrganizationId" IS NOT NULL
        ORDER BY "expiresAt" DESC LIMIT 1
      ) recent ON true
      WHERE pending."tenantId" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "Member" WHERE "userId" = pending.id)
      LIMIT 5000
    ) candidate
    WHERE u.id = candidate.id AND u."tenantId" IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    COMMIT;
  END LOOP;

  -- Log counts and row ids only (never emails — deploy logs are not PII-safe;
  -- query the flagged ids directly for addresses).
  SELECT count(*) INTO missing_count FROM "User" WHERE "tenantId" IS NULL;
  IF missing_count > 0 THEN
    SELECT string_agg(id, ', ') INTO missing
    FROM (SELECT id FROM "User" WHERE "tenantId" IS NULL LIMIT 20) l;
    RAISE EXCEPTION 'user tenant backfill: % user(s) have no tenant signal (no gideonTenantId, membership, or session org). Resolve explicitly (assign a tenant or delete the orphan) before migrating. First IDs: %', missing_count, missing;
  END IF;

  SELECT string_agg("tenantId" || ':' || cnt::text, ', ') INTO dupes
  FROM (SELECT "tenantId", email, count(*) AS cnt FROM "User" WHERE "tenantId" IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'user tenant backfill: within-tenant duplicate emails present (tenant:count %); resolve by merging/deleting before migrating', dupes;
  END IF;
END $$;
