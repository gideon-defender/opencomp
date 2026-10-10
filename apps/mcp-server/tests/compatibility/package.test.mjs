import { unpackExtension } from '@anthropic-ai/mcpb';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { releaseFingerprint } from '../../scripts/release-fingerprint.mjs';
import { childEnvironment, startMockApi, toolText } from '../runtime.mjs';
import { baseline } from '../runtime/fixtures.mjs';
import { withStdio } from './processes.mjs';

test(
  'owned build is deterministic, manifest/names/revision match, and unpacked mcpb works without repository data/dependencies',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'opencomp-phase3-package-'));
    const candidate = resolve(directory, 'candidate');
    const unpacked = resolve(directory, 'unpacked');
    const packageDir = fileURLToPath(new URL('../../', import.meta.url));
    const exec = promisify(execFile);
    const options = { cwd: packageDir, env: childEnvironment(), timeout: 30000 };
    try {
      const args = ['--import', 'tsx', 'scripts/build-owned.mjs', '--out-dir', candidate];
      await exec(process.execPath, args, options);
      const first = await readFile(resolve(candidate, 'bin/mcp-server.js'));
      await exec(process.execPath, [...args, '--pack'], options);
      const second = await readFile(resolve(candidate, 'bin/mcp-server.js'));
      assert.equal(
        createHash('sha256').update(second).digest('hex'),
        createHash('sha256').update(first).digest('hex'),
        'Repeated candidate builds must be byte-identical',
      );
      const manifest = JSON.parse(await readFile(resolve(candidate, 'manifest.json'), 'utf8'));
      const names = JSON.parse(await readFile(resolve(candidate, 'tool-names.json'), 'utf8'));
      const revision = JSON.parse(
        await readFile(resolve(candidate, 'contract-revision.json'), 'utf8'),
      );
      assert.deepEqual(manifest.tools, names);
      assert.deepEqual(
        names.map((tool) => tool.name).sort(),
        baseline.tools.map((tool) => tool.name).sort(),
      );
      for (const tool of names)
        assert.equal(
          tool.description,
          baseline.tools.find((old) => old.name === tool.name).description,
        );
      const spec = await readFile(resolve(packageDir, '../../packages/docs/openapi.json'));
      assert.equal(revision.specSha256, createHash('sha256').update(spec).digest('hex'));
      const overlay = await readFile(resolve(packageDir, 'mcp-overlay.yaml'));
      assert.equal(revision.overlaySha256, createHash('sha256').update(overlay).digest('hex'));
      assert.equal(revision.tools, 412);
      assert.equal(revision.sourceSha256, await releaseFingerprint());
      assert.equal(
        await unpackExtension({ mcpbPath: `${candidate}.mcpb`, outputDir: unpacked, silent: true }),
        true,
      );
      const binary = resolve(unpacked, manifest.server.entry_point);
      assert.equal(
        (
          await exec(process.execPath, [binary, '--version'], { ...options, cwd: unpacked })
        ).stdout.trim(),
        manifest.version,
      );
      const mock = await startMockApi();
      try {
        await withStdio({
          apiUrl: mock.url,
          entrypoint: binary,
          run: async (client) => {
            assert.equal((await client.listTools()).tools.length, 412);
            assert.equal(
              toolText(await client.callTool({ name: 'get-tasks', arguments: {} })),
              '{"phase0Mock":true}',
            );
          },
        });
      } finally {
        await mock.close();
      }
    } finally {
      // Only this test's mkdtemp-created fixture directory; never package/repo roots.
      await rm(directory, { recursive: true, force: true });
    }
  },
);
