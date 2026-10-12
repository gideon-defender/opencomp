-- Keep this migration to one statement: PostgreSQL rejects concurrent
-- index builds inside a transaction or a multi-statement query.
-- Duplicate memberships must be resolved before retrying a failed build.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Member_organizationId_userId_key"
  ON "Member" ("organizationId", "userId");
