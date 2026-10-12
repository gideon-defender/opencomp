-- Attach the index built by the preceding nontransactional migration.
-- The short lock wait prevents queued DDL from stalling membership requests.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Member" ADD CONSTRAINT "Member_organizationId_userId_key"
  UNIQUE USING INDEX "Member_organizationId_userId_key";
COMMIT;
