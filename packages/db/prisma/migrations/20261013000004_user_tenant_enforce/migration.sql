-- Contract: apply only after tenant-aware code has fully rolled out and
-- old nodes are drained. See 20261013000000_user_tenant_normalize for rollout.
-- Approval and scale gates below protect live databases. Take a backup first;
-- the split is forward-only once identical emails exist in separate tenants.
-- Explicit transaction control makes drop/split/attach atomic regardless of
-- whether Prisma splits the script into individual statements.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- Contract-phase approval gate (enforced, not documentary): a single
-- `prisma migrate deploy` would otherwise apply this file in the same run
-- as the expand phase, before the step-2 code rolls out — every surviving
-- old node then crashes on its first user write. Abort unless the operator
-- approved the phase, except on databases with no users (fresh dev, CI, and
-- preview databases apply untouched). Approve by adding
-- `options=-c app.tenant_contract_approved=yes` to DATABASE_URL for the
-- contract deploy only (URL-encode the flag value as usual).
-- If this gate rejects a migrate deploy, Prisma records a failed migration.
-- Before retrying with approval, run from packages/db:
--   pnpm exec prisma migrate resolve --rolled-back 20261013000004_user_tenant_enforce
DO $$
DECLARE
  users INT;
  approved TEXT;
BEGIN
  SELECT count(*) INTO users FROM "User";
  approved := current_setting('app.tenant_contract_approved', true);
  IF users > 0 AND approved IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'user tenant contract: % user(s) present but the contract phase is not approved. Finish the step-2 code rollout and drain old nodes first, then mark 20261013000004_user_tenant_enforce rolled back with prisma migrate resolve --rolled-back before re-running with options=-c app.tenant_contract_approved=yes in DATABASE_URL.', users;
  END IF;
END $$;

-- Re-normalize expand-window writes (old nodes still write raw email until
-- drained). Without this, a single padded address aborts VALIDATE CONSTRAINT
-- in ...00005 and blocks the contract step. Same batched, idempotent loop as
-- 20261013000000_user_tenant_normalize; aborts explicitly on collisions.
DO $$
DECLARE
  groups INT;
  sample TEXT;
BEGIN
  SELECT count(*) INTO groups
  FROM (
    SELECT lower(regexp_replace(email, '^\s+|\s+$', '', 'g')) AS norm
    FROM "User"
    GROUP BY 1 HAVING count(*) > 1
  ) c;
  IF groups > 0 THEN
    SELECT string_agg(t.id, ', ') INTO sample
    FROM (
      SELECT u.id
      FROM "User" u
      JOIN (
        SELECT lower(regexp_replace(email, '^\s+|\s+$', '', 'g')) AS norm
        FROM "User"
        GROUP BY 1 HAVING count(*) > 1
      ) d ON d.norm = lower(regexp_replace(u.email, '^\s+|\s+$', '', 'g'))
      LIMIT 20
    ) t;
    RAISE EXCEPTION 'user tenant contract: % normalized-email collision group(s) present (sample IDs: %). Merge or delete the duplicates, then re-run.', groups, sample;
  END IF;
END $$;

DO $$
DECLARE
  n INT := 1;
BEGIN
  WHILE n > 0 LOOP
    WITH c AS (
      SELECT id FROM "User"
      WHERE email <> lower(regexp_replace(email, '^\s+|\s+$', '', 'g'))
      LIMIT 5000
    )
    UPDATE "User" u
    SET email = lower(regexp_replace(u.email, '^\s+|\s+$', '', 'g'))
    FROM c WHERE u.id = c.id;
    GET DIAGNOSTICS n = ROW_COUNT;
  END LOOP;
END $$;

-- Re-backfill expand-window writes with the expand-phase eligibility rules.
-- These batches stay in the contract transaction so drop/split/attach is atomic.
DO $$
DECLARE
  n INT := 1;
BEGIN
  WHILE n > 0 LOOP
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
  END LOOP;
END $$;

DO $$
DECLARE
  n INT := 1;
BEGIN
  WHILE n > 0 LOOP
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
  END LOOP;
END $$;

DO $$
DECLARE
  n INT := 1;
BEGIN
  WHILE n > 0 LOOP
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
  END LOOP;
END $$;

DO $$
DECLARE
  n INT := 1;
BEGIN
  WHILE n > 0 LOOP
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
  END LOOP;
END $$;

-- Re-check expand-phase ownership (fail explicitly, same as ..._ownership).
-- Ids only, never emails — deploy logs are not PII-safe.
DO $$
DECLARE
  missing TEXT;
  missing_count INT;
BEGIN
  SELECT count(*) INTO missing_count FROM "User" WHERE "tenantId" IS NULL;
  IF missing_count > 0 THEN
    SELECT string_agg(id, ', ') INTO missing
    FROM (SELECT id FROM "User" WHERE "tenantId" IS NULL LIMIT 20) l;
    RAISE EXCEPTION 'user tenant contract: % user(s) still lack tenant ownership (first IDs: %). Backfill explicitly before enforcing.', missing_count, missing;
  END IF;
END $$;

-- Drop the legacy global email uniqueness BEFORE splitting. Name varies by
-- database age; both forms are dropped idempotently.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_key";
DROP INDEX IF EXISTS "User_email_key";

-- Split cross-organization users: one User row per (user, extra org).
-- Row-by-row (minimal locks); the whole migration runs in one transaction,
-- so a mid-loop collision abort rolls back all clones and is safe to retry.
-- Preflight scale gate: splits over 1000 extra-org rows abort unless
-- options=-c app.tenant_split_large_ok=yes (each extra-org row fans out
-- ~13 UPDATEs against child tables, several without a supporting index,
-- followed by an ACCESS EXCLUSIVE SET NOT NULL on "User").
-- On a large busy database apply this file off-peak with a short
-- expand→contract window; `lock_timeout` fails fast and the transaction
-- retries from zero, so a contention abort is a retry signal, not damage.
DO $$
DECLARE
  extra_rows INT;
  split_ok TEXT;
BEGIN
  SELECT count(*) INTO extra_rows
  FROM (
    SELECT m."userId", m."organizationId"
    FROM "Member" m
    JOIN "User" u ON u.id = m."userId"
    WHERE u."tenantId" IS NOT NULL AND m."organizationId" <> u."tenantId"
    GROUP BY m."userId", m."organizationId"
  ) s;
  split_ok := current_setting('app.tenant_split_large_ok', true);
  IF extra_rows > 1000 AND split_ok IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'user tenant contract: % extra-org user row(s) to split — each fans out ~13 updates plus an ACCESS EXCLUSIVE SET NOT NULL on "User". Apply off-peak with a short expand-to-contract window, or re-run with options=-c app.tenant_split_large_ok=yes in DATABASE_URL after review. The 1000-row threshold is deliberately conservative.', extra_rows;
  END IF;
  RAISE NOTICE 'user tenant contract: % extra-org user row(s) to split — if large, apply off-peak', extra_rows;
END $$;

DO $$
DECLARE
  r RECORD;
  new_id TEXT;
BEGIN
  FOR r IN
    SELECT m."userId" AS old_user_id, m."organizationId" AS extra_org, u.email AS email
    FROM "Member" m
    JOIN "User" u ON u.id = m."userId"
    WHERE u."tenantId" IS NOT NULL AND m."organizationId" <> u."tenantId"
    GROUP BY m."userId", m."organizationId", u.email
  LOOP
    -- Abort when a row for this tenant+email already exists (resolve first).
    IF EXISTS (SELECT 1 FROM "User" WHERE "tenantId" = r.extra_org AND email = r.email) THEN
      RAISE EXCEPTION 'user tenant split: tenant % already holds that address while splitting user % — resolve explicitly', r.extra_org, r.old_user_id;
    END IF;
    new_id := generate_prefixed_cuid('usr'::text);
    INSERT INTO "User" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", "lastLogin",
      "emailNotificationsUnsubscribed", "emailPreferences", banned, "banReason", "banExpires",
      "gideonSub", "gideonTenantId", "tenantId")
    SELECT new_id, name, email, "emailVerified", image, "createdAt", "updatedAt", NULL,
      "emailNotificationsUnsubscribed", "emailPreferences", banned, "banReason", "banExpires",
      NULL, r.extra_org, r.extra_org
    FROM "User" WHERE id = r.old_user_id;
    UPDATE "Member" SET "userId" = new_id WHERE "userId" = r.old_user_id AND "organizationId" = r.extra_org;
    -- Org-scoped actor history belongs to the secondary identity: without
    -- this, the extra org's audit rows keep pointing at the primary tenant's
    -- row while their member now points at the clone.
    UPDATE "AuditLog" SET "userId" = new_id WHERE "userId" = r.old_user_id AND "organizationId" = r.extra_org;
    UPDATE "Invitation" SET "inviterId" = new_id WHERE "inviterId" = r.old_user_id AND "organizationId" = r.extra_org;
    -- Org-scoped user-anchored rows follow the clone for the same reason.
    -- (Login-bound rows stay with the primary row by design: Account,
    -- Session remnants, OauthApplication/AccessToken/Consent and Jwks are
    -- sub/session-bound login history, not org activity.)
    UPDATE "FleetPolicyResult" SET "userId" = new_id WHERE "userId" = r.old_user_id AND "organizationId" = r.extra_org;
    UPDATE "EvidenceSubmission" SET "submittedById" = new_id WHERE "submittedById" = r.old_user_id AND "organizationId" = r.extra_org;
    UPDATE "EvidenceSubmission" SET "reviewedById" = new_id WHERE "reviewedById" = r.old_user_id AND "organizationId" = r.extra_org;
    UPDATE "IntegrationResult" SET "assignedUserId" = new_id WHERE "assignedUserId" = r.old_user_id AND "organizationId" = r.extra_org;
    UPDATE "Finding" SET "createdByAdminId" = new_id WHERE "createdByAdminId" = r.old_user_id AND "organizationId" = r.extra_org;
    UPDATE "TimelineInstance" SET "lockedById" = new_id WHERE "lockedById" = r.old_user_id AND "organizationId" = r.extra_org;
    UPDATE "TimelineInstance" SET "unlockedById" = new_id WHERE "unlockedById" = r.old_user_id AND "organizationId" = r.extra_org;
    -- TimelinePhase carries no org column: scope through the parent instance.
    UPDATE "TimelinePhase" SET "completedById" = new_id WHERE "completedById" = r.old_user_id AND "instanceId" IN (SELECT id FROM "TimelineInstance" WHERE "organizationId" = r.extra_org);
    UPDATE "OffboardingChecklistCompletion" SET "completedById" = new_id WHERE "completedById" = r.old_user_id AND "organizationId" = r.extra_org;
    UPDATE "OffboardingAccessRevocation" SET "revokedById" = new_id WHERE "revokedById" = r.old_user_id AND "organizationId" = r.extra_org;
    -- Retain the original token's organization selection. Moving the binding
    -- would make existing tokens silently fall back to the primary tenant.
    -- The MCP guard checks saved selections even with one membership and
    -- rejects a removed secondary membership until the user reconnects.
  END LOOP;
END $$;

-- Re-check within-tenant duplicates after the split (window writes may have
-- raced between ..._ownership and this file). Fail explicitly before attaching.
DO $$
DECLARE
  dupes TEXT;
BEGIN
  SELECT string_agg("tenantId" || ':' || cnt::text, ', ') INTO dupes
  FROM (SELECT "tenantId", email, count(*) AS cnt FROM "User" GROUP BY 1, 2 HAVING count(*) > 1) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'user tenant contract: within-tenant duplicate emails present (tenant:count %); resolve by merging/deleting before enforcing', dupes;
  END IF;
END $$;

-- Attach the composite unique constraint to the pre-built index.
-- The short lock wait prevents queued DDL from stalling login requests.
SET LOCAL lock_timeout = '5s';
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_email_key"
  UNIQUE USING INDEX "User_tenantId_email_key";
SET LOCAL lock_timeout = '10s';

-- Ownership is required from here on.
ALTER TABLE "User" ALTER COLUMN "tenantId" SET NOT NULL;

-- Normalization enforcement without a validating-ADD table scan lock:
-- add NOT VALID here; the VALIDATE step lives in ...00005 so this file's
-- open transaction stays short. Keep validation and the trigger in the
-- follow-up file to shorten the lock held on User/Member.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_normalized";
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_normalized"
  CHECK (email = lower(regexp_replace(email, '^\s+|\s+$', '', 'g')))
  NOT VALID;

COMMIT;
