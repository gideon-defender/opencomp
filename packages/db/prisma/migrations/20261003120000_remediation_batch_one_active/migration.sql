-- One active (pending/running) remediation batch per connection. The
-- controller pre-checks for a friendly 409, but only this index closes the
-- check-then-create race: two concurrent creates both pass the read, the
-- loser fails the insert with a unique violation instead of orphaning the
-- first batch. Terminal statuses (completed/done/failed/cancelled) are
-- unaffected, so finished batches never block new ones.
--
-- Deploy order: the API code maps the unique violation (P2002) to 409 on
-- both the create and update paths. Deploy the code first, then apply this
-- migration — otherwise in-flight concurrent creates hit a raw 500 until
-- the new code rolls out.
--
-- Locking: a plain CREATE INDEX takes a ShareLock for the scan. Prisma
-- runs migrations in a transaction, so CONCURRENTLY is not available
-- in-band; the lock_timeout below bounds the wait instead of blocking
-- writers indefinitely. Apply off-peak on large tables. Rollback: this
-- index is unmanaged by the Prisma schema (see remediation-batch.prisma)
-- — roll back with:
--   DROP INDEX IF EXISTS "RemediationBatch_one_active_per_connection";

-- Dirty-data guard: the old code created batches with no pre-check, so
-- duplicate active rows per connection are possible and would fail the
-- unique build below. Terminalize every active batch that is not the
-- latest for its connection (createdAt, then ctid as tiebreak) first.
UPDATE "RemediationBatch" AS old
SET status = 'cancelled', "updatedAt" = NOW()
WHERE old.status IN ('pending', 'running')
  AND EXISTS (
    SELECT 1 FROM "RemediationBatch" AS newer
    WHERE newer."connectionId" = old."connectionId"
      AND newer.status IN ('pending', 'running')
      AND (
        newer."createdAt" > old."createdAt"
        OR (newer."createdAt" = old."createdAt" AND newer.ctid > old.ctid)
      )
  );

SET LOCAL lock_timeout = '10s';

CREATE UNIQUE INDEX "RemediationBatch_one_active_per_connection"
  ON "RemediationBatch"("connectionId")
  WHERE status IN ('pending', 'running');
