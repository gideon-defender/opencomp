// Capture or verify Phase 0. Execution probes are isolated to a loopback mock API.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  assembleFixture,
  hashFile,
  parseDescriptions,
  readJson,
  sortedTools,
  verifyFixture,
} from './fixture.mjs';
import {
  DEFAULT_SERVER_DIR,
  FAKE_KEY,
  listAllTools,
  startMockApi,
  toolText,
  withStdioClient,
} from './runtime.mjs';

const flags = new Set(process.argv.slice(2).filter((argument) => argument.startsWith('--')));
const positional = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
assert(
  [...flags].every((flag) => flag === '--update'),
  'Only --update is supported',
);
assert(positional.length <= 2, 'Usage: node capture.mjs [server-dir] [out-dir] [--update]');
const serverDir = resolve(positional[0] ?? DEFAULT_SERVER_DIR);
const outDir = resolve(positional[1] ?? fileURLToPath(new URL('./fixtures/', import.meta.url)));
const update = flags.has('--update');

async function capture() {
  const mock = await startMockApi();
  try {
    const tools = await withStdioClient({
      serverDir,
      apiUrl: mock.url,
      args: ['start', '--apikey', FAKE_KEY],
      run: listAllTools,
    });
    const dynamic = await withStdioClient({
      serverDir,
      apiUrl: mock.url,
      args: ['start', '--apikey', FAKE_KEY, '--mode', 'dynamic'],
      run: async (client) => {
        const meta = await listAllTools(client);
        const listed = JSON.parse(
          toolText(await client.callTool({ name: 'list_tools', arguments: {} })),
        );
        assert(Array.isArray(listed));
        assert.deepEqual(
          sortedTools(listed).map(({ name, description }) => ({ name, description })),
          sortedTools(tools).map(({ name, description }) => ({ name, description })),
          'Static/dynamic tool registries differ',
        );
        assert.equal(new Set(listed.map((tool) => tool.name)).size, tools.length);
        const schemas = {};
        const names = sortedTools(listed).map((tool) => tool.name);
        for (let offset = 0; offset < names.length; offset += 25) {
          const batch = names.slice(offset, offset + 25);
          const text = toolText(
            await client.callTool({
              name: 'describe_tool_input',
              arguments: { tool_names: batch },
            }),
          );
          Object.assign(schemas, parseDescriptions({ text, names: batch }));
        }
        assert.equal(Object.keys(schemas).length, tools.length);

        // Unknown tool and type-invalid arguments must not reach even the mock API.
        const unknown = await client.callTool({
          name: 'execute_tool',
          arguments: { name: 'does-not-exist', arguments: {} },
        });
        assert.equal(unknown.isError, true);
        assert.match(unknown.content[0].text, /Unknown tool/);
        const invalid = await client.callTool({
          name: 'execute_tool',
          arguments: { name: 'get-tasks', arguments: { request: { includeRelations: 123 } } },
        });
        assert.equal(invalid.isError, true);
        assert.match(invalid.content[0].text, /Invalid input/);
        assert.equal(mock.requests.length, 0);

        // Unknown keys need not cause validation failure. Characterize that safely.
        const extraKey = await client.callTool({
          name: 'execute_tool',
          arguments: { name: 'get-tasks', arguments: { request: { __phase0_invalid__: 123 } } },
        });
        assert.equal(toolText(extraKey), '{"phase0Mock":true}');
        assert.deepEqual(mock.requests, [{ method: 'GET', url: '/v1/tasks', apiKey: FAKE_KEY }]);
        return {
          meta: sortedTools(meta),
          listed: sortedTools(listed),
          schemas,
          negative: { unknown, invalid, extraKey },
        };
      },
    });
    const fixture = assembleFixture({ serverDir, tools });
    const dynamicFixture = { meta: dynamic.meta, listed: dynamic.listed, schemas: dynamic.schemas };
    const baselines = [
      { name: 'parity-fixture.json', value: fixture },
      { name: 'dynamic-fixture.json', value: dynamicFixture },
    ];
    if (!update) {
      for (const { name, value } of baselines) {
        verifyFixture({ actual: value, expected: readJson(resolve(outDir, name)) });
      }
    } else {
      mkdirSync(outDir, { recursive: true });
      for (const { name, value } of baselines) {
        const path = resolve(outDir, name);
        if (existsSync(path) && isDeepStrictEqual(readJson(path), value)) continue;
        writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
      }
    }
    console.log(
      JSON.stringify(
        {
          action: update ? 'captured' : 'verified',
          tools: tools.length,
          dynamicSchemas: Object.keys(dynamic.schemas).length,
          localExecutionRequests: mock.requests.length,
          negative: dynamic.negative,
          manifestSha256: hashFile(resolve(serverDir, 'manifest.json')),
        },
        null,
        2,
      ),
    );
  } finally {
    await mock.close();
  }
}
try {
  await capture();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
