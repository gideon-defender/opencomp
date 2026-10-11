import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { stageRelease } from '../../scripts/release-stage.mjs';
import { withHttp, withStdio } from '../compatibility/processes.mjs';
import {
  availablePort,
  childEnvironment,
  startMockApi,
  toolText,
  withClientTransport,
} from '../runtime.mjs';
import { baseline } from '../runtime/fixtures.mjs';

test(
  'the publish tarball installs offline in isolation and exposes only the bundled contract and entry points',
  { timeout: 90000 },
  async () => {
    const directory = await realpath(await mkdtemp(resolve(tmpdir(), 'opencomp-phase5-')));
    const stage = resolve(directory, 'stage');
    const consumer = resolve(directory, 'consumer');
    const exec = promisify(execFile);
    const options = { env: childEnvironment(), timeout: 30000 };
    try {
      const release = await stageRelease({ output: stage });
      await assert.rejects(stageRelease({ output: stage }), { code: 'EEXIST' });
      await exec('pnpm', ['pack', '--pack-destination', directory], { ...options, cwd: stage });
      const pkg = JSON.parse(await readFile(resolve(stage, 'package.json'), 'utf8'));
      const tarball = resolve(directory, `gideon-defender-mcp-server-${pkg.version}.tgz`);
      const contents = (await exec('tar', ['-tzf', tarball], options)).stdout.trim().split('\n');
      assert.deepEqual(
        contents.sort(),
        [
          'package/README.md',
          'package/bin/mcp-server.js',
          'package/contract-revision.json',
          'package/manifest.json',
          'package/package.json',
          'package/tool-names.json',
        ].sort(),
      );
      await mkdir(consumer);
      await writeFile(resolve(consumer, 'package.json'), JSON.stringify({ private: true }));
      // Empty dedicated store + offline mode make undeclared runtime dependencies fail.
      await exec(
        'pnpm',
        [
          'add',
          tarball,
          '--offline',
          '--ignore-scripts',
          '--store-dir',
          resolve(directory, 'store'),
        ],
        { ...options, cwd: consumer },
      );
      const installed = resolve(consumer, 'node_modules/@gideon-defender/mcp-server');
      const metadata = JSON.parse(await readFile(resolve(installed, 'package.json'), 'utf8'));
      assert.equal(metadata.dependencies, undefined);
      assert.equal(metadata.scripts, undefined);
      assert.deepEqual(metadata.opencompRelease, {
        sourceSha256: release.fingerprint,
        binarySha256: release.binarySha256,
      });
      const binary = resolve(installed, 'bin/mcp-server.js');
      assert.equal(
        createHash('sha256')
          .update(await readFile(binary))
          .digest('hex'),
        release.binarySha256,
      );
      const revision = JSON.parse(
        await readFile(resolve(installed, 'contract-revision.json'), 'utf8'),
      );
      assert.equal(revision.sourceSha256, release.fingerprint);
      assert.equal(revision.tools, baseline.tools.length);
      // Resolution from the consumer must not find the repo's SDK, tsx or spec.
      await exec(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      const require = createRequire(process.cwd() + '/package.json');
      for (const name of ['@modelcontextprotocol/sdk', 'tsx', '@gideon-defender/db'])
        assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' });
    `,
        ],
        { ...options, cwd: consumer },
      );
      const isolatedEnv = { NODE_OPTIONS: `--permission --allow-fs-read=${consumer}` };
      const runtimeOptions = { ...options, env: childEnvironment(isolatedEnv), cwd: consumer };
      await exec(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
        import assert from 'node:assert/strict';
        import { readFileSync } from 'node:fs';
        assert.throws(() => readFileSync(process.argv[1]), { code: 'ERR_ACCESS_DENIED' });
      `,
          fileURLToPath(new URL('../../../../packages/docs/openapi.json', import.meta.url)),
        ],
        runtimeOptions,
      );
      for (const alias of ['mcp', 'mcp-server']) {
        const entry = resolve(consumer, 'node_modules/.bin', alias);
        assert.equal((await exec(entry, ['--version'], runtimeOptions)).stdout.trim(), pkg.version);
        assert.match((await exec(entry, ['--help'], runtimeOptions)).stdout, /server-index/);
      }
      const mock = await startMockApi();
      try {
        for (const mode of ['static', 'dynamic'])
          await withStdio({
            entrypoint: binary,
            env: isolatedEnv,
            cwd: consumer,
            apiUrl: mock.url,
            args: mode === 'dynamic' ? ['start', '--mode', 'dynamic'] : ['start'],
            run: async (client) => {
              if (mode === 'static') {
                assert.deepEqual(
                  (await client.listTools()).tools.map((tool) => tool.name).sort(),
                  baseline.tools.map((tool) => tool.name).sort(),
                );
                assert.equal(
                  toolText(await client.callTool({ name: 'get-tasks', arguments: {} })),
                  '{"phase0Mock":true}',
                );
                return;
              }
              assert.deepEqual(
                (await client.listTools()).tools.map((tool) => tool.name),
                ['list_tools', 'describe_tool_input', 'execute_tool'],
              );
              assert.equal(
                JSON.parse(toolText(await client.callTool({ name: 'list_tools', arguments: {} })))
                  .length,
                baseline.tools.length,
              );
              assert.equal(
                toolText(
                  await client.callTool({ name: 'execute_tool', arguments: { name: 'get-tasks' } }),
                ),
                '{"phase0Mock":true}',
              );
            },
          });
        for (const kind of ['sse', 'streamable'])
          await withHttp({
            entrypoint: binary,
            env: isolatedEnv,
            cwd: consumer,
            apiUrl: mock.url,
            port: await availablePort(),
            args:
              kind === 'sse'
                ? ['start', '--transport', 'sse', '--tool', 'get-tasks']
                : ['serve', '--tool', 'get-tasks'],
            run: async (url) => {
              await withClientTransport({
                transport:
                  kind === 'sse'
                    ? new SSEClientTransport(new URL(`${url}/sse`))
                    : new StreamableHTTPClientTransport(new URL(`${url}/mcp`)),
                run: async (client) => {
                  assert.deepEqual(
                    (await client.listTools()).tools.map((tool) => tool.name),
                    ['get-tasks'],
                  );
                  assert.equal(
                    toolText(await client.callTool({ name: 'get-tasks', arguments: {} })),
                    '{"phase0Mock":true}',
                  );
                },
              });
            },
          });
        assert.equal(mock.requests.length, 4);
        assert(mock.requests.every((request) => request.method === 'GET'));
      } finally {
        await mock.close();
      }
    } finally {
      // Only the isolated fixture created by this test, never a repository path.
      await rm(directory, { recursive: true, force: true });
    }
  },
);
