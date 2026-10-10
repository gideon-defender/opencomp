import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { baseline, registry } from '../runtime/fixtures.mjs';
import { canonical, differences } from './canonical.mjs';
import { reviewedSchemaDeltas } from './deltas.mjs';
import { sample } from './sample.mjs';

const dynamic = JSON.parse(
  readFileSync(new URL('../fixtures/dynamic-fixture.json', import.meta.url), 'utf8'),
);
const order = (entries) =>
  [...entries].sort((a, b) => `${a.tool}:${a.path}`.localeCompare(`${b.tool}:${b.path}`));
test('every static and dynamic nested schema matches Phase 0 except individually reviewed exact deltas', () => {
  const actual = [];
  const dynamicDeltas = [];
  for (const tool of registry.tools) {
    const captured = baseline.tools.find((candidate) => candidate.name === tool.name);
    assert(captured, tool.name);
    assert.equal(tool.description, captured.description);
    assert.equal(tool.operationId, captured.envelope.operationId);
    assert.equal(tool.method, captured.envelope.method);
    assert.equal(tool.path, captured.envelope.path);
    actual.push(
      ...differences({
        before: canonical(captured.inputSchema),
        after: canonical(tool.staticInputSchema),
      }).map((delta) => ({ tool: tool.name, ...delta })),
    );
    if (dynamic.schemas[tool.name].noInputParameters) {
      assert.equal(tool.plan.parameters.length, 0);
      assert.equal(tool.plan.body, false);
    } else
      dynamicDeltas.push(
        ...differences({
          before: canonical(dynamic.schemas[tool.name]),
          after: canonical(tool.inputSchema),
        }).map((delta) => ({ tool: tool.name, ...delta })),
      );
    assert.equal(
      tool.plan.input.safeParse(sample(tool.staticInputSchema)).success,
      true,
      tool.name,
    );
  }
  assert.deepEqual(order(actual), order(reviewedSchemaDeltas));
  assert.deepEqual(order(dynamicDeltas), order(reviewedSchemaDeltas));
});
test('canonicalization retains conflicting intersections and meaningful constraints', () => {
  const schema = {
    allOf: [
      { type: 'number', minimum: 1 },
      { type: 'number', minimum: 10 },
    ],
  };
  assert.notDeepEqual(canonical(schema), { type: 'number', minimum: 1 });
  assert.notDeepEqual(
    canonical({ type: 'object', additionalProperties: false }),
    canonical({ type: 'object' }),
  );
  assert.notDeepEqual(canonical({ type: 'string', maxLength: 4 }), canonical({ type: 'string' }));
});
test('all annotation changes are checked against their semantic policy, not snapshot-updated', () => {
  for (const tool of registry.tools) {
    const before = baseline.tools.find((item) => item.name === tool.name).annotations;
    assert.deepEqual(before, {
      title: '',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    const readOnly = ['get', 'head', 'options'].includes(tool.method);
    assert.deepEqual(tool.annotations, {
      title: tool.operation.summary,
      readOnlyHint: readOnly,
      destructiveHint: !readOnly,
      idempotentHint: readOnly || tool.method === 'delete',
      openWorldHint: true,
    });
  }
});
