import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { releaseFingerprint } from './release-fingerprint.mjs';

// Shared by the publish preparer and the isolated tarball gate. No registry access.
export async function verifyReleaseCandidate() {
  const directory = fileURLToPath(new URL('../', import.meta.url));
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  const fingerprint = await releaseFingerprint();
  const revision = JSON.parse(
    await readFile(resolve(directory, 'dist-owned/contract-revision.json'), 'utf8'),
  );
  assert.equal(revision.sourceSha256, fingerprint, 'Candidate is stale; rebuild before packaging');
  const binary = resolve(directory, 'dist-owned/bin/mcp-server.js');
  const result = await promisify(execFile)(process.execPath, [binary, '--version'], {
    env: { PATH: process.env.PATH ?? '' },
    timeout: 10000,
  });
  assert.equal(result.stdout.trim(), pkg.version, 'Candidate binary version is stale');
  const binarySha256 = createHash('sha256')
    .update(await readFile(binary))
    .digest('hex');
  return { directory, pkg, fingerprint, binarySha256 };
}

export async function stageRelease({ output }) {
  const { directory, pkg, fingerprint, binarySha256 } = await verifyReleaseCandidate();
  // Fail rather than overwrite any existing output directory.
  await mkdir(output);
  await cp(resolve(directory, 'dist-owned/bin'), resolve(output, 'bin'), { recursive: true });
  for (const path of ['manifest.json', 'tool-names.json', 'contract-revision.json'])
    await cp(resolve(directory, 'dist-owned', path), resolve(output, path));
  await cp(resolve(directory, 'README.md'), resolve(output, 'README.md'));
  await writeFile(
    resolve(output, 'package.json'),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        author: pkg.author,
        repository: pkg.repository,
        type: 'module',
        engines: { node: '>=22' },
        bin: Object.fromEntries(Object.keys(pkg.bin).map((alias) => [alias, 'bin/mcp-server.js'])),
        files: ['bin/mcp-server.js', 'manifest.json', 'tool-names.json', 'contract-revision.json'],
        opencompRelease: { sourceSha256: fingerprint, binarySha256 },
      },
      null,
      2,
    ),
  );
  return { fingerprint, binarySha256 };
}
