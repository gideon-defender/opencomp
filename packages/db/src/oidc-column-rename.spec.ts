import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.USER_TENANT_TEST_DATABASE_URL;
const migration = readFileSync(
  resolve(
    import.meta.dirname,
    '../prisma/migrations/20261015000000_oidc_column_rename/migration.sql',
  ),
  'utf8',
);
const databaseName = `oidc_rename_${randomUUID().replaceAll('-', '')}`;
let testDatabaseUrl: string;

function query({ sql, url = testDatabaseUrl }: { sql: string; url?: string }): string {
  return execFileSync(
    process.env.PSQL_BIN ?? 'psql',
    [url, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

function seedUser(): void {
  query({
    sql: `INSERT INTO "User" VALUES ('user', 'subject', 'tenant');
    INSERT INTO "Session" VALUES ('session', 'refresh-token');`,
  });
}

function approveRename(): string {
  const url = new URL(testDatabaseUrl);
  url.searchParams.set('options', '-c app.oidc_rename_approved=yes');
  return url.toString().replaceAll('+', '%20');
}

describe.skipIf(!databaseUrl)('OIDC column rename migration', () => {
  // The migration inspects public explicitly, so each suite needs its own database.
  beforeAll(() => {
    if (!databaseUrl) throw new Error('USER_TENANT_TEST_DATABASE_URL is required');
    const url = new URL(databaseUrl);
    url.pathname = `/${databaseName}`;
    url.searchParams.delete('schema');
    url.searchParams.delete('options');
    testDatabaseUrl = url.toString();
    query({ url: databaseUrl, sql: `CREATE DATABASE "${databaseName}"` });
  });

  afterAll(() => {
    if (!databaseUrl || !testDatabaseUrl) return;
    query({ url: databaseUrl, sql: `DROP DATABASE "${databaseName}" WITH (FORCE)` });
  });

  beforeEach(() => {
    query({
      sql: `DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      CREATE TABLE "User" (id TEXT PRIMARY KEY, "gideonSub" TEXT UNIQUE, "gideonTenantId" TEXT);
      CREATE TABLE "Session" (id TEXT PRIMARY KEY, "gideonRefreshToken" TEXT);`,
    });
  });

  it('renames an empty database without approval', () => {
    query({ sql: migration });
    expect(query({ sql: 'SELECT count("oidcSub"), count("oidcTenantId") FROM "User"' })).toBe(
      '0|0',
    );
    expect(query({ sql: 'SELECT count("oidcRefreshToken") FROM "Session"' })).toBe('0');
  });

  it('rejects populated databases without approval and retains the original columns and values', () => {
    seedUser();
    expect(() => query({ sql: migration })).toThrow(/rename phase is not approved/);
    expect(query({ sql: 'SELECT "gideonSub", "gideonTenantId" FROM "User"' })).toBe(
      'subject|tenant',
    );
    expect(query({ sql: 'SELECT "gideonRefreshToken" FROM "Session"' })).toBe('refresh-token');
  });

  it('preserves values and subject uniqueness through an approved rename and retry', () => {
    seedUser();
    const url = approveRename();
    query({ url, sql: migration });
    query({ url, sql: migration });
    expect(query({ sql: 'SELECT "oidcSub", "oidcTenantId" FROM "User"' })).toBe('subject|tenant');
    expect(query({ sql: 'SELECT "oidcRefreshToken" FROM "Session"' })).toBe('refresh-token');
    expect(query({ sql: `SELECT to_regclass('public."User_oidcSub_key"') IS NOT NULL` })).toBe('t');
    expect(
      query({
        sql: `SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name IN
        ('gideonSub', 'gideonTenantId', 'gideonRefreshToken')`,
      }),
    ).toBe('0');
    expect(() =>
      query({ sql: `INSERT INTO "User" VALUES ('duplicate', 'subject', 'tenant')` }),
    ).toThrow(/User_oidcSub_key/);
  });

  it('rolls back all column renames when the index rename fails', () => {
    seedUser();
    query({ sql: 'CREATE TABLE "User_oidcSub_key" (id TEXT)' });
    expect(() => query({ url: approveRename(), sql: migration })).toThrow(/already exists/);
    expect(query({ sql: 'SELECT "gideonSub", "gideonTenantId" FROM "User"' })).toBe(
      'subject|tenant',
    );
    expect(query({ sql: 'SELECT "gideonRefreshToken" FROM "Session"' })).toBe('refresh-token');
    expect(query({ sql: `SELECT to_regclass('public."User_gideonSub_key"') IS NOT NULL` })).toBe(
      't',
    );
  });
});
