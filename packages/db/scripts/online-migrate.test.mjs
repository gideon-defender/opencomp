import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runStagedMigration } from './staged-migrate.mjs';
import { CONTRACT_START, planTenantMigrations } from './tenant-migration-state.mjs';

test('online migration applies compatible pending migrations without approval flags', async () => {
  const root = mkdtempSync(join(tmpdir(), 'online-migrate-test-'));
  const source = join(root, 'packages/db/dist/migrations');
  const rename = '20261015000000_oidc_column_rename';
  const env = { DATABASE_URL: 'postgres://localhost/db?options=-c%20statement_timeout%3D30000' };
  try {
    for (const name of [rename, '20261016000000_add_optional_column']) {
      mkdirSync(join(source, name), { recursive: true });
    }
    const calls = [];
    await runStagedMigration({
      phase: 'online', root, env,
      readState: async () => ({ history: [{ name: rename, finished: true }], schema: {} }),
      execute: (call) => calls.push(call),
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ['migrate', 'deploy']);
    assert.equal(calls[0].env.DATABASE_URL, env.DATABASE_URL);
    assert.equal(calls[0].env.PRISMA_MIGRATIONS_PATH, source);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('online migration rejects pending maintenance migrations before any Prisma command', async () => {
  const root = mkdtempSync(join(tmpdir(), 'online-maintenance-test-'));
  const source = join(root, 'packages/db/dist/migrations');
  try {
    mkdirSync(join(source, CONTRACT_START), { recursive: true });
    const calls = [];
    await assert.rejects(runStagedMigration({
      phase: 'online', root,
      env: { DATABASE_URL: 'postgres://localhost/db' },
      readState: async () => ({ history: [], schema: {} }),
      execute: (call) => calls.push(call),
    }), /requires offline_migrations=true/);
    assert.equal(calls.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('online migration never automatically recovers a failed migration', () => {
  assert.throws(() => planTenantMigrations({
    phase: 'online',
    history: [{ name: CONTRACT_START, finished: false, rolledBack: false, steps: 0 }],
    schema: { legacyEmailKey: true, nullableTenant: true },
  }), /inspection/);
});

test('every known maintenance migration requires a drain unless already applied', () => {
  for (const name of [
    CONTRACT_START,
    '20261013000005_user_tenant_validate',
    '20261013000006_user_tenant_session_cleanup',
    '20261015000000_oidc_column_rename',
  ]) {
    assert.throws(() => planTenantMigrations({
      phase: 'online', history: [], schema: {}, migrationNames: [name],
    }), /requires offline_migrations=true/);
    assert.equal(planTenantMigrations({
      phase: 'online', history: [{ name, finished: true }], schema: {}, migrationNames: [name],
    }).expansionOnly, false);
  }
});
