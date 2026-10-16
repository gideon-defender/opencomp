import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readMigrationState, runStagedMigration } from './staged-migrate.mjs';
import { CONTRACT_END, CONTRACT_START } from './tenant-migration-state.mjs';

const adminUrl = process.env.STAGED_MIGRATION_TEST_DATABASE_URL;
test(
  'real Prisma recovers an aborted gate, deploys expansion only, then completes contract',
  { skip: !adminUrl, timeout: 60_000 },
  async () => {
    const database = `staged_test_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(adminUrl);
    url.pathname = `/${database}`;
    const root = mkdtempSync(join(tmpdir(), 'staged-runtime-test-'));
    const migrations = join(root, 'packages/db/dist/migrations');
    const config = join(root, 'prisma.config.ts');
    const schema = join(root, 'schema.prisma');
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const prisma = join(packageRoot, 'node_modules/.bin/prisma');
    const originalUrl = process.env.DATABASE_URL;
    const runSql = ({ connection, sql }) => {
      const result = spawnSync(
        process.env.PSQL_BIN || 'psql',
        [connection, '-v', 'ON_ERROR_STOP=1', '-c', sql],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stderr);
    };
    runSql({ connection: adminUrl, sql: `CREATE DATABASE "${database}"` });
    try {
      process.env.DATABASE_URL = url.toString();
      const scripts = new Map([
        [
          '20261013000003_user_tenant_lookup_index',
          `
          CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT UNIQUE, "tenantId" TEXT);
          INSERT INTO "User" VALUES ('usr_1', 'user@example.com', 'org_1');`,
        ],
        [
          CONTRACT_START,
          `BEGIN;
          DO $$ BEGIN
            IF current_setting('app.tenant_contract_approved', true) IS DISTINCT FROM 'yes' THEN
              RAISE EXCEPTION 'user tenant contract: contract phase is not approved';
            END IF;
          END $$;
          ALTER TABLE "User" DROP CONSTRAINT "User_email_key";
          ALTER TABLE "User" ALTER COLUMN "tenantId" SET NOT NULL;
          COMMIT;`,
        ],
        ['20261013000005_user_tenant_validate', 'SELECT 1;'],
        [CONTRACT_END, 'SELECT 1;'],
      ]);
      for (const [name, sql] of scripts) {
        mkdirSync(join(migrations, name), { recursive: true });
        writeFileSync(join(migrations, name, 'migration.sql'), sql);
      }
      writeFileSync(join(migrations, 'migration_lock.toml'), 'provider = "postgresql"\n');
      writeFileSync(
        schema,
        'datasource db {\n provider = "postgresql"\n}\nmodel User {\n id String @id\n email String\n tenantId String?\n}\n',
      );
      writeFileSync(
        config,
        `export default {schema: ${JSON.stringify(schema)},
        migrations: {path: process.env.PRISMA_MIGRATIONS_PATH || ${JSON.stringify(migrations)}},
        datasource: {url: process.env.DATABASE_URL}};`,
      );
      const execute = ({ args, env }) => {
        const result = spawnSync(prisma, [...args, '--config', config], {
          cwd: root,
          env,
          encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
      };
      const failed = spawnSync(prisma, ['migrate', 'deploy', '--config', config], {
        cwd: root,
        env: process.env,
        encoding: 'utf8',
      });
      assert.notEqual(failed.status, 0, 'Unapproved contract must fail');
      assert.equal(
        (await readMigrationState()).history.some(
          (row) => row.name === CONTRACT_START && !row.finished,
        ),
        true,
      );
      await runStagedMigration({ phase: 'expand', root, execute });
      const expanded = await readMigrationState();
      assert.equal(
        expanded.history.some((row) => row.name === CONTRACT_START && row.rolledBack),
        true,
      );
      assert.deepEqual(expanded.schema, { legacyEmailKey: true, nullableTenant: true });
      await runStagedMigration({ phase: 'contract', root, execute });
      const contracted = await readMigrationState();
      assert.equal(
        contracted.history.some((row) => row.name === CONTRACT_END && row.finished),
        true,
      );
      assert.deepEqual(contracted.schema, { legacyEmailKey: false, nullableTenant: false });
      await runStagedMigration({ phase: 'expand', root, execute });
    } finally {
      if (originalUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalUrl;
      runSql({ connection: adminUrl, sql: `DROP DATABASE "${database}" WITH (FORCE)` });
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'offline Prisma deploy approves the real rename and preserves existing identity data',
  { skip: !adminUrl, timeout: 60_000 },
  async () => {
    const database = `offline_test_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(adminUrl);
    url.pathname = `/${database}`;
    const root = mkdtempSync(join(tmpdir(), 'offline-runtime-test-'));
    const migrations = join(root, 'packages/db/dist/migrations');
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const config = join(root, 'prisma.config.ts');
    const runSql = ({ connection = url.toString(), sql }) => {
      const result = spawnSync(
        process.env.PSQL_BIN || 'psql',
        [connection, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    runSql({ connection: adminUrl, sql: `CREATE DATABASE "${database}"` });
    try {
      const scripts = new Map([
        [
          '00000000000000_fixture',
          `
          CREATE TABLE "User" (id TEXT PRIMARY KEY, "gideonSub" TEXT UNIQUE, "gideonTenantId" TEXT);
          CREATE TABLE "Session" (id TEXT PRIMARY KEY, "gideonRefreshToken" TEXT);
          INSERT INTO "User" VALUES ('user', 'subject', 'tenant');
          INSERT INTO "Session" VALUES ('session', 'refresh-token');`,
        ],
        [
          CONTRACT_START,
          `DO $$ BEGIN
          IF current_setting('app.tenant_contract_approved', true) IS DISTINCT FROM 'yes' THEN
            RAISE EXCEPTION 'tenant contract must be approved';
          END IF;
        END $$;`,
        ],
        [
          '20261015000000_oidc_column_rename',
          readFileSync(
            join(packageRoot, 'prisma/migrations/20261015000000_oidc_column_rename/migration.sql'),
            'utf8',
          ),
        ],
      ]);
      for (const [name, sql] of scripts) {
        mkdirSync(join(migrations, name), { recursive: true });
        writeFileSync(join(migrations, name, 'migration.sql'), sql);
      }
      writeFileSync(join(migrations, 'migration_lock.toml'), 'provider = "postgresql"\n');
      const schema = join(root, 'schema.prisma');
      writeFileSync(schema, 'datasource db {\n provider = "postgresql"\n}');
      writeFileSync(
        config,
        `export default {schema: ${JSON.stringify(schema)},
        migrations: {path: process.env.PRISMA_MIGRATIONS_PATH},
        datasource: {url: process.env.DATABASE_URL}};`,
      );
      await runStagedMigration({
        phase: 'offline',
        root,
        env: { ...process.env, DATABASE_URL: url.toString() },
        readState: async () => ({ history: [], schema: {} }),
        execute: ({ args, env }) => {
          const result = spawnSync(
            join(packageRoot, 'node_modules/.bin/prisma'),
            [...args, '--config', config],
            { cwd: root, env, encoding: 'utf8' },
          );
          assert.equal(result.status, 0, result.stdout + result.stderr);
        },
      });
      assert.equal(
        runSql({ sql: 'SELECT "oidcSub", "oidcTenantId" FROM "User"' }),
        'subject|tenant',
      );
      assert.equal(runSql({ sql: 'SELECT "oidcRefreshToken" FROM "Session"' }), 'refresh-token');
      assert.equal(
        runSql({ sql: 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL' }),
        '3',
      );
    } finally {
      runSql({ connection: adminUrl, sql: `DROP DATABASE "${database}" WITH (FORCE)` });
      rmSync(root, { recursive: true, force: true });
    }
  },
);
