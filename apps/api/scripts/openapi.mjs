import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (!['check', 'write'].includes(mode))
  throw new Error('Expected check or write');
const config = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).jest;
config.setupFiles = ['<rootDir>/../test/openapi-export.setup.ts'];
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/jest/bin/jest.js', import.meta.url)),
    '--config',
    JSON.stringify(config),
    '--runInBand',
    'src/openapi-export.spec.ts',
  ],
  {
    cwd: directory,
    // No .env, production credentials, DB, background task registration or API boot.
    env: { PATH: process.env.PATH ?? '', OPENAPI_EXPORT_MODE: mode },
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
