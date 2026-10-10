import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { mapOperations, parseDescriptions, sortedTools, verifyFixture } from './fixture.mjs';
import {
  assertLocalUrl,
  childEnvironment,
  DEFAULT_SERVER_DIR,
  FAKE_KEY,
  sourceCommand,
  withClientTransport,
} from './runtime.mjs';

test('only explicit loopback HTTP mock URLs are accepted', () => {
  assertLocalUrl('http://127.0.0.1:1234');
  for (const url of [
    'https://api.gideondefender.com',
    'http://example.com',
    'http://localhost:1234',
    'http://127.0.0.1.example.com',
    'http://user@127.0.0.1:1234',
  ]) {
    assert.throws(() => assertLocalUrl(url));
  }
});

test("relative paths resolve before setting the child's cwd and mock URL is forced", () => {
  const command = sourceCommand({
    serverDir: 'apps/mcp-server',
    args: ['start'],
    apiUrl: 'http://127.0.0.1:1234',
  });
  assert.equal(command.cwd, resolve('apps/mcp-server'));
  assert(command.args.includes(resolve('apps/mcp-server/src/mcp-server/mcp-server.ts')));
  assert.deepEqual(command.args.slice(-2), ['--server-url', 'http://127.0.0.1:1234']);
  assert(DEFAULT_SERVER_DIR.endsWith('/apps/mcp-server'));
});

test('children receive fake credentials rather than arbitrary inherited secrets', () => {
  const previous = process.env.COMPAI_APIKEY;
  process.env.COMPAI_APIKEY = 'real-test-secret';
  try {
    const env = childEnvironment();
    assert.equal(env.COMPAI_APIKEY, FAKE_KEY);
    assert.deepEqual(Object.keys(env).sort(), ['COMPAI_APIKEY', 'PATH']);
  } finally {
    if (previous === undefined) delete process.env.COMPAI_APIKEY;
    else process.env.COMPAI_APIKEY = previous;
  }
});

test('dynamic schemas preserve dictionaries and no-input tools', () => {
  const schema = { type: 'object', additionalProperties: true };
  const text =
    `<input_schema tool="a">\n${JSON.stringify(schema)}\n</input_schema>\n` +
    '<input_schema tool="b">This tool takes no input parameters.</input_schema>';
  assert.deepEqual(parseDescriptions({ text, names: ['a', 'b'] }), {
    a: schema,
    b: { noInputParameters: true },
  });
  assert.throws(() => parseDescriptions({ text, names: ['missing'] }), /Missing dynamic schema/);
  assert.throws(
    () => parseDescriptions({ text: '<input_schema tool="a">', names: ['a'] }),
    /Unclosed/,
  );
});

test('operation mappings reject name collisions and retain wire locations', () => {
  const operation = { operationId: 'getTasks', 'x-speakeasy-mcp': { name: 'get-tasks' } };
  const spec = { paths: { '/v1/tasks': { get: operation, parameters: [] } } };
  const mapped = mapOperations(spec).get('get-tasks');
  assert.equal(mapped.path, '/v1/tasks');
  assert.equal(mapped.method, 'get');
  assert.equal(mapped.operationId, 'getTasks');
  spec.paths['/v1/other'] = { post: operation };
  assert.throws(() => mapOperations(spec), /Duplicate spec tool name/);
});

test('verification fails on schema, annotation, and tool drift', () => {
  const expected = {
    tools: [{ name: 'a', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } }],
  };
  verifyFixture({ actual: structuredClone(expected), expected });
  for (const mutate of [
    (value) => {
      value.tools[0].inputSchema.type = 'string';
    },
    (value) => {
      value.tools[0].annotations.readOnlyHint = true;
    },
    (value) => {
      value.tools.pop();
    },
  ]) {
    const actual = structuredClone(expected);
    mutate(actual);
    assert.throws(() => verifyFixture({ actual, expected }), /Parity fixture drift/);
  }
  assert.deepEqual(sortedTools([{ name: 'b' }, { name: 'a' }]), [{ name: 'a' }, { name: 'b' }]);
});

test('failed transport connections are closed rather than left running', async () => {
  let closed = false;
  const transport = {
    start: async () => {
      throw new Error('expected startup failure');
    },
    send: async () => {},
    close: async () => {
      closed = true;
    },
  };
  await assert.rejects(
    withClientTransport({ transport, run: async () => {} }),
    /expected startup failure/,
  );
  assert(closed);
});
