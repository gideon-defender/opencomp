import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import { decidePublication, validateRelease } from '../../scripts/release-policy.mjs';

test('prerelease approval cannot authorize stable cutover and malformed versions fail', () => {
  const args = {
    version: '0.4.0-next.1',
    packageVersion: '0.4.0-next.1',
    prereleaseApproved: true,
    accepted: false,
  };
  assert.equal(validateRelease(args), 'next');
  assert.throws(() => validateRelease({ ...args, prereleaseApproved: false }));
  assert.throws(() => validateRelease({ ...args, version: '0.4.0', packageVersion: '0.4.0' }));
  for (const version of ['01.4.0-next.1', '0.4.0-next.01', '0.4.0-beta.1', '0.4.0+build', 'latest'])
    assert.throws(() =>
      validateRelease({ ...args, version, packageVersion: version, accepted: true }),
    );
  assert.equal(
    validateRelease({ ...args, version: '0.4.0', packageVersion: '0.4.0', accepted: true }),
    'latest',
  );
});

test('idempotent publication checks both source and binary, never accepts a collision', () => {
  const args = { version: '0.4.0-next.1', fingerprint: 'source', binarySha256: 'binary' };
  const existing = { opencompRelease: { sourceSha256: 'source', binarySha256: 'binary' } };
  assert.equal(decidePublication({ ...args, existing }), 'skip');
  assert.throws(() =>
    decidePublication({ ...args, existing: { opencompRelease: { sourceSha256: 'source' } } }),
  );
  assert.throws(() => decidePublication({ ...args, binarySha256: 'changed', existing }));
  assert.throws(() => decidePublication({ ...args, fingerprint: 'changed', existing }));
});

test('generation has no automatic triggers, vendor actions, secrets or write permissions', () => {
  const workflow = parse(
    readFileSync(
      new URL('../../../../.github/workflows/sdk_generation.yaml', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const serialized = JSON.stringify(workflow.jobs);
  assert(!serialized.includes('speakeasy-api/'));
  assert(!serialized.includes('secrets.'));
  assert.deepEqual(Object.keys(workflow.jobs), ['retired']);
});
