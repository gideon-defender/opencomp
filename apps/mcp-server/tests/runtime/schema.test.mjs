import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { serializeRequest } from '../../src/request/serialize.ts';
import { createSchemaCompiler } from '../../src/schema/compiler.ts';
import { baseline, registry, tool } from './fixtures.mjs';

const compile = (source) => createSchemaCompiler({})({ source, location: 'fixture' });
test('compiles all 412 tools without changing names, descriptions, locations, or frozen fixtures', () => {
  assert.equal(registry.tools.length, 412);
  for (const captured of baseline.tools) {
    const actual = tool(captured.name);
    assert.equal(actual.description, captured.description);
    assert.equal(actual.path, captured.envelope.path);
    assert.equal(actual.method, captured.envelope.method);
    assert(actual.inputSchema);
  }
});

const dictionaries = [
  [
    'create-connection',
    {
      request: {
        providerSlug: 'aws',
        credentials: { roleArn: 'arn:test', regions: ['us-east-2'], nested: { enabled: true } },
      },
    },
  ],
  [
    'update-connection',
    { request: { id: 'conn_1', body: { metadata: { name: 'demo', regions: ['us-east-2'] } } } },
  ],
  [
    'save-connection-variables',
    {
      request: {
        connectionId: 'conn_1',
        body: { variables: { bool: true, count: 2, names: ['a'], object: { x: null } } },
      },
    },
  ],
  [
    'save-narrative',
    { request: { id: 'doc_1', body: { narrative: { scope: { locations: ['a'] }, note: null } } } },
  ],
  [
    'save-profile',
    {
      request: { frameworkId: 'frm_1', answers: { nested: { step: 'one', selected: [true, 1] } } },
    },
  ],
];
for (const [name, input] of dictionaries)
  test(`${name} preserves the entire dictionary payload`, () => {
    const actual = tool(name);
    assert.deepEqual(actual.plan.input.parse(input), input);
    const request = serializeRequest({ plan: actual.plan, input, path: actual.path });
    assert.deepEqual(
      JSON.parse(request.body),
      actual.plan.nestedBody ? input.request.body : input.request,
    );
    const roundTrip = z.fromJSONSchema(actual.inputSchema);
    assert.deepEqual(roundTrip.parse(input), input);
  });

test('explicit and absent additionalProperties are open; false rejects extras and schema values validate', () => {
  const value = { region: 'us-east-2', nested: { enabled: true } };
  for (const source of [{ type: 'object' }, { type: 'object', additionalProperties: true }])
    assert.deepEqual(compile(source).parse(value), value);
  assert.equal(
    compile({ type: 'object', additionalProperties: false }).safeParse(value).success,
    false,
  );
  const strings = compile({ type: 'object', additionalProperties: { type: 'string' } });
  assert.deepEqual(strings.parse({ x: 'a' }), { x: 'a' });
  assert.equal(strings.safeParse({ x: 1 }).success, false);
});

test('oneOf is exclusive, anyOf is inclusive, required-only alternatives retain sibling data', () => {
  const schema = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'string' } },
    oneOf: [{ required: ['a'] }, { required: ['b'] }],
  };
  const exclusive = compile(schema);
  assert.deepEqual(exclusive.parse({ a: 'one' }), { a: 'one' });
  assert.equal(exclusive.safeParse({}).success, false);
  assert.equal(exclusive.safeParse({ a: 'one', b: 'two' }).success, false);
  const inclusive = compile({ ...schema, oneOf: undefined, anyOf: schema.oneOf });
  assert.deepEqual(inclusive.parse({ a: 'one', b: 'two' }), { a: 'one', b: 'two' });
  const roundTrip = z.fromJSONSchema(z.toJSONSchema(exclusive, { io: 'input' }));
  assert.equal(roundTrip.safeParse({ a: 'one', b: 'two' }).success, false);
});

test('allOf intersects constraints instead of overwriting them and preserves object properties', () => {
  const numeric = compile({
    allOf: [
      { type: 'number', minimum: 5 },
      { type: 'number', maximum: 10 },
    ],
  });
  assert.equal(numeric.safeParse(3).success, false);
  assert.equal(numeric.safeParse(11).success, false);
  assert.equal(numeric.parse(7), 7);
  const objects = compile({
    allOf: [
      { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
      { type: 'object', required: ['b'], properties: { b: { type: 'number' } } },
    ],
  });
  assert.deepEqual(objects.parse({ a: 'a', b: 2 }), { a: 'a', b: 2 });
  assert.equal(objects.safeParse({ a: 'a' }).success, false);
});

test('nullable, defaults, enums, formats, numbers and array constraints round-trip', () => {
  const source = {
    type: 'object',
    required: ['date', 'values'],
    properties: {
      date: { type: 'string', format: 'date-time' },
      values: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1, maximum: 4 } },
      choice: { type: 'string', enum: ['a', 'b'], nullable: true, default: 'a' },
      title: { type: 'string', minLength: 2, maxLength: 3 },
    },
  };
  const schema = compile(source);
  const input = { date: '2026-10-10T12:00:00Z', values: [2], choice: null, title: 'yes' };
  assert.deepEqual(schema.parse(input), input);
  assert.deepEqual(z.fromJSONSchema(z.toJSONSchema(schema, { io: 'input' })).parse(input), input);
  assert.equal(schema.parse({ date: input.date, values: [1] }).choice, 'a');
  for (const patch of [
    { date: 'bad' },
    { values: [] },
    { values: [1.5] },
    { choice: 'c' },
    { title: 'long' },
  ]) {
    assert.equal(schema.safeParse({ ...input, ...patch }).success, false);
  }
});

test('cyclic references remain lazy and JSON-schema serializable', () => {
  const document = {
    components: {
      schemas: {
        Node: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            next: { $ref: '#/components/schemas/Node', nullable: true },
          },
        },
      },
    },
  };
  const schema = createSchemaCompiler(document)({
    source: { $ref: '#/components/schemas/Node' },
    location: 'cyclic',
  });
  const input = { name: 'root', next: { name: 'child', next: null } };
  assert.deepEqual(schema.parse(input), input);
  const json = z.toJSONSchema(schema, { io: 'input' });
  assert.match(JSON.stringify(json), /\$ref/);
  assert.deepEqual(z.fromJSONSchema(json).parse(input), input);
});

test('dangling references and unsupported constraints fail with their location, even in optional fields', () => {
  assert.throws(() => compile({ $ref: '#/missing' }), /fixture.*dangling reference/);
  assert.throws(
    () =>
      compile({
        type: 'object',
        properties: { optional: { type: 'string', not: { type: 'number' } } },
      }),
    /fixture\/properties\/optional.*unsupported.*not/,
  );
  assert.throws(
    () => compile({ type: 'string', format: 'custom-unsupported' }),
    /fixture.*unsupported format/,
  );
  assert.throws(() => compile({ type: 'string', default: 4 }), /fixture.*invalid schema default/);
  assert.throws(() => compile({ minimum: 4 }), /fixture.*compatible explicit type/);
  assert.throws(() => compile({ type: 'number', exclusiveMinimum: 4 }), /fixture/);
  const compiler = createSchemaCompiler({
    components: {
      schemas: { A: { $ref: '#/components/schemas/B' }, B: { $ref: '#/components/schemas/A' } },
    },
  });
  assert.throws(
    () => compiler({ source: { $ref: '#/components/schemas/A' }, location: 'cycle' }),
    /unproductive reference cycle/,
  );
});

test('reads are safe and mutations default to destructive even when they use POST or PATCH', () => {
  assert.equal(tool('get-tasks').annotations.readOnlyHint, true);
  assert.equal(tool('get-tasks').annotations.idempotentHint, true);
  assert.equal(tool('get-tasks').annotations.destructiveHint, false);
  for (const name of [
    'create-connection',
    'delete-connection',
    'delete-answer',
    'delete-all-manual-answers',
    'update-task',
  ]) {
    assert.equal(tool(name).annotations.destructiveHint, true, name);
  }
  assert.equal(tool('create-connection').annotations.idempotentHint, false);
  assert.equal(tool('create-connection').annotations.openWorldHint, true);
});
