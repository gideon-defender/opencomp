import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.USER_TENANT_TEST_DATABASE_URL;
const migrations = resolve(import.meta.dirname, '../prisma/migrations');
const ownershipPath = resolve(migrations, '20261013000001_user_tenant_ownership/migration.sql');
const columnPath = resolve(migrations, '20261012235959_user_tenant_ownership_column/migration.sql');
const ownership = readFileSync(ownershipPath, 'utf8');
const normalization = readFileSync(
  resolve(migrations, '20261013000000_user_tenant_normalize/migration.sql'),
  'utf8',
);
const contract = readFileSync(
  resolve(migrations, '20261013000004_user_tenant_enforce/migration.sql'),
  'utf8',
);
let schema: string;

function query(sql: string): string {
  if (!databaseUrl) throw new Error('USER_TENANT_TEST_DATABASE_URL is required');
  return execFileSync(
    process.env.PSQL_BIN ?? 'psql',
    [databaseUrl, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    {
      encoding: 'utf8',
      env: { ...process.env, PGOPTIONS: `-c search_path=${schema} -c statement_timeout=15000` },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ).trim();
}

function addColumn(): void {
  query(readFileSync(columnPath, 'utf8'));
}

function seedMixedUsers(): void {
  query(`
    INSERT INTO "User" (id, email, "gideonTenantId")
      SELECT 'stamp_' || n, n || '@example.com', 'stamp_org'
      FROM generate_series(1, 5000) n;
    INSERT INTO "User" (id, email, "gideonTenantId") VALUES
      ('single', 'single@example.com', 'stale_org'),
      ('multi', 'multi@example.com', 'multi_b'),
      ('session', 'session@example.com', NULL),
      ('unstamped', 'unstamped@example.com', NULL);
    INSERT INTO "Member" ("userId", "organizationId") VALUES
      ('single', 'single_org'), ('multi', 'multi_a'),
      ('multi', 'multi_b'), ('unstamped', 'member_org');
    INSERT INTO "Session" ("userId", "activeOrganizationId", "expiresAt")
      VALUES ('session', 'session_org', now());
  `);
}

describe.skipIf(!databaseUrl)('user tenant SQL migrations', () => {
  beforeEach(() => {
    schema = `tenant_migration_${randomUUID().replaceAll('-', '')}`;
    query(`
      CREATE SCHEMA "${schema}";
      CREATE TABLE "User" (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, "gideonTenantId" TEXT
      );
      CREATE TABLE "Member" ("userId" TEXT, "organizationId" TEXT);
      CREATE TABLE "Session" (
        "userId" TEXT, "activeOrganizationId" TEXT, "expiresAt" TIMESTAMPTZ
      );
    `);
  });

  afterEach(() => {
    query(`DROP SCHEMA "${schema}" CASCADE`);
  });

  it('backfills eligible users beyond a page of other ownership signals', () => {
    seedMixedUsers();
    addColumn();
    query(ownership);
    expect(
      query(`SELECT id || ':' || "tenantId" FROM "User"
      WHERE id IN ('single', 'multi', 'session', 'unstamped') ORDER BY id`),
    ).toBe('multi:multi_b\nsession:session_org\nsingle:single_org\nunstamped:member_org');
    query(ownership);
    expect(query('SELECT count(*) FROM "User" WHERE "tenantId" IS NULL')).toBe('0');
  });

  it('commits normalization pages and safely retries after a later page fails', () => {
    query(`INSERT INTO "User" (id, email, "gideonTenantId")
      SELECT 'user_' || n, ' USER_' || n || '@EXAMPLE.COM ', 'org'
      FROM generate_series(1, 5001) n;
      CREATE TABLE normalized_transactions (transaction_id BIGINT);
      CREATE FUNCTION record_normalization() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (SELECT count(*) FROM normalized_transactions) >= 5000 THEN
          RAISE EXCEPTION 'second page failed';
        END IF;
        INSERT INTO normalized_transactions VALUES (txid_current());
        RETURN NEW;
      END $$;
      CREATE TRIGGER record_normalization AFTER UPDATE ON "User"
        FOR EACH ROW EXECUTE FUNCTION record_normalization();`);
    expect(() => query(normalization)).toThrow();
    expect(query('SELECT count(*) FROM normalized_transactions')).toBe('5000');
    expect(query(`SELECT count(*) FROM "User" WHERE email = lower(trim(email))`)).toBe('5000');
    query('DROP TRIGGER record_normalization ON "User"');
    query(normalization);
    expect(query(`SELECT count(*) FROM "User" WHERE email = lower(trim(email))`)).toBe('5001');
    query(normalization);
    expect(query('SELECT count(*) FROM "User"')).toBe('5001');
  });

  it('uses the same eligible batches for expand-window rows during contract', () => {
    seedMixedUsers();
    query('ALTER TABLE "User" ADD COLUMN "tenantId" TEXT');
    const start = contract.indexOf('-- Re-backfill expand-window writes');
    const end = contract.indexOf('-- Drop the legacy global email uniqueness');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    query(contract.slice(start, end));
    expect(query(`SELECT "tenantId" FROM "User" WHERE id = 'single'`)).toBe('single_org');
    expect(query('SELECT count(*) FROM "User" WHERE "tenantId" IS NULL')).toBe('0');
  });

  it('does not hold the column DDL lock while backfilling', () => {
    query(`INSERT INTO "User" VALUES ('user', 'user@example.com', 'org');
      CREATE FUNCTION assert_no_ddl_lock() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_locks WHERE pid = pg_backend_pid()
          AND relation = '"User"'::regclass AND mode = 'AccessExclusiveLock') THEN
          RAISE EXCEPTION 'ownership backfill holds ACCESS EXCLUSIVE';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER assert_no_ddl_lock BEFORE UPDATE ON "User"
        FOR EACH ROW EXECUTE FUNCTION assert_no_ddl_lock();`);
    addColumn();
    query(ownership);
    expect(query('SELECT "tenantId" FROM "User"')).toBe('org');
  });

  it('commits between batches and preserves completed work after an orphan abort', () => {
    query(`INSERT INTO "User" (id, email, "gideonTenantId")
      SELECT 'user_' || n, n || '@example.com', 'org' FROM generate_series(1, 5001) n;
      INSERT INTO "User" VALUES ('orphan', 'orphan@example.com', NULL);
      CREATE TABLE batch_transactions (transaction_id BIGINT);
      CREATE FUNCTION record_batch() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO batch_transactions VALUES (txid_current());
        RETURN NEW;
      END $$;
      CREATE TRIGGER record_batch AFTER UPDATE ON "User"
        FOR EACH ROW EXECUTE FUNCTION record_batch();`);
    addColumn();
    expect(() => query(ownership)).toThrow();
    expect(query('SELECT count(*) FROM "User" WHERE "tenantId" = \'org\'')).toBe('5001');
    expect(
      Number(query('SELECT count(DISTINCT transaction_id) FROM batch_transactions')),
    ).toBeGreaterThan(1);
    query('UPDATE "User" SET "gideonTenantId" = \'org\' WHERE id = \'orphan\'');
    query(ownership);
    expect(query('SELECT count(*) FROM "User" WHERE "tenantId" IS NULL')).toBe('0');
  });

  it('rolls back the global-key drop when the contract scale gate rejects the split', () => {
    query(`ALTER TABLE "User" ADD COLUMN "tenantId" TEXT;
      INSERT INTO "User" VALUES ('user', 'user@example.com', 'primary', 'primary');
      INSERT INTO "Member" SELECT 'user', 'extra_' || n FROM generate_series(1, 1001) n;`);
    expect(() =>
      query(
        contract.replace(
          'BEGIN;',
          `BEGIN;
      SET LOCAL app.tenant_contract_approved = 'yes';`,
        ),
      ),
    ).toThrow();
    expect(
      query(`SELECT count(*) FROM pg_constraint
      WHERE conrelid = '"User"'::regclass AND conname = 'User_email_key'`),
    ).toBe('1');
    expect(query('SELECT count(*) FROM "User"')).toBe('1');
  });

  it('supports batch commits through the pinned Prisma migration runner', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'tenant-migrate-'));
    try {
      seedMixedUsers();
      query(`INSERT INTO "User" (id, email, "gideonTenantId")
        SELECT 'normalize_' || n, ' NORMALIZE_' || n || '@EXAMPLE.COM ', 'org'
        FROM generate_series(1, 5001) n;
        CREATE TABLE normalized_transactions (transaction_id BIGINT);
        CREATE FUNCTION record_normalization() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.email IS DISTINCT FROM NEW.email THEN
            INSERT INTO normalized_transactions VALUES (txid_current());
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER record_normalization AFTER UPDATE ON "User"
          FOR EACH ROW EXECUTE FUNCTION record_normalization();`);
      const baseline = '00000000000000_fixture';
      const baselinePath = resolve(directory, 'migrations', baseline);
      cpSync(resolve(migrations, '20261012235959_user_tenant_ownership_column'), baselinePath, {
        recursive: true,
      });
      writeFileSync(resolve(baselinePath, 'migration.sql'), 'SELECT 1;');
      for (const name of [
        '20261012235959_user_tenant_ownership_column',
        '20261013000000_user_tenant_normalize',
        '20261013000001_user_tenant_ownership',
      ]) {
        cpSync(resolve(migrations, name), resolve(directory, 'migrations', name), {
          recursive: true,
        });
      }
      writeFileSync(
        resolve(directory, 'migrations/migration_lock.toml'),
        'provider = "postgresql"',
      );
      writeFileSync(
        resolve(directory, 'schema.prisma'),
        'datasource db {\n provider = "postgresql"\n}',
      );
      const url = new URL(databaseUrl ?? '');
      url.searchParams.set('schema', schema);
      writeFileSync(
        resolve(directory, 'prisma.config.ts'),
        `export default {
        schema: ${JSON.stringify(resolve(directory, 'schema.prisma'))},
        migrations: { path: ${JSON.stringify(resolve(directory, 'migrations'))} },
        datasource: { url: ${JSON.stringify(url.toString())} }
      };`,
      );
      for (const args of [['resolve', '--applied', baseline], ['deploy']]) {
        execFileSync(
          resolve(import.meta.dirname, '../node_modules/.bin/prisma'),
          ['migrate', ...args, '--config', resolve(directory, 'prisma.config.ts')],
          {
            encoding: 'utf8',
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 25000,
          },
        );
      }
      expect(query('SELECT count(*) FROM "User" WHERE "tenantId" IS NULL')).toBe('0');
      expect(query(`SELECT "tenantId" FROM "User" WHERE id = 'single'`)).toBe('single_org');
      expect(query('SELECT count(DISTINCT transaction_id) FROM normalized_transactions')).toBe('2');
      expect(query(`SELECT count(*) FROM "User" WHERE email <> lower(trim(email))`)).toBe('0');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60000);
});
