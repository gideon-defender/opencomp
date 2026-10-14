-- Tenant-scoped user identity, EXPAND phase A: email normalization.
--
-- Deploy order (both directions must stay up during rolling deploys):
--   1. Apply 20261012235959_user_tenant_ownership_column, this file,
--      then 20261013000001_user_tenant_ownership,
--      20261013000002 and 20261013000003. These keep the legacy global
--      "User_email_key" in place: old code keeps reading and writing exactly
--      as before (one row per email), so rolling nodes on either version
--      stay up through this step. Large tables only: pre-build the 0002/03
--      indexes CONCURRENTLY first — see
--      packages/db/scripts/prebuild-user-tenant-indexes.sql.
--   2. Deploy the application code (writes tenantId, reads tenant-scoped).
--      New code needs no constraint from these files: it writes tenantId on
--      every create and scopes every lookup by tenant. Expand-window rows
--      written by old nodes (null tenantId) are claimed, not rejected — see
--      linkGideonSub/updateLoginState — and the contract migration
--      re-backfills them, so keep this window short.
--   3. Apply 20261013000004 (contract: drop the legacy global key, split
--      cross-organization users into one row per tenant, attach the composite
--      unique, SET NOT NULL, CHECK, immutability trigger) only after the
--      step-2 code is fully rolled out and old nodes are drained. The
--      contract files enforce this with approval gates (they abort without
--      options=-c app.tenant_contract_approved=yes on databases holding
--      users), so a plain `migrate deploy` fails closed here by design:
--      approve the flag for the contract deploy only. Before that retry,
--      clear the expected failed gate record (this does not undo SQL):
--        pnpm exec prisma migrate resolve --rolled-back \
--          20261013000004_user_tenant_enforce
--      Then add the approval option and run migrate deploy again.
--      If 0005 or 0006 rejects separately, resolve that failed file instead.
-- During step 2, the canonical subject can use existing secondary memberships
-- while User_email_key remains valid. Distinct subjects cannot authenticate
-- through the shared email until memberships split. HR sync can resolve shared
-- rows by email without changing their primary subject or ownership.
-- Admin email changes stay blocked until memberships split.
-- Contract preserves existing MCP selections on the original token owner:
-- a selection whose membership moved to a clone is rejected, never replaced
-- by that owner's remaining primary membership. Reconnect in the intended org.
--
-- Never apply ...0004 before the code in step 2: old code inserts users
-- without tenantId (violates NOT NULL) and writes non-normalized email
-- (violates the CHECK), and old single-email reads break once the split
-- creates one row per tenant.
--
-- What this file does:
--   * Aborts with an explicit id list when two rows would normalize to the
--     same address (with the legacy key still in place, the second colliding
--     write would abort the whole migration with a raw unique violation).
--     Resolve by merging/deleting, then re-run.
--   * Normalizes every User.email to lower(trim(email)) in 5000-row batches
--     with a commit after each batch to release its row locks.
--     The trim uses regexp '\s' edge matching, which approximates the JS
--     normalizeEmail(): JS trim() strips a wider Unicode set (e.g. U+00A0,
--     U+2000-U+200A, U+FEFF) that this predicate leaves in place. Every
--     writer must use normalizeEmail() so new rows never carry such padding
--     (Postgres btrim() strips spaces only and would leave even
--     tab/newline-padded lookalikes).
--
-- Keep this file to ONE top-level DO statement so batch COMMIT works through
-- Prisma's migration runner. Completed batches survive a later failure; resolve
-- the failed migration as rolled back before retrying. Retries only touch emails
-- that still need normalization. Column DDL has committed in the previous file.

-- 0. Friendly abort on post-normalization collisions BEFORE writing anything:
--    with the legacy global key still in place, the second colliding write
--    would abort the whole migration with a raw unique violation instead of
--    this explicit list. Ids only, never emails — deploy logs are not
--    PII-safe; query the flagged ids directly for addresses.
DO $$
DECLARE
  groups INT;
  sample TEXT;
  n INT := 1;
BEGIN
  PERFORM set_config('lock_timeout', '10s', true);
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
    RAISE EXCEPTION 'user tenant expand: % normalized-email collision group(s) present (sample IDs: %). Merge or delete the duplicates, then re-run.', groups, sample;
  END IF;
  -- 1. Normalize emails and release row locks after every page.
  WHILE n > 0 LOOP
    PERFORM set_config('lock_timeout', '10s', true);
    WITH c AS (
      SELECT id FROM "User"
      WHERE email <> lower(regexp_replace(email, '^\s+|\s+$', '', 'g'))
      LIMIT 5000
    )
    UPDATE "User" u
    SET email = lower(regexp_replace(u.email, '^\s+|\s+$', '', 'g'))
    FROM c WHERE u.id = c.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    COMMIT;
  END LOOP;
END $$;
