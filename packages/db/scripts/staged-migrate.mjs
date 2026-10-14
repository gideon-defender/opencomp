import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  approveContractUrl,
  CONTRACT_START,
  planTenantMigrations,
} from './tenant-migration-state.mjs';

export async function readMigrationState() {
  const require = createRequire(import.meta.url);
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const [table] =
      await client.$queryRaw`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`;
    if (!table.present) return { history: [], schema: {} };
    const history = await client.$queryRaw`
      SELECT migration_name AS name, finished_at IS NOT NULL AS finished,
        rolled_back_at IS NOT NULL AS "rolledBack", applied_steps_count AS steps, logs
      FROM "_prisma_migrations" ORDER BY started_at`;
    const [schema] = await client.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE i.indrelid = to_regclass('public."User"')
          AND c.relname = 'User_email_key' AND i.indisunique AND i.indisvalid
      ) AS "legacyEmailKey", EXISTS (
        SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public."User"')
          AND attname = 'tenantId' AND NOT attnotnull AND NOT attisdropped
      ) AS "nullableTenant"`;
    return { history, schema };
  } finally {
    await client.$disconnect();
  }
}

function runPrisma({ args, env, root }) {
  const result = spawnSync(join(root, 'node_modules/.bin/prisma'), args, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0)
    throw new Error(`Prisma ${args[1]} failed; inspect the migration task logs`);
}

export async function runStagedMigration({
  phase,
  root = process.cwd(),
  env = process.env,
  readState = readMigrationState,
  execute = runPrisma,
}) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const plan = planTenantMigrations({ phase, ...(await readState()) });
  for (const name of plan.recover) {
    console.log(`Recovering rolled-back tenant migration ${name}`);
    execute({ args: ['migrate', 'resolve', '--rolled-back', name], env, root });
  }
  const source = join(root, 'packages/db/dist/migrations');
  let temporary;
  try {
    let migrationsPath = source;
    if (plan.expansionOnly) {
      temporary = mkdtempSync(join(tmpdir(), 'opencomp-expand-'));
      migrationsPath = temporary;
      for (const entry of readdirSync(source, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name >= CONTRACT_START) continue;
        cpSync(join(source, entry.name), join(temporary, entry.name), { recursive: true });
      }
    }
    const commandEnv = { ...env, PRISMA_MIGRATIONS_PATH: migrationsPath };
    if (phase === 'contract') commandEnv.DATABASE_URL = approveContractUrl(env.DATABASE_URL);
    console.log(`Applying ${phase} migrations`);
    execute({ args: ['migrate', 'deploy'], env: commandEnv, root });
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runStagedMigration({ phase: process.argv[2] }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
