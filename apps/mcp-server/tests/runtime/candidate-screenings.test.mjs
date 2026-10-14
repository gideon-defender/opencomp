import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializeRequest } from '../../src/request/serialize.ts';
import { reviewedToolAdditions } from '../compatibility/additions.mjs';
import { tool } from './fixtures.mjs';

const candidate = {
  operationId: 'd99e647c-a4ac-4ff1-b5b5-ddd96f7f423a',
  email: 'a@b.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  country: 'US',
  state: 'CA',
};

test('candidate intake exposes only screening inputs and preserves the hosted-dispatch wire contract', () => {
  const actual = tool('start-candidate-screening');
  const input = { request: candidate };
  const parsed = actual.plan.input.parse(input);
  assert.deepEqual(
    JSON.parse(serializeRequest({ plan: actual.plan, input: parsed, path: actual.path }).body),
    candidate,
  );
  for (const field of ['roles', 'sendPortalEmail', 'organizationId', 'memberId']) {
    assert.equal(
      actual.plan.input.safeParse({ request: { ...candidate, [field]: 'injected' } }).success,
      false,
      field,
    );
  }
  assert.equal(
    actual.plan.input.safeParse({ request: { ...candidate, operationId: 'bad-uuid' } }).success,
    false,
  );
});

test('candidate detail escapes the run ID and configuration never accepts raw credentials', () => {
  const detail = tool('get-candidate-screening');
  const input = detail.plan.input.parse({ request: { id: 'pcs/a' } });
  assert.equal(
    serializeRequest({ plan: detail.plan, input, path: detail.path }).path,
    '/v1/people/candidate-screenings/pcs%2Fa',
  );
  const config = tool('configure-checkr-candidate-intake');
  const connection = {
    accountId: 'account_a',
    apiKeySecretId: 'secret_a',
    package: 'basic',
    environment: 'sandbox',
    enabled: true,
  };
  assert.equal(config.plan.input.safeParse({ request: connection }).success, true);
  assert.equal(
    config.plan.input.safeParse({ request: { ...connection, apiKey: 'plaintext' } }).success,
    false,
  );
});

test('all additive tools retain semantic annotations and discoverable descriptions', () => {
  for (const addition of reviewedToolAdditions) {
    const actual = tool(addition.name);
    assert(actual.description.length > 40);
    const readOnly = addition.method === 'get';
    assert.equal(actual.annotations.readOnlyHint, readOnly);
    assert.equal(actual.annotations.destructiveHint, !readOnly);
  }
});
