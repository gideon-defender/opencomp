import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { decidePublication, validateRelease } from './release-policy.mjs';
import { stageRelease, verifyReleaseCandidate } from './release-stage.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    prerelease: { type: 'string' },
    'out-dir': { type: 'string' },
  },
});
const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
const policy = JSON.parse(await readFile(resolve(directory, 'release-policy.json'), 'utf8'));
const tag = validateRelease({
  version: values.version,
  packageVersion: pkg.version,
  accepted: policy.cutoverAccepted,
  prereleaseApproved: policy.prereleaseApproved,
});
const { fingerprint, binarySha256 } = await verifyReleaseCandidate();
async function lookup(version) {
  const response = await fetch(
    `https://registry.npmjs.org/@gideon-defender%2fmcp-server/${encodeURIComponent(version)}`,
    {
      signal: AbortSignal.timeout(15000),
    },
  );
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(`Registry lookup failed (${response.status}); refusing to publish`);
  return response.json();
}
const decision = decidePublication({
  version: values.version,
  fingerprint,
  binarySha256,
  existing: await lookup(values.version),
  prerelease: values.prerelease ? await lookup(values.prerelease) : undefined,
});
if (decision === 'skip') {
  console.log('Version already published with matching release source; skipping.');
  process.exit(0);
}
if (!values['out-dir']) throw new Error('A fresh release staging directory is required');
const output = resolve(values['out-dir']);
const staged = await stageRelease({ output });
assert.equal(staged.fingerprint, fingerprint, 'Release inputs changed during preparation');
console.log(`Prepared verified ${tag} staging package at ${output}`);
