import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { findLegacySharedUser } from './legacy-shared-user';
import { getHrSyncUser } from '../integration-platform/services/hr-sync-idp';

const mockRaw = jest.fn();
const mockFindSubject = jest.fn();
jest.mock('@db', () => ({
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
  db: {
    $queryRaw: (...args: unknown[]) => mockRaw(...args),
    user: {
      findUnique: (...args: unknown[]) => mockFindSubject(...args),
      findFirst: async () => null,
      create: async () => {
        throw Object.assign(new Error('global email conflict'), {
          code: 'P2002',
        });
      },
    },
  },
}));
const databaseUrl = process.env.USER_TENANT_TEST_DATABASE_URL;
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
function literal(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value !== 'string') throw new Error('Expected a string parameter');
  return "'" + value.replaceAll("'", "''") + "'";
}
const suite = databaseUrl ? describe : describe.skip;
suite('legacy shared-user PostgreSQL guard', () => {
  beforeEach(() => {
    mockFindSubject.mockReset();
    schema = 'review_' + randomUUID().replaceAll('-', '');
    query(`CREATE SCHEMA "${schema}";
      CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, "tenantId" TEXT, "gideonSub" TEXT, banned BOOLEAN);
      CREATE TABLE "Member" ("userId" TEXT, "organizationId" TEXT, deactivated BOOLEAN, "isActive" BOOLEAN);
      INSERT INTO "User" VALUES ('shared', 'shared@example.com', 'primary', 'sub_primary', false);
      ALTER TABLE "User" ADD COLUMN "createdAt" TIMESTAMPTZ DEFAULT now();
      INSERT INTO "Member" VALUES ('shared', 'primary', false, true), ('shared', 'secondary', false, true);`);
    mockRaw.mockImplementation(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings
          .map(
            (part, i) => part + (i < values.length ? literal(values[i]) : ''),
          )
          .join('');
        const result = query(
          `SELECT row_to_json(candidate) FROM (${sql}) candidate`,
        );
        return result ? result.split('\n').map((row) => JSON.parse(row)) : [];
      },
    );
  });
  afterEach(() => query(`DROP SCHEMA "${schema}" CASCADE`));
  function lookup({
    tenantId = 'secondary',
    sub = 'sub_secondary',
    email = 'shared@example.com',
  } = {}) {
    return findLegacySharedUser({ tenantId, sub, normalizedEmail: email });
  }
  it('rejects a distinct subject even when the email and secondary membership match', async () => {
    await expect(lookup()).resolves.toBeUndefined();
    await expect(
      findLegacySharedUser({
        tenantId: 'secondary',
        sub: 'sub_secondary',
        normalizedEmail: 'shared@example.com',
        purpose: 'hr-sync',
      }),
    ).resolves.toMatchObject({ id: 'shared' });
  });
  it('supports the canonical subject when its IdP address changed', async () => {
    await expect(
      lookup({ sub: 'sub_primary', email: 'new@example.com' }),
    ).resolves.toMatchObject({ id: 'shared' });
  });
  it('refuses a tenant without the existing membership', async () => {
    await expect(lookup({ tenantId: 'unknown' })).resolves.toBeUndefined();
  });
  it('refuses disabled memberships and banned users', async () => {
    query(
      `UPDATE "Member" SET deactivated = true WHERE "organizationId" = 'secondary'`,
    );
    await expect(lookup()).resolves.toBeUndefined();
    query(
      `UPDATE "Member" SET deactivated = false; UPDATE "User" SET banned = true`,
    );
    await expect(lookup()).resolves.toBeUndefined();
    await expect(
      findLegacySharedUser({
        tenantId: 'secondary',
        sub: 'sub_secondary',
        normalizedEmail: 'shared@example.com',
        purpose: 'hr-sync',
      }),
    ).resolves.toBeUndefined();
  });
  it.each(['sub_primary', 'sub_secondary'])(
    'resolves a deactivated shared member for HR with subject %s',
    async (sub) => {
      query(`UPDATE "Member" SET deactivated = true, "isActive" = false
        WHERE "organizationId" = 'secondary'`);
      if (sub === 'sub_primary') {
        mockFindSubject.mockResolvedValue({
          id: 'shared',
          tenantId: 'primary',
          gideonSub: sub,
          email: 'shared@example.com',
          banned: false,
        });
      }
      await expect(
        getHrSyncUser({
          identity: {
            id: sub,
            email: 'shared@example.com',
            display_name: 'Shared',
          },
          organizationId: 'secondary',
        }),
      ).resolves.toMatchObject({ id: 'shared', tenantId: 'primary' });
      await expect(lookup({ sub })).resolves.toBeUndefined();
      expect(
        query(`SELECT deactivated FROM "Member"
        WHERE "organizationId" = 'secondary'`),
      ).toBe('t');
    },
  );
  it('stops the compatibility path as soon as contract removes the global key', async () => {
    query(`ALTER TABLE "User" DROP CONSTRAINT "User_email_key"`);
    await expect(lookup()).resolves.toBeUndefined();
  });
  it('does not treat LIKE wildcards or SQL syntax as identity matches', async () => {
    await expect(
      lookup({ sub: 'unknown', email: '%@example.com' }),
    ).resolves.toBeUndefined();
    await expect(
      lookup({ sub: "' OR true --", email: 'unknown' }),
    ).resolves.toBeUndefined();
  });
});
