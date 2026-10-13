import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.USER_TENANT_TEST_DATABASE_URL;
const script = resolve(import.meta.dirname, '../scripts/prebuild-user-tenant-indexes.sql');
let schema: string;

function psql(args: string[]): string {
  if (!databaseUrl) throw new Error('Test database is required');
  return execFileSync(
    process.env.PSQL_BIN ?? 'psql',
    [databaseUrl, '-X', '-At', '-v', 'ON_ERROR_STOP=1', ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ).trim();
}

describe.skipIf(!databaseUrl)('tenant index pre-build recovery', () => {
  beforeEach(() => {
    schema = `index_recovery_${randomUUID().replaceAll('-', '')}`;
    psql([
      '-c',
      `CREATE SCHEMA "${schema}";
      CREATE TABLE "User" (id TEXT PRIMARY KEY, "tenantId" TEXT, email TEXT);
      INSERT INTO "User" VALUES ('a', 'tenant', 'same@example.com'),
        ('b', 'tenant', 'same@example.com');`,
    ]);
  });
  afterEach(() => psql(['-c', `DROP SCHEMA "${schema}" CASCADE`]));

  it('repairs a failed concurrent build and permits constraint attachment', () => {
    expect(() =>
      psql([
        '-c',
        `CREATE UNIQUE INDEX CONCURRENTLY "User_tenantId_email_key"
      ON "User"("tenantId", email)`,
      ]),
    ).toThrow();
    expect(
      psql([
        '-c',
        `SELECT indisvalid FROM pg_index
      WHERE indexrelid = '"User_tenantId_email_key"'::regclass`,
      ]),
    ).toBe('f');
    expect(() =>
      psql([
        '-f',
        resolve(
          import.meta.dirname,
          '../prisma/migrations/20261013000002_user_tenant_email_unique_index/migration.sql',
        ),
      ]),
    ).toThrow(/is not valid/);
    psql(['-c', `DELETE FROM "User" WHERE id = 'b'`]);
    psql(['-f', script]);
    expect(
      psql([
        '-c',
        `SELECT indisvalid FROM pg_index
      WHERE indexrelid = '"User_tenantId_email_key"'::regclass`,
      ]),
    ).toBe('t');
    psql([
      '-c',
      `ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_email_key"
      UNIQUE USING INDEX "User_tenantId_email_key"`,
    ]);
    expect(() =>
      psql([
        '-c',
        `INSERT INTO "User" VALUES
      ('c', 'tenant', 'same@example.com')`,
      ]),
    ).toThrow();
  });

  it('retains valid indexes on repeated runs', () => {
    psql(['-c', `DELETE FROM "User" WHERE id = 'b'`]);
    psql(['-f', script]);
    const indexIds = () =>
      psql([
        '-c',
        `SELECT indexrelid FROM pg_index
      WHERE indrelid = '"User"'::regclass ORDER BY indexrelid`,
      ]);
    const before = indexIds();
    psql(['-f', script]);
    expect(indexIds()).toBe(before);
  });

  it('rejects an existing index with the wrong definition', () => {
    psql(['-c', `CREATE INDEX "User_tenantId_email_key" ON "User"(email)`]);
    expect(() => psql(['-f', script])).toThrow();
    expect(psql(['-c', `SELECT count(*) FROM "User"`])).toBe('2');
  });
});
