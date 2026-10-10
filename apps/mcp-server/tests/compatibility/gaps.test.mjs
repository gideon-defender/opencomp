import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeRequest } from '../../src/client.ts';
import { serializeRequest } from '../../src/request/serialize.ts';
import { tool } from '../runtime/fixtures.mjs';
import { sample } from './sample.mjs';

test('open inline DTO bodies are sent intact rather than silently omitted like the generated runtime', async () => {
  const actual = tool('generate-auth-code');
  const input = { request: { organizationId: 'org_fake', platform: 'test' } };
  let body;
  const result = await executeRequest({
    tool: actual,
    input,
    servers: ['http://127.0.0.1:1'],
    options: {
      apiKey: 'fake',
      fetch: async (_, init) => {
        body = JSON.parse(init.body);
        return new Response('ok');
      },
    },
  });
  assert.deepEqual(body, input.request);
  assert.equal(result.isError, undefined);
});
test('nullable fields retain null in JSON bodies and unions/intersections retain validated data', () => {
  const actual = tool('create-task');
  const input = sample(actual.staticInputSchema);
  input.request.department = null;
  assert.equal(
    JSON.parse(serializeRequest({ plan: actual.plan, path: actual.path, input }).body).department,
    null,
  );
  const update = tool('update-custom-framework');
  assert.equal(
    update.plan.input.safeParse({
      request: { customFrameworkId: 'fake', enabled: true, status: 'compliant' },
    }).success,
    true,
  );
  assert.equal(
    update.plan.input.safeParse({ request: { customFrameworkId: 'fake' } }).success,
    false,
  );
});
test('strict DTOs reject extras and current spec constraints cannot silently weaken', () => {
  assert.equal(
    tool('update-organization').plan.input.safeParse({
      request: { name: 'demo', unsupported: true },
    }).success,
    false,
  );
  assert.equal(
    tool('create-role').plan.input.safeParse({ request: { name: 'x', permissions: {} } }).success,
    false,
  );
});
