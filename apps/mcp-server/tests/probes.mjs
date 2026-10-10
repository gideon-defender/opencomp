// Assert transport/filter/env behavior; all API URLs point to a loopback mock.
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './fixture.mjs';
import {
  DEFAULT_SERVER_DIR,
  FAKE_KEY,
  availablePort,
  listAllTools,
  startMockApi,
  withClientTransport,
  withHttpProcess,
  withStdioClient,
} from './runtime.mjs';

assert(process.argv.length <= 3, 'Usage: node probes.mjs [server-dir]');
const serverDir = resolve(process.argv[2] ?? DEFAULT_SERVER_DIR);
const fixture = readJson(fileURLToPath(new URL('./fixtures/parity-fixture.json', import.meta.url)));
const expectedNames = fixture.tools.map((tool) => tool.name).sort();
const out = {};

async function probe() {
  const mock = await startMockApi();
  try {
    const list = (options) =>
      withStdioClient({
        serverDir,
        apiUrl: mock.url,
        run: listAllTools,
        ...options,
      });
    const allowed = await list({
      args: ['start', '--apikey', FAKE_KEY, '--tool', 'get-tasks', '--tool', 'list-members'],
    });
    assert.deepEqual(allowed.map((tool) => tool.name).sort(), ['get-tasks', 'list-members']);
    out.allowlist = allowed.length;
    const fallback = await list({ args: ['start'], env: { COMPAI_APIKEY: FAKE_KEY } });
    assert.deepEqual(fallback.map((tool) => tool.name).sort(), expectedNames);
    out.envFallback = fallback.length;

    // Characterize the current empty-registry SDK error, not an arbitrary failure.
    await assert.rejects(
      list({ args: ['start', '--apikey', FAKE_KEY, '--tool-annotations', 'readOnly'] }),
      (error) => error.code === -32601 && /Method not found/.test(error.message),
    );
    out.annotationFilterReadOnly = { code: -32601, tools: 0 };

    await withHttpProcess({
      serverDir,
      apiUrl: mock.url,
      port: await availablePort(),
      args: ['serve', '--apikey', FAKE_KEY],
      run: async (url) => {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200);
        await response.body?.cancel();
        const names = await withClientTransport({
          transport: new StreamableHTTPClientTransport(new URL(`${url}/mcp`)),
          run: async (client) => (await listAllTools(client)).map((tool) => tool.name).sort(),
        });
        assert.deepEqual(names, expectedNames);
        out.serve = { landingStatus: response.status, tools: names.length };
      },
    });
    await withHttpProcess({
      serverDir,
      apiUrl: mock.url,
      port: await availablePort(),
      args: ['start', '--transport', 'sse', '--apikey', FAKE_KEY],
      run: async (url) => {
        const response = await fetch(`${url}/sse`, { signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
        await response.body?.cancel();
        const names = await withClientTransport({
          transport: new SSEClientTransport(new URL(`${url}/sse`)),
          run: async (client) => (await listAllTools(client)).map((tool) => tool.name).sort(),
        });
        assert.deepEqual(names, expectedNames);
        out.sse = { status: response.status, tools: names.length };
      },
    });
    assert.equal(mock.requests.length, 0, 'Discovery probes must not call any API operation');
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await mock.close();
  }
}
try {
  await probe();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
