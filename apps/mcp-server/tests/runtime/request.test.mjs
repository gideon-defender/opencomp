import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializeRequest } from '../../src/request/serialize.ts';
import { compileTools } from '../../src/tools.ts';
import { baseline, emptyOverlay, registry, tiny, tool } from './fixtures.mjs';

const serialize = ({ name, input }) => {
  const actual = tool(name);
  return serializeRequest({ plan: actual.plan, input, path: actual.path });
};
test('get-tasks preserves optional request.includeRelations and query encoding', () => {
  assert.deepEqual(tool('get-tasks').plan.input.parse({}), {});
  const request = serialize({
    name: 'get-tasks',
    input: { request: { includeRelations: 'controls,automations & runs' } },
  });
  assert.equal(request.query.toString(), 'includeRelations=controls%2Cautomations+%26+runs');
  assert.equal(request.body, undefined);
  assert.equal(request.path, '/v1/tasks');
});
test('all captured request envelope keys and requiredness are preserved, including defaulted fields', () => {
  const envelope = (schema) => ({
    keys: Object.keys(schema.properties ?? {}).sort(),
    required: (schema.required ?? []).slice().sort(),
    requestKeys: Object.keys(schema.properties?.request?.properties ?? {}).sort(),
    requestRequired: (schema.properties?.request?.required ?? []).slice().sort(),
  });
  for (const actual of registry.tools) {
    const captured = baseline.tools.find((candidate) => candidate.name === actual.name);
    assert.deepEqual(
      envelope(actual.staticInputSchema),
      envelope(captured.inputSchema),
      actual.name,
    );
  }
  for (const name of ['create-risk', 'create-vendor', 'create-finding']) {
    const actual = tool(name);
    const fields = actual.staticInputSchema.properties.request;
    const defaults = Object.entries(fields.properties)
      .filter(([, value]) => value.default !== undefined)
      .map(([name]) => name);
    for (const field of defaults)
      assert(!fields.required.includes(field), `${name}.${field} must accept omission`);
  }
});
test('update-member preserves mixed path/body nesting and escapes path values', () => {
  const request = serialize({
    name: 'update-member',
    input: { request: { id: 'mem/a ?#é', body: { name: 'Ada' } } },
  });
  assert.equal(request.path, '/v1/people/mem%2Fa%20%3F%23%C3%A9');
  assert.deepEqual(JSON.parse(request.body), { name: 'Ada' });
  assert.equal(request.headers.get('content-type'), 'application/json');
  assert.throws(
    () => serialize({ name: 'update-member', input: { request: { id: '..', body: {} } } }),
    /Dot path/,
  );
});
test('create-upload-url maps xOrganizationId to X-Organization-Id, not the JSON payload', () => {
  const body = { fileName: 'test.pdf', fileType: 'application/pdf', purpose: 'general' };
  const request = serialize({
    name: 'create-upload-url',
    input: { request: { xOrganizationId: 'org_1', body } },
  });
  assert.equal(request.headers.get('X-Organization-Id'), 'org_1');
  assert.deepEqual(JSON.parse(request.body), body);
});
test('body-only inputs do not acquire a second body nesting level', () => {
  const input = { providerSlug: 'aws', credentials: { roleArn: 'test', regions: ['us-east-2'] } };
  assert.deepEqual(
    JSON.parse(serialize({ name: 'create-connection', input: { request: input } }).body),
    input,
  );
});

function fixture({ parameters, path = '/v1/items/{id}' }) {
  const registry = compileTools({
    source: tiny({ path, parameters, method: 'get' }),
    overlay: emptyOverlay,
  });
  return registry.tools[0];
}
test('query styles encode form arrays and objects, delimiters, deepObject and reserved characters once', () => {
  const schemas = [
    { name: 'a', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
    {
      name: 'b',
      in: 'query',
      style: 'form',
      explode: false,
      schema: { type: 'array', items: { type: 'string' } },
    },
    {
      name: 'spaces',
      in: 'query',
      style: 'spaceDelimited',
      schema: { type: 'array', items: { type: 'string' } },
    },
    {
      name: 'pipes',
      in: 'query',
      style: 'pipeDelimited',
      schema: { type: 'array', items: { type: 'string' } },
    },
    {
      name: 'object',
      in: 'query',
      style: 'deepObject',
      schema: { type: 'object', additionalProperties: { type: 'string' } },
    },
    {
      name: 'plain',
      in: 'query',
      explode: false,
      schema: { type: 'object', additionalProperties: { type: 'string' } },
    },
    {
      name: 'exploded',
      in: 'query',
      schema: { type: 'object', additionalProperties: { type: 'string' } },
    },
  ];
  const actual = fixture({ path: '/v1/items', parameters: schemas });
  const request = serializeRequest({
    plan: actual.plan,
    path: actual.path,
    input: {
      request: {
        a: ['a & b', 'c'],
        b: ['x', 'y'],
        spaces: ['x', 'y'],
        pipes: ['x', 'y'],
        object: { 'a/b': 'x+y' },
        plain: { x: 'y' },
        exploded: { color: 'red' },
      },
    },
  });
  assert.deepEqual(request.query.getAll('a'), ['a & b', 'c']);
  assert.equal(request.query.get('b'), 'x,y');
  assert.equal(request.query.get('spaces'), 'x y');
  assert.equal(request.query.get('pipes'), 'x|y');
  assert.equal(request.query.get('object[a/b]'), 'x+y');
  assert.equal(request.query.get('plain'), 'x,y');
  assert.equal(request.query.get('color'), 'red');
  assert.match(request.query.toString(), /object%5Ba%2Fb%5D=x%2By/);
});
test('path styles and header simple style serialize arrays and objects', () => {
  for (const [style, explode, expected] of [
    ['simple', false, 'a,b'],
    ['label', true, '.a.b'],
    ['matrix', true, ';id=a;id=b'],
  ]) {
    const actual = fixture({
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          style,
          explode,
          schema: { type: 'array', items: { type: 'string' } },
        },
      ],
    });
    assert.equal(
      serializeRequest({
        plan: actual.plan,
        path: actual.path,
        input: { request: { id: ['a', 'b'] } },
      }).path,
      `/v1/items/${expected}`,
    );
  }
  const actual = fixture({
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        style: 'simple',
        explode: true,
        schema: { type: 'object', additionalProperties: { type: 'string' } },
      },
      {
        name: 'X-Options',
        in: 'header',
        explode: true,
        schema: { type: 'object', additionalProperties: { type: 'string' } },
      },
    ],
  });
  const request = serializeRequest({
    plan: actual.plan,
    path: actual.path,
    input: { request: { id: { color: 'red blue' }, xOptions: { label: 'hello world' } } },
  });
  assert.equal(request.path, '/v1/items/color=red%20blue');
  assert.equal(request.headers.get('x-options'), 'label=hello world');
});
test('collisions, credential headers, unknown styles and unsupported MIME types fail at compilation', () => {
  const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
  assert.throws(() => fixture({ parameters: [id, { ...id, in: 'query' }] }), /collision id/);
  assert.throws(
    () =>
      fixture({
        parameters: [id, { name: 'X-API-Key', in: 'header', schema: { type: 'string' } }],
      }),
    /reserved header/,
  );
  assert.throws(
    () => fixture({ parameters: [{ ...id, style: 'unsupported' }] }),
    /unsupported.*style/,
  );
  const source = tiny({ parameters: [id], body: { type: 'object' } });
  source.paths['/v1/items/{id}'].post.requestBody.content = {
    'multipart/form-data': { schema: {} },
  };
  assert.throws(() => compileTools({ source, overlay: emptyOverlay }), /unsupported body MIME/);
});
test('operation parameters override path-level parameters without duplicating headers', () => {
  const source = tiny({
    path: '/v1/items',
    method: 'get',
    parameters: [{ name: 'X-Mode', in: 'header', schema: { type: 'string', enum: ['new'] } }],
  });
  source.paths['/v1/items'].parameters = [
    { name: 'x-mode', in: 'header', schema: { type: 'string', enum: ['old'] } },
  ];
  const actual = compileTools({ source, overlay: emptyOverlay }).tools[0];
  assert.equal(actual.plan.parameters.length, 1);
  assert.equal(actual.plan.input.safeParse({ request: { xMode: 'new' } }).success, true);
});
