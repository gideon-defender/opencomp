// Sync the parity fixture's owned-derived fields with the current public spec.
//
// The contract gate (tests/owned-contract.test.mjs) compares the owned tool
// registry — derived live from packages/docs/openapi.json + mcp-overlay.yaml —
// against tests/fixtures/parity-fixture.json. When an endpoint's summary or
// description intentionally changes, the fixture must move with the spec.
// Full live recapture (tests/capture.mjs) cannot do this: the loopback servers
// run from the frozen generated sources, so they still serve the old text.
//
// Assumed order:
//   1. pnpm --filter @gideon-defender/api run openapi:export
//   2. node --import tsx scripts/recapture-fixtures.mjs --check   (default; reports drift)
//   3. node --import tsx scripts/recapture-fixtures.mjs --update  (applies the reviewed drift)
//   4. pnpm --filter @gideon-defender/mcp-server run test:contract
//
// Only description/envelope/spec-version fields move. Live-capture provenance
// (gitHEAD, binary hash, tool schemas) stays untouched. Added or removed tools
// are NOT synthesized here — that needs a full reviewed recapture.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { hashFile, mapOperations } from '../tests/fixture.mjs';
import { loadOpenApi } from '../src/openapi-loader.ts';

const args = process.argv.slice(2).filter((argument) => argument !== '--');
const flags = new Set(args.filter((argument) => argument.startsWith('--')));
const positional = args.filter((argument) => !argument.startsWith('--'));
assert(
  [...flags].every((flag) => flag === '--update'),
  'Usage: node --import tsx scripts/recapture-fixtures.mjs [--update]',
);
assert(positional.length === 0, 'Usage: node --import tsx scripts/recapture-fixtures.mjs [--update]');
const update = flags.has('--update');

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const specPath = resolve(pkgDir, '../../packages/docs/openapi.json');
const overlayPath = resolve(pkgDir, 'mcp-overlay.yaml');
const fixturePath = resolve(pkgDir, 'tests/fixtures/parity-fixture.json');

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const overlay = parse(readFileSync(overlayPath, 'utf8'));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

const before = structuredClone(spec);
const { tools: owned } = loadOpenApi({ source: spec, overlay });
assert.deepEqual(spec, before, 'Public docs must remain untouched');
const ownedByName = new Map(owned.map((tool) => [tool.name, tool]));
const operations = mapOperations(spec);

const problems = [];
if (owned.length !== fixture.tools.length) {
  problems.push(
    `tool count changed (owned ${owned.length} vs fixture ${fixture.tools.length}): ` +
      'added or removed tools need a full reviewed recapture, not this script',
  );
}
for (const tool of fixture.tools) {
  if (!ownedByName.has(tool.name)) {
    problems.push(`fixture tool missing from owned registry: ${tool.name}`);
  }
  if (!operations.has(tool.name)) {
    problems.push(`fixture tool missing from current spec: ${tool.name}`);
  }
}
for (const tool of owned) {
  if (!fixture.tools.some((item) => item.name === tool.name)) {
    problems.push(`owned tool missing from fixture: ${tool.name}`);
  }
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`drift: ${problem}`);
  console.error('Full reviewed recapture required; see tests/README.md.');
  process.exit(1);
}

const changes = [];
for (const tool of fixture.tools) {
  const live = ownedByName.get(tool.name);
  if (tool.description !== live.description) {
    changes.push(`${tool.name}: description`);
    tool.description = live.description;
  }
  const envelope = operations.get(tool.name);
  for (const field of ['operationId', 'method', 'path', 'summary', 'description']) {
    if (tool.envelope[field] !== envelope[field]) {
      changes.push(`${tool.name}: envelope.${field}`);
      tool.envelope[field] = envelope[field];
    }
  }
}
const specBlock = {
  version: spec.info.version,
  paths: Object.keys(spec.paths).length,
  sha256: hashFile(specPath),
};
for (const [field, value] of Object.entries(specBlock)) {
  if (fixture.spec[field] !== value) {
    changes.push(`spec.${field}`);
    fixture.spec[field] = value;
  }
}

if (changes.length === 0) {
  console.log('Fixture matches the owned registry — nothing to do.');
} else if (!update) {
  for (const change of changes) console.log(`drift: ${change}`);
  console.log('Re-run with --update to apply, then re-run test:contract.');
  process.exit(1);
} else {
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  for (const change of changes) console.log(`updated: ${change}`);
  console.log('Fixture updated. Re-run test:contract to confirm the gate is green.');
}
