import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function releaseFingerprint() {
  const directory = fileURLToPath(new URL('../', import.meta.url));
  const hash = createHash('sha256');
  async function add(path) {
    const entries = await readdir(resolve(directory, path), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${path}/${entry.name}`;
      if (entry.isDirectory()) await add(name);
      else hash.update(name).update(await readFile(resolve(directory, name)));
    }
  }
  for (const path of ['package.json', 'manifest.json']) {
    const { version: _version, ...unversioned } = JSON.parse(
      await readFile(resolve(directory, path), 'utf8'),
    );
    hash.update(path).update(JSON.stringify(unversioned));
  }
  for (const path of ['src', 'scripts']) await add(path);
  for (const path of [
    'mcp-overlay.yaml',
    'tsconfig.json',
    '../../packages/docs/openapi.json',
    '../../pnpm-lock.yaml',
    '../../package.json',
    '../../pnpm-workspace.yaml',
    '../../.github/workflows/mcp-check.yml',
    '../../.github/workflows/sdk_publish.yaml',
  ]) {
    hash.update(path).update(await readFile(resolve(directory, path)));
  }
  return hash.digest('hex');
}
