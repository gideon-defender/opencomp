#!/usr/bin/env node
/**
 * Generates a prisma-client-js client to populate @prisma/client at node_modules.
 * Creates a temp schema dir, copies model files, generates with prisma-client-js.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '..');
const schemaDir = path.join(root, 'prisma/schema');
const configPath = path.join(root, 'prisma.config.ts');
const configBackup = configPath + '.bak';
const tempDir = fs.mkdtempSync(path.join(root, '.prisma-clientjs-'));

// Hide prisma.config.ts so prisma doesn't try to load it
const hasConfig = fs.existsSync(configPath);
if (hasConfig) fs.renameSync(configPath, configBackup);

try {
  // Copy model files
  for (const file of fs
    .readdirSync(schemaDir)
    .filter((f) => f.endsWith('.prisma') && f !== 'schema.prisma')) {
    fs.copyFileSync(path.join(schemaDir, file), path.join(tempDir, file));
  }

  // Write prisma-client-js generator schema
  fs.writeFileSync(
    path.join(tempDir, 'schema.prisma'),
    `generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  extensions = [pgcrypto]
}
`,
  );

  // Resolve the prisma CLI. ESM `import.meta.resolve` ignores NODE_PATH, but
  // the production image relies on NODE_PATH=/app/apps/api/node_modules (prisma
  // is a dev-only dep there and lives outside packages/db). Try the import
  // resolver first, then each NODE_PATH entry so both layouts work.
  const prismaCli = resolvePrismaCli();

  execFileSync(process.execPath, [prismaCli, 'generate', `--schema=${tempDir}`], {
    stdio: 'inherit',
    cwd: root,
  });
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (hasConfig && fs.existsSync(configBackup)) fs.renameSync(configBackup, configPath);
}

function resolvePrismaCli() {
  const candidates = [];

  try {
    candidates.push(path.dirname(fileURLToPath(import.meta.resolve('prisma/package.json'))));
  } catch {
    // Not resolvable via ESM (e.g. hoisted under NODE_PATH) — fall through.
  }

  for (const base of (process.env.NODE_PATH ?? '').split(path.delimiter)) {
    if (base) candidates.push(path.join(base, 'prisma'));
  }

  for (const pkgDir of candidates) {
    const cli = path.join(pkgDir, 'build', 'index.js');
    if (fs.existsSync(cli)) return cli;
  }

  throw new Error('Unable to locate the prisma CLI. Checked: ' + candidates.join(', '));
}
