import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { parseDescriptions } from '../fixture.mjs';
import {
  FAKE_KEY,
  availablePort,
  childEnvironment,
  startMockApi,
  toolText,
  withClientTransport,
} from '../runtime.mjs';
import { baseline, registry } from '../runtime/fixtures.mjs';
import { binary, withHttp, withStdio } from './processes.mjs';

test(
  'bundled stdio lists all static contracts, supports dynamic discovery and has no prompts/resources/scopes',
  { timeout: 30000 },
  async () => {
    const mock = await startMockApi();
    try {
      await withStdio({
        apiUrl: mock.url,
        run: async (client) => {
          assert.equal(client.getServerCapabilities().prompts, undefined);
          assert.equal(client.getServerCapabilities().resources, undefined);
          const tools = (await client.listTools()).tools;
          assert.deepEqual(
            tools.map((tool) => tool.name).sort(),
            baseline.tools.map((tool) => tool.name).sort(),
          );
          for (const tool of tools) {
            const expected = registry.tools.find((candidate) => candidate.name === tool.name);
            assert.deepEqual(tool.inputSchema, expected.staticInputSchema);
            assert.deepEqual(tool.annotations, expected.annotations);
            assert.deepEqual(
              tool.execution,
              baseline.tools.find((candidate) => candidate.name === tool.name).execution,
            );
          }
          assert.equal(
            toolText(await client.callTool({ name: 'get-tasks', arguments: {} })),
            '{"phase0Mock":true}',
          );
        },
      });
      await withStdio({
        apiUrl: mock.url,
        args: ['start', '--mode', 'dynamic'],
        run: async (client) => {
          assert.deepEqual(
            (await client.listTools()).tools.map((tool) => tool.name),
            ['list_tools', 'describe_tool_input', 'execute_tool'],
          );
          const listed = JSON.parse(
            toolText(await client.callTool({ name: 'list_tools', arguments: {} })),
          );
          assert.equal(listed.length, 412);
          for (let offset = 0; offset < listed.length; offset += 25) {
            const names = listed.slice(offset, offset + 25).map((tool) => tool.name);
            const schemas = parseDescriptions({
              names,
              text: toolText(
                await client.callTool({
                  name: 'describe_tool_input',
                  arguments: { tool_names: names },
                }),
              ),
            });
            for (const name of names) {
              const tool = registry.tools.find((candidate) => candidate.name === name);
              assert.deepEqual(
                schemas[name],
                tool.plan.body || tool.plan.parameters.length
                  ? tool.inputSchema
                  : { noInputParameters: true },
              );
            }
          }
          assert.equal(
            toolText(
              await client.callTool({ name: 'execute_tool', arguments: { name: 'get-tasks' } }),
            ),
            '{"phase0Mock":true}',
          );
        },
      });
      assert.equal(mock.requests.length, 2);
      assert(mock.requests.every((request) => request.apiKey === FAKE_KEY));
    } finally {
      await mock.close();
    }
  },
);
test('allowlist, annotation filters, server-index, CLI credentials and --env overrides work in the binary', async () => {
  const mock = await startMockApi();
  try {
    await withStdio({
      apiUrl: mock.url,
      args: [
        'start',
        '--tool',
        'get-tasks',
        '--tool',
        'create-connection',
        '--tool-annotations',
        'readOnly,idempotent,openWorld',
        '--server-index',
        '0',
        '--apikey',
        'cli-fake',
      ],
      run: async (client) => {
        assert.deepEqual(
          (await client.listTools()).tools.map((tool) => tool.name),
          ['get-tasks'],
        );
        await client.callTool({ name: 'get-tasks', arguments: {} });
      },
    });
    await withStdio({
      apiUrl: mock.url,
      args: ['start', '--env', 'COMPAI_APIKEY=env-fake'],
      run: (client) => client.callTool({ name: 'get-tasks', arguments: {} }),
    });
    assert.deepEqual(
      mock.requests.map((request) => request.apiKey),
      ['cli-fake', 'env-fake'],
    );
  } finally {
    await mock.close();
  }
});
for (const transport of ['streamable', 'sse'])
  test(
    `${transport} SDK handshake, execution, header credential isolation and cleanup`,
    { timeout: 30000 },
    async () => {
      const mock = await startMockApi();
      try {
        await withHttp({
          port: await availablePort(),
          apiUrl: mock.url,
          args:
            transport === 'streamable'
              ? ['serve', '--disable-static-auth', '--tool', 'get-tasks']
              : ['start', '--transport', 'sse', '--tool', 'get-tasks'],
          run: async (url) => {
            await Promise.all(
              ['user-one', 'user-two'].map((key) =>
                withClientTransport({
                  transport:
                    transport === 'streamable'
                      ? new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
                          requestInit: { headers: { apikey: key } },
                        })
                      : new SSEClientTransport(new URL(`${url}/sse`), {
                          requestInit: { headers: { apikey: key } },
                          eventSourceInit: {
                            fetch: (url, init) =>
                              fetch(url, { ...init, headers: { ...init?.headers, apikey: key } }),
                          },
                        }),
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
                }),
              ),
            );
            assert.deepEqual(mock.requests.map((request) => request.apiKey).sort(), [
              'user-one',
              'user-two',
            ]);
            assert.equal((await fetch(url)).status, 200);
          },
        });
      } finally {
        await mock.close();
      }
    },
  );
test('binary help/version and invalid flags exit cleanly without revealing credentials', async () => {
  const exec = promisify(execFile);
  const options = { env: childEnvironment(), cwd: tmpdir(), timeout: 10000 };
  assert.match((await exec(process.execPath, [binary, '--help'], options)).stdout, /server-index/);
  assert.equal(
    (await exec(process.execPath, [binary, '--version'], options)).stdout.trim(),
    JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version,
  );
  for (const args of [
    ['start', '--port', '-1'],
    ['start', '--mode', 'invalid'],
    ['start', '--tool-annotations', 'invalid'],
    ['start', '--env', 'bad'],
    ['start', '--unknown', 'secret-do-not-print'],
  ]) {
    await assert.rejects(exec(process.execPath, [binary, ...args], options), (error) => {
      assert.equal(error.code, 1);
      assert(!error.stderr.includes('secret-do-not-print'));
      return true;
    });
  }
});
