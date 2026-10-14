import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.USER_TENANT_TEST_DATABASE_URL;
const migrationName = '20261013000004_user_tenant_enforce';
const sql = readFileSync(
  resolve(import.meta.dirname, `../prisma/migrations/${migrationName}/migration.sql`),
  'utf8',
);
const gateEnd = sql.indexOf('-- Re-normalize expand-window writes');

describe.skipIf(!databaseUrl)('Prisma tenant approval rejection and recovery', () => {
  it('requires resolving the failed gate before the approved retry can proceed', () => {
    const schema = `approval_recovery_${randomUUID().replaceAll('-', '')}`;
    const directory = mkdtempSync(resolve(tmpdir(), 'tenant-approval-'));
    const query = (statement: string) =>
      execFileSync(
        process.env.PSQL_BIN ?? 'psql',
        [databaseUrl ?? '', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
    const url = new URL(databaseUrl ?? '');
    url.searchParams.set('schema', schema);
    const configPath = resolve(directory, 'prisma.config.ts');
    const writeConfig = () =>
      writeFileSync(
        configPath,
        `export default {
      schema: ${JSON.stringify(resolve(directory, 'schema.prisma'))},
      migrations: { path: ${JSON.stringify(resolve(directory, 'migrations'))} },
      datasource: { url: ${JSON.stringify(url.toString())} }
    };`,
      );
    const migrate = (args: string[]) =>
      spawnSync(
        resolve(import.meta.dirname, '../node_modules/.bin/prisma'),
        ['migrate', ...args, '--config', configPath],
        { encoding: 'utf8', env: process.env, timeout: 25000 },
      );
    try {
      query(`CREATE SCHEMA "${schema}";
        CREATE TABLE "${schema}"."User" (id TEXT PRIMARY KEY);
        INSERT INTO "${schema}"."User" VALUES ('existing');`);
      writeFileSync(
        resolve(directory, 'schema.prisma'),
        'datasource db {\n provider = "postgresql"\n}',
      );
      mkdirSync(resolve(directory, 'migrations/00000000000000_fixture'), { recursive: true });
      mkdirSync(resolve(directory, `migrations/${migrationName}`), { recursive: true });
      writeFileSync(
        resolve(directory, 'migrations/migration_lock.toml'),
        'provider = "postgresql"',
      );
      writeFileSync(
        resolve(directory, 'migrations/00000000000000_fixture/migration.sql'),
        'SELECT 1;',
      );
      expect(gateEnd).toBeGreaterThan(0);
      writeFileSync(
        resolve(directory, `migrations/${migrationName}/migration.sql`),
        `${sql.slice(0, gateEnd)}\nCOMMIT;\nCREATE TABLE contract_completed (id TEXT);`,
      );
      writeConfig();
      expect(migrate(['resolve', '--applied', '00000000000000_fixture']).status).toBe(0);
      const rejected = migrate(['deploy']);
      expect(rejected.status).not.toBe(0);
      expect(
        query(
          `SELECT count(*) FROM "${schema}"._prisma_migrations WHERE migration_name = '${migrationName}' AND finished_at IS NULL AND rolled_back_at IS NULL`,
        ),
      ).toBe('1');
      url.searchParams.set('options', '-c app.tenant_contract_approved=yes');
      writeConfig();
      const blocked = migrate(['deploy']);
      expect(blocked.status).not.toBe(0);
      expect(blocked.stdout + blocked.stderr).toContain('P3009');
      expect(migrate(['resolve', '--rolled-back', migrationName]).status).toBe(0);
      const approved = migrate(['deploy']);
      expect(approved.status, approved.stdout + approved.stderr).toBe(0);
      expect(
        query(
          `SELECT count(*) FROM "${schema}"._prisma_migrations WHERE migration_name = '${migrationName}' AND finished_at IS NOT NULL`,
        ),
      ).toBe('1');
      expect(query(`SELECT to_regclass('${schema}.contract_completed') IS NOT NULL`)).toBe('t');
    } finally {
      query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120000);
});
