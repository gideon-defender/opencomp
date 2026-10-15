/** Execute the documentation's JSON examples against the real MCP runtime and a fake API. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const repo = new URL('../../../', import.meta.url);
const require = createRequire(new URL('apps/mcp-server/package.json', repo));
const { parse } = require('yaml');
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { InMemoryTransport } = await import(
  require.resolve('@modelcontextprotocol/sdk/inMemory.js')
);
const { createOwnedServer } = await import(new URL('apps/mcp-server/src/server.ts', repo));
const { parseCli } = await import(new URL('apps/mcp-server/src/cli/flags.ts', repo));
const read = (path) => readFileSync(new URL(path, repo), 'utf8');
const source = JSON.parse(read('packages/docs/openapi.json'));
const overlay = parse(read('apps/mcp-server/mcp-overlay.yaml'));
const expectedPaths = new Map([
  ['get-tasks', '/v1/tasks'],
  ['frameworks-find-all', '/v1/frameworks'],
  ['get-overview', '/v1/trust-portal/overview'],
]);
const jsonBlocks = (text) =>
  [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
const body = (text) =>
  text
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^# .*\n/, '')
    .trim();

async function withClient({ mode, run }) {
  const requests = [];
  const server = createOwnedServer({
    source,
    overlay,
    mode,
    allowedTools: new Set(expectedPaths.keys()),
    getOptions: () => ({
      apiKey: 'documentation-fake-key',
      serverUrl: 'https://example.invalid',
      fetch: async (url, init) => {
        assert.equal(
          init.method.toUpperCase(),
          'GET',
          'Documentation must never execute a mutation',
        );
        assert.equal(init.headers.get('X-API-Key'), 'documentation-fake-key');
        requests.push(new URL(url));
        return new Response(JSON.stringify({ data: [], count: 0 }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    }),
  });
  const client = new Client({ name: 'documentation-check', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await run({ client, requests });
  } finally {
    await client.close();
    await server.close();
  }
}

test('published MCP pages match repository guides and are in navigation', () => {
  const setup = body(read('docs/user-guide/mcp-setup.md'))
    .replaceAll('(mcp-examples.md)', '(/mcp-server/examples)')
    .replaceAll('(automation-and-api.md#create-a-scoped-api-key)', '(/api-reference/overview)');
  const usage = body(read('docs/user-guide/mcp-examples.md')).replaceAll(
    '(mcp-setup.md)',
    '(/mcp-server)',
  );
  assert.equal(body(read('packages/docs/mcp-server.mdx')), setup);
  assert.equal(body(read('packages/docs/mcp-server/examples.mdx')), usage);
  const nav = JSON.stringify(JSON.parse(read('packages/docs/docs.json')).navigation);
  for (const route of ['mcp-server', 'mcp-server/examples']) assert(nav.includes(`"${route}"`));
});

test('local setup configuration parses with the actual CLI and a read-only allowlist', () => {
  const config = jsonBlocks(read('docs/user-guide/mcp-setup.md'))[0].mcpServers.opencomp;
  assert.equal(config.env.COMPAI_APIKEY, 'REPLACE_WITH_YOUR_ORGANIZATION_API_KEY');
  assert(config.command.startsWith('/absolute/path/'));
  const flags = parseCli(config.args.slice(1));
  assert.equal(flags.transport, 'stdio');
  assert.equal(flags.mode, 'dynamic');
  assert.equal(flags.serverUrl, 'https://opencomp-api.dev.gideondefender.com');
  assert.deepEqual([...flags.allowedTools], [...expectedPaths.keys()]);
});

test('documented dynamic calls discover, describe, and execute the expected GET requests', async () => {
  await withClient({
    mode: 'dynamic',
    run: async ({ client, requests }) => {
      let executions = 0;
      for (const params of jsonBlocks(read('docs/user-guide/mcp-examples.md'))) {
        if (!['list_tools', 'describe_tool_input', 'execute_tool'].includes(params.name)) continue;
        const result = await client.callTool(params);
        assert.notEqual(result.isError, true, `${params.name} rejected a documented input`);
        const text = result.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n');
        if (params.name === 'list_tools') {
          const tools = JSON.parse(text);
          assert(tools.some((tool) => tool.name === params.arguments.search_terms[0]));
        }
        if (params.name === 'describe_tool_input') {
          for (const name of params.arguments.tool_names)
            assert(text.includes(`<input_schema tool="${name}">`));
        }
        if (params.name !== 'execute_tool') continue;
        executions++;
        const { name, arguments: input } = params.arguments;
        const url = requests.at(-1);
        assert.equal(url.origin, 'https://example.invalid');
        assert.equal(url.pathname, expectedPaths.get(name));
        assert.equal(url.searchParams.size, Object.keys(input.request ?? {}).length);
        for (const [key, value] of Object.entries(input.request ?? {})) {
          assert.equal(url.searchParams.get(key), String(value));
        }
        assert.deepEqual(JSON.parse(text), { data: [], count: 0 });
      }
      assert.equal(executions, 5, 'Every documented base and optional variant must execute');
    },
  });
});

test('documented static call executes directly and incomplete overview input stays an error', async () => {
  await withClient({
    mode: 'static',
    run: async ({ client, requests }) => {
      const params = jsonBlocks(read('docs/user-guide/mcp-examples.md')).find(
        (block) => block.name === 'get-tasks',
      );
      assert(params);
      assert.notEqual((await client.callTool(params)).isError, true);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].pathname, '/v1/tasks');
      const error = await client.callTool({ name: 'get-overview', arguments: {} });
      assert.equal(error.isError, true);
      assert.equal(requests.length, 1, 'Invalid input must never call the API');
    },
  });
});
