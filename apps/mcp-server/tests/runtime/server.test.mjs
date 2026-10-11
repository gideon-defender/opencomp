import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOwnedServer } from '../../src/server.ts';
import { overlay, registry, source } from './fixtures.mjs';

async function withClient({ options = {}, run }) {
  const calls = [];
  let resolutions = 0;
  const server = createOwnedServer({
    source,
    overlay,
    getOptions: (context) => {
      resolutions++;
      return {
        apiKey: `fake-${context.requestId}`,
        serverUrl: 'http://127.0.0.1:1',
        fetch: async (url, init) => {
          calls.push({
            url: String(url),
            body: init.body,
            key: init.headers.get('X-API-Key'),
            signal: init.signal,
          });
          return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
        },
      };
    },
    ...options,
  });
  const client = new Client({ name: 'Phase2Tests', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await run({ client, calls, resolutions: () => resolutions });
  } finally {
    await client.close();
    await server.close();
  }
}

test('MCP SDK static mode lists all 412 tools with owned descriptions and semantic annotations', async () => {
  await withClient({
    run: async ({ client }) => {
      const result = await client.listTools();
      assert.equal(result.tools.length, 412);
      for (const actual of result.tools) {
        const expected = registry.tools.find((tool) => tool.name === actual.name);
        assert.equal(actual.description, expected.description);
        assert.deepEqual(actual.annotations, expected.annotations);
        assert.deepEqual(actual.inputSchema, expected.staticInputSchema);
      }
    },
  });
});
test('static and dynamic execution produce identical wire requests and results, preserving dictionaries', async () => {
  const results = [];
  const records = [];
  const input = {
    request: { providerSlug: 'aws', credentials: { regions: ['us-east-2'], nested: { count: 1 } } },
  };
  for (const mode of ['static', 'dynamic'])
    await withClient({
      options: { mode },
      run: async ({ client, calls }) => {
        const result = await client.callTool(
          mode === 'static'
            ? { name: 'create-connection', arguments: input }
            : { name: 'execute_tool', arguments: { name: 'create-connection', arguments: input } },
        );
        results.push(result);
        records.push({ url: calls[0].url, body: calls[0].body });
        assert(calls[0].signal instanceof AbortSignal);
      },
    });
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(records[0], records[1]);
  assert.deepEqual(JSON.parse(records[0].body), input.request);
});
test('dynamic discovery, OR search and describe-tool schemas expose only selected tools', async () => {
  await withClient({
    options: { mode: 'dynamic', allowedTools: new Set(['get-tasks', 'create-connection']) },
    run: async ({ client }) => {
      assert.deepEqual(
        (await client.listTools()).tools.map((tool) => tool.name),
        ['list_tools', 'describe_tool_input', 'execute_tool'],
      );
      const listed = await client.callTool({
        name: 'list_tools',
        arguments: { search_terms: ['GET-TASKS', 'create integration'] },
      });
      assert.deepEqual(
        JSON.parse(listed.content[0].text)
          .map((tool) => tool.name)
          .sort(),
        ['create-connection', 'get-tasks'],
      );
      const description = await client.callTool({
        name: 'describe_tool_input',
        arguments: { tool_names: ['get-tasks', 'not-a-tool'] },
      });
      assert.match(description.content[0].text, /includeRelations/);
      assert.match(description.content[0].text, /Unknown tools: not-a-tool/);
    },
  });
});
test('allowlist and annotation filters apply equally to static and dynamic execution; disabled tools cannot execute', async () => {
  for (const mode of ['static', 'dynamic'])
    await withClient({
      options: {
        mode,
        allowedTools: new Set(['get-tasks', 'create-connection', 'auto-fill']),
        annotationFilter: { readOnlyHint: true },
      },
      run: async ({ client, calls, resolutions }) => {
        if (mode === 'static')
          assert.deepEqual(
            (await client.listTools()).tools.map((tool) => tool.name),
            ['get-tasks'],
          );
        for (const name of ['create-connection', 'auto-fill', 'not-a-tool']) {
          const result = await client.callTool(
            mode === 'static'
              ? { name, arguments: {} }
              : { name: 'execute_tool', arguments: { name } },
          );
          assert.equal(result.isError, true);
        }
        assert.equal(calls.length, 0);
        assert.equal(resolutions(), 0);
      },
    });
});
test('invalid input is rejected before resolving credentials or making HTTP calls', async () => {
  for (const mode of ['static', 'dynamic'])
    await withClient({
      options: { mode },
      run: async ({ client, calls, resolutions }) => {
        const input = { request: { includeRelations: 42 } };
        const result = await client.callTool(
          mode === 'static'
            ? { name: 'get-tasks', arguments: input }
            : { name: 'execute_tool', arguments: { name: 'get-tasks', arguments: input } },
        );
        assert.equal(result.isError, true);
        assert.equal(calls.length, 0);
        assert.equal(resolutions(), 0);
      },
    });
});
test('non-destructive filters hide POST deletions and reject their execution in both modes', async () => {
  const deletionTools = ['delete-answer', 'delete-all-manual-answers'];
  for (const mode of ['static', 'dynamic'])
    await withClient({
      options: {
        mode,
        allowedTools: new Set(['get-tasks', ...deletionTools]),
        annotationFilter: { destructiveHint: false },
      },
      run: async ({ client, calls, resolutions }) => {
        const listed =
          mode === 'static'
            ? (await client.listTools()).tools
            : JSON.parse(
                (await client.callTool({ name: 'list_tools', arguments: {} })).content[0].text,
              );
        assert.deepEqual(listed.map((tool) => tool.name), ['get-tasks']);
        for (const name of deletionTools) {
          const result = await client.callTool(
            mode === 'static'
              ? { name, arguments: {} }
              : { name: 'execute_tool', arguments: { name } },
          );
          assert.equal(result.isError, true, name);
        }
        assert.equal(calls.length, 0);
        assert.equal(resolutions(), 0);
      },
    });
});
test('credentials are resolved per call rather than cached across concurrent requests', async () => {
  await withClient({
    run: async ({ client, calls, resolutions }) => {
      await Promise.all([
        client.callTool({ name: 'get-tasks', arguments: {} }),
        client.callTool({ name: 'get-tasks', arguments: {} }),
      ]);
      assert.equal(resolutions(), 2);
      assert.equal(calls.length, 2);
      assert.notEqual(calls[0].key, calls[1].key);
    },
  });
});
test('MCP cancellation reaches the HTTP client signal', async () => {
  let started;
  let aborted;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const cancelled = new Promise((resolve) => {
    aborted = resolve;
  });
  await withClient({
    options: {
      getOptions: () => ({
        apiKey: 'fake',
        serverUrl: 'http://127.0.0.1:1',
        fetch: async (_, init) => {
          started();
          return new Promise((_, reject) =>
            init.signal.addEventListener(
              'abort',
              () => {
                aborted();
                reject(new Error('cancelled'));
              },
              { once: true },
            ),
          );
        },
      }),
    },
    run: async ({ client }) => {
      const controller = new AbortController();
      const result = client.callTool({ name: 'get-tasks', arguments: {} }, undefined, {
        signal: controller.signal,
      });
      await ready;
      controller.abort();
      await assert.rejects(result);
      await cancelled;
    },
  });
});
