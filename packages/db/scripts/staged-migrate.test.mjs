import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStagedMigration } from './staged-migrate.mjs';
import {
  approveContractUrl,
  CONTRACT_END,
  CONTRACT_START,
  planTenantMigrations,
} from './tenant-migration-state.mjs';

const failedGate = {
  name: CONTRACT_START,
  steps: 0,
  logs: null,
  finished: false,
  rolledBack: false,
};
const expanded = { legacyEmailKey: true, nullableTenant: true };

test('CLI invocation actually runs the driver and rejects missing configuration', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./staged-migrate.mjs', import.meta.url)), 'expand'],
    { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DATABASE_URL is required/);
});

test('recovers the observed aborted transaction only before contract DDL commits', () => {
  assert.deepEqual(
    planTenantMigrations({ phase: 'expand', history: [failedGate], schema: expanded }),
    { recover: [CONTRACT_START], expansionOnly: true },
  );
  for (const schema of [
    { ...expanded, nullableTenant: false },
    { ...expanded, legacyEmailKey: false },
  ]) {
    assert.throws(
      () => planTenantMigrations({ phase: 'expand', history: [failedGate], schema }),
      /inspection/,
    );
  }
});

test('never clears unrelated failures, partial steps, or ambiguous validation failures', () => {
  for (const row of [
    { ...failedGate, name: 'unrelated_migration' },
    { ...failedGate, steps: 1 },
    { ...failedGate, name: '20261013000005_user_tenant_validate', logs: 'invalid data' },
  ]) {
    assert.throws(
      () => planTenantMigrations({ phase: 'expand', history: [row], schema: expanded }),
      /inspection/,
    );
  }
});

test('recovers explicit later approval rejections and ignores old rolled-back attempts', () => {
  const validation = {
    ...failedGate,
    name: '20261013000005_user_tenant_validate',
    logs: 'user tenant contract: validation phase is not approved.',
  };
  assert.deepEqual(
    planTenantMigrations({ phase: 'contract', history: [validation], schema: {} }).recover,
    [validation.name],
  );
  assert.deepEqual(
    planTenantMigrations({
      phase: 'expand',
      history: [{ ...failedGate, rolledBack: true }],
      schema: {},
    }).recover,
    [],
  );
});

test('normal future deploys apply all migrations once the tenant contract is complete', () => {
  assert.equal(
    planTenantMigrations({
      phase: 'expand',
      history: [{ name: CONTRACT_END, finished: true }],
      schema: {},
    }).expansionOnly,
    false,
  );
});

test('contract approval preserves other connection options without modifying the original URL', () => {
  const original =
    'postgres://user:password@localhost/db?sslmode=require&options=-c%20statement_timeout%3D30000';
  const approved = new URL(approveContractUrl(original));
  assert.equal(approved.searchParams.get('sslmode'), 'require');
  assert.equal(
    approved.searchParams.get('options'),
    '-c statement_timeout=30000 -c app.tenant_contract_approved=yes',
  );
  assert.equal(new URL(original).searchParams.get('options'), '-c statement_timeout=30000');
});

test('expansion preserves SQL bytes, excludes contract and later files, and resolves before deploy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'staged-migrate-test-'));
  const source = join(root, 'packages/db/dist/migrations');
  const expandName = '20261013000003_user_tenant_lookup_index';
  const env = { DATABASE_URL: 'postgres://localhost/db' };
  try {
    for (const name of [expandName, CONTRACT_START, CONTRACT_END, '20261015000000_future']) {
      mkdirSync(join(source, name), { recursive: true });
      writeFileSync(join(source, name, 'migration.sql'), `-- unchanged ${name}\n`);
    }
    writeFileSync(join(source, 'migration_lock.toml'), 'provider = "postgresql"\n');
    const calls = [];
    await runStagedMigration({
      phase: 'expand',
      root,
      env,
      readState: async () => ({ history: [failedGate], schema: expanded }),
      execute: (call) => {
        calls.push(call.args);
        if (call.args[1] !== 'deploy') return;
        assert.deepEqual(readdirSync(call.env.PRISMA_MIGRATIONS_PATH).sort(), [
          expandName,
          'migration_lock.toml',
        ]);
        assert.equal(
          readFileSync(join(call.env.PRISMA_MIGRATIONS_PATH, expandName, 'migration.sql'), 'utf8'),
          readFileSync(join(source, expandName, 'migration.sql'), 'utf8'),
        );
        assert.equal(call.env.DATABASE_URL, env.DATABASE_URL);
      },
    });
    assert.deepEqual(calls, [
      ['migrate', 'resolve', '--rolled-back', CONTRACT_START],
      ['migrate', 'deploy'],
    ]);
    assert.equal(readdirSync(source).length, 5);
    await runStagedMigration({
      phase: 'contract',
      root,
      env,
      readState: async () => ({ history: [], schema: expanded }),
      execute: (call) => {
        assert.equal(call.env.PRISMA_MIGRATIONS_PATH, source);
        assert.equal(
          new URL(call.env.DATABASE_URL).searchParams.get('options'),
          '-c app.tenant_contract_approved=yes',
        );
      },
    });
    assert.equal(env.DATABASE_URL, 'postgres://localhost/db');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
