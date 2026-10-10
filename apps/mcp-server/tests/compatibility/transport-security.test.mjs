import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availablePort, startMockApi, toolText, withClientTransport } from '../runtime.mjs';
import { withHttp } from './processes.mjs';

for (const kind of ['streamable', 'sse']) {
  test(`${kind} dynamic discovery/execution and missing credentials never use static fallback`, async () => {
    const mock = await startMockApi();
    try {
      await withHttp({
        port: await availablePort(),
        apiUrl: mock.url,
        args: [
          ...(kind === 'streamable' ? ['serve'] : ['start', '--transport', 'sse']),
          '--mode',
          'dynamic',
          '--tool',
          'get-tasks',
          '--disable-static-auth',
        ],
        run: async (url) => {
          for (const key of ['dynamic-user', undefined]) {
            const headers = key ? { apikey: key } : {};
            const transport =
              kind === 'streamable'
                ? new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
                    requestInit: { headers },
                  })
                : new SSEClientTransport(new URL(`${url}/sse`), {
                    requestInit: { headers },
                    eventSourceInit: {
                      fetch: (url, init) =>
                        fetch(url, {
                          ...init,
                          headers: { ...init?.headers, ...headers },
                        }),
                    },
                  });
            await withClientTransport({
              transport,
              run: async (client) => {
                assert.deepEqual(
                  (await client.listTools()).tools.map(({ name }) => name),
                  ['list_tools', 'describe_tool_input', 'execute_tool'],
                );
                assert.deepEqual(
                  JSON.parse(
                    toolText(
                      await client.callTool({
                        name: 'list_tools',
                        arguments: {},
                      }),
                    ),
                  ).map(({ name }) => name),
                  ['get-tasks'],
                );
                const result = await client.callTool({
                  name: 'execute_tool',
                  arguments: { name: 'get-tasks' },
                });
                if (key) assert.equal(toolText(result), '{"phase0Mock":true}');
                else assert.equal(result.isError, true);
                const unknown = await client.callTool({
                  name: 'execute_tool',
                  arguments: { name: 'create-connection' },
                });
                assert.equal(unknown.isError, true);
              },
            });
          }
          assert.deepEqual(
            mock.requests.map(({ apiKey }) => apiKey),
            ['dynamic-user'],
          );
        },
      });
    } finally {
      await mock.close();
    }
  });
}

test('SSE message endpoint retains path routing and rejects another session credential', async () => {
  const mock = await startMockApi();
  try {
    await withHttp({
      port: await availablePort(),
      apiUrl: mock.url,
      args: ['start', '--transport', 'sse', '--disable-static-auth'],
      run: async (url) => {
        const controller = new AbortController();
        const response = await fetch(`${url}/sse`, {
          headers: { apikey: 'session-owner' },
          signal: controller.signal,
        });
        const reader = response.body.getReader();
        try {
          let text = '';
          while (!text.includes('\n\n')) {
            const chunk = await reader.read();
            assert.equal(chunk.done, false);
            text += new TextDecoder().decode(chunk.value);
          }
          const endpoint = text.match(/data: (\/message\/[^\n]+)/)?.[1];
          assert(endpoint, 'SSE must announce the compatible /message/:sessionId path');
          assert.equal(
            (
              await fetch(`${url}${endpoint}`, {
                method: 'POST',
                headers: { apikey: 'different-user' },
                body: '{}',
              })
            ).status,
            403,
          );
          assert.equal((await fetch(`${url}/message/missing`, { method: 'POST' })).status, 404);
          assert.deepEqual(mock.requests, []);
        } finally {
          await reader.cancel();
          controller.abort();
        }
      },
    });
  } finally {
    await mock.close();
  }
});
