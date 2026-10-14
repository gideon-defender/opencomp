import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.USER_TENANT_TEST_DATABASE_URL;
const contract = readFileSync(
  resolve(
    import.meta.dirname,
    '../prisma/migrations/20261013000004_user_tenant_enforce/migration.sql',
  ),
  'utf8',
);
const splitStart = contract.indexOf('DO $$\nDECLARE\n  r RECORD;');
const splitEnd = contract.indexOf('-- Re-check within-tenant duplicates after the split');
let schema: string;
function query(sql: string): string {
  if (!databaseUrl) throw new Error('Test database is required');
  return execFileSync(
    process.env.PSQL_BIN ?? 'psql',
    [databaseUrl, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    {
      encoding: 'utf8',
      env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ).trim();
}
describe.skipIf(!databaseUrl)('MCP selection through the tenant split SQL', () => {
  beforeEach(() => {
    schema = 'mcp_split_' + randomUUID().replaceAll('-', '');
    query(`CREATE SCHEMA "${schema}";
      CREATE FUNCTION generate_prefixed_cuid(prefix TEXT) RETURNS TEXT LANGUAGE SQL AS $$ SELECT prefix || '_clone' $$;
      CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT, email TEXT, "emailVerified" BOOLEAN, image TEXT,
        "createdAt" TIMESTAMP, "updatedAt" TIMESTAMP, "lastLogin" TIMESTAMP,
        "emailNotificationsUnsubscribed" BOOLEAN, "emailPreferences" JSONB, banned BOOLEAN, "banReason" TEXT,
        "banExpires" TIMESTAMP, "gideonSub" TEXT, "gideonTenantId" TEXT, "tenantId" TEXT);
      CREATE TABLE "Member" ("userId" TEXT, "organizationId" TEXT);
      CREATE TABLE mcp_org_binding ("userId" TEXT, "organizationId" TEXT);
      CREATE TABLE oauth_access_token ("userId" TEXT, "accessToken" TEXT);
      INSERT INTO "User" (id, email, "gideonSub", "tenantId") VALUES ('shared', 'shared@example.com', 'sub_shared', 'primary');
      INSERT INTO "Member" VALUES ('shared', 'primary'), ('shared', 'secondary');
      INSERT INTO mcp_org_binding VALUES ('shared', 'secondary');
      INSERT INTO oauth_access_token VALUES ('shared', 'old-token');
      CREATE TABLE "TimelineInstance" (id TEXT, "organizationId" TEXT, "lockedById" TEXT, "unlockedById" TEXT);
      CREATE TABLE "TimelinePhase" ("completedById" TEXT, "instanceId" TEXT);`);
    for (const [table, columns] of [
      ['AuditLog', 'userId'],
      ['Invitation', 'inviterId'],
      ['FleetPolicyResult', 'userId'],
      ['EvidenceSubmission', 'submittedById,reviewedById'],
      ['IntegrationResult', 'assignedUserId'],
      ['Finding', 'createdByAdminId'],
      ['OffboardingChecklistCompletion', 'completedById'],
      ['OffboardingAccessRevocation', 'revokedById'],
    ]) {
      query(
        `CREATE TABLE "${table}" ("organizationId" TEXT, ${columns
          .split(',')
          .map((column) => `"${column}" TEXT`)
          .join(',')})`,
      );
    }
  });
  afterEach(() => query(`DROP SCHEMA "${schema}" CASCADE`));
  it('preserves the old token selection instead of silently selecting the primary tenant', () => {
    expect(splitStart).toBeGreaterThan(0);
    expect(splitEnd).toBeGreaterThan(splitStart);
    query(contract.slice(splitStart, splitEnd));
    expect(query(`SELECT "userId" FROM "Member" WHERE "organizationId" = 'secondary'`)).toBe(
      'usr_clone',
    );
    expect(query(`SELECT "userId" || ':' || "organizationId" FROM mcp_org_binding`)).toBe(
      'shared:secondary',
    );
    expect(query(`SELECT "userId" FROM oauth_access_token`)).toBe('shared');
    expect(
      query(
        `SELECT count(*) FROM "Member" m JOIN mcp_org_binding b ON b."userId" = m."userId" AND b."organizationId" = m."organizationId"`,
      ),
    ).toBe('0');
  });
});
