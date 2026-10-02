-- One active (pending/running) remediation batch per connection. The
-- controller pre-checks for a friendly 409, but only this index closes the
-- check-then-create race: two concurrent creates both pass the read, the
-- loser fails the insert with a unique violation instead of orphaning the
-- first batch. Terminal statuses (completed/done/failed/cancelled) are
-- unaffected, so finished batches never block new ones.
--
-- Deploy order: deploy the API code first, then apply this migration. The
-- code maps the unique violation (P2002) to 409 on the create path, so a
-- migration-first deploy turns concurrent creates into raw 500s until the
-- new code rolls out. (Without this index no unique violation is possible
-- on any path, so there is no equivalent hazard in the other direction —
-- only a window where duplicates are still possible, which the guard
-- below turns into a loud failure instead of silent bad state.)
--
-- Locking: a plain CREATE INDEX takes a ShareLock for the scan. Prisma
-- runs migrations in a transaction, so CONCURRENTLY is not available
-- in-band; the lock_timeout below bounds the wait instead of blocking
-- writers indefinitely. Apply off-peak on large tables. Rollback: this
-- index is unmanaged by the Prisma schema (see remediation-batch.prisma)
-- — roll back with:
--   DROP INDEX IF EXISTS "RemediationBatch_one_active_per_connection";
-- (No data changes here, so rollback fully restores the pre-deploy state.)

SET LOCAL lock_timeout = '10s';

-- Dirty-data guard: duplicate active rows per connection would fail the
-- unique build below. Cancel nothing automatically — a running batch the
-- user is watching must never be terminalized by a deploy while its
-- trigger run keeps working (orphaned run, lost work, arbitrary ctid
-- survivor). Fail loud instead: triage manually (keep the newest active
-- batch per connection, cancel the rest) and re-run this migration.
DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT "connectionId"
    FROM "RemediationBatch"
    WHERE status IN ('pending', 'running')
    GROUP BY "connectionId"
    HAVING count(*) > 1
  ) AS dupes;
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'RemediationBatch has % connection(s) with more than one active (pending/running) batch. Cancel all but the newest active batch per connection, then re-run this migration.', duplicate_count;
  END IF;
END
$$;

CREATE UNIQUE INDEX "RemediationBatch_one_active_per_connection"
  ON "RemediationBatch"("connectionId")
  WHERE status IN ('pending', 'running');
