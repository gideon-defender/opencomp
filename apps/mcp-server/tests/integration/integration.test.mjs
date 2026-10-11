import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { decidePublication, validateRelease } from '../../scripts/release-policy.mjs';

const root = new URL('../../../../', import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
test('workspace, lockfile, scripts and Turbo include the MCP compiler and external spec', () => {
  const workspace = parse(readFileSync(new URL('pnpm-workspace.yaml', root), 'utf8'));
  const lock = parse(readFileSync(new URL('pnpm-lock.yaml', root), 'utf8'));
  assert(!workspace.packages.includes('!apps/mcp-server'));
  assert(lock.importers['apps/mcp-server']);
  const pkg = json('apps/mcp-server/package.json');
  for (const name of ['build', 'test', 'typecheck', 'lint']) assert(pkg.scripts[name]);
  assert(!pkg.scripts.build.includes('install'));
  const tasks = json('turbo.json').tasks;
  assert(
    tasks['@gideon-defender/mcp-server#build'].inputs.includes(
      '$TURBO_ROOT$/packages/docs/openapi.json',
    ),
  );
  assert.deepEqual(tasks['@gideon-defender/mcp-server#typecheck'].dependsOn, []);
});
test('normal CI calls all MCP checks without path exclusions or publication secrets', () => {
  const ci = parse(readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8'));
  assert.equal(ci.jobs['mcp-check'].uses, './.github/workflows/mcp-check.yml');
  const check = readFileSync(new URL('.github/workflows/mcp-check.yml', root), 'utf8');
  for (const command of ['run openapi:check', 'run test', 'run typecheck', 'run lint', 'run build'])
    assert(check.includes(command));
  assert(!check.includes('secrets.'));
});
test('release acceptance, versions, idempotence and stable-after-next are fail-closed', () => {
  const args = {
    version: '1.2.3-next.1',
    packageVersion: '1.2.3-next.1',
    prereleaseApproved: true,
  };
  assert.equal(validateRelease(args), 'next');
  assert.throws(() => validateRelease({ ...args, prereleaseApproved: false }));
  assert.equal(validateRelease({ ...args, accepted: false }), 'next');
  assert.throws(() => validateRelease({ ...args, version: '1.2.3' }));
  assert.throws(() => validateRelease({ ...args, version: 'latest', packageVersion: 'latest' }));
  const candidate = { version: '1.2.3', fingerprint: 'source' };
  assert.throws(() => decidePublication(candidate));
  assert.equal(
    decidePublication({
      ...candidate,
      prerelease: { version: '1.2.3-next.1', opencompRelease: { sourceSha256: 'source' } },
    }),
    'publish',
  );
  assert.throws(() =>
    decidePublication({
      ...candidate,
      prerelease: { version: '1.2.3-next.1', opencompRelease: { sourceSha256: 'changed' } },
    }),
  );
  assert.equal(
    decidePublication({ ...candidate, existing: { opencompRelease: { sourceSha256: 'source' } } }),
    'skip',
  );
  assert.throws(() => decidePublication({ ...candidate, existing: {} }));
  assert.equal(decidePublication({ version: '1.2.3-next.1', fingerprint: 'source' }), 'publish');
});
test('publication validates releases separately from PR paths and retains explicit approval and npm auth', () => {
  const workflow = parse(readFileSync(new URL('.github/workflows/sdk_publish.yaml', root), 'utf8'));
  assert.deepEqual(workflow.on.push.branches, ['release']);
  assert.equal(workflow.on.push.paths, undefined);
  const publish = workflow.jobs.publish;
  assert.deepEqual(publish.needs, ['checks', 'acceptance']);
  assert(publish.if.includes("github.event_name == 'workflow_dispatch'"));
  assert(publish.if.includes("needs.acceptance.outputs.accepted == 'true'"));
  assert.equal(publish.environment, 'mcp-npm-publish');
  const policy = json('apps/mcp-server/release-policy.json');
  assert.equal(typeof policy.cutoverAccepted, 'boolean');
  assert.equal(typeof policy.prereleaseApproved, 'boolean');
  assert(publish.if.includes("needs.acceptance.outputs.prerelease == 'true'"));
  const serialized = JSON.stringify(publish);
  assert(serialized.includes('secrets.NPM_TOKEN'));
  assert(!serialized.includes('speakeasy-api'));
});
test('direct publication and missing explicit versions fail before registry access regardless of approval state', () => {
  for (const file of ['release-guard.mjs', 'release-prepare.mjs']) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(`../../scripts/${file}`, import.meta.url))],
      {
        env: { PATH: process.env.PATH ?? '' },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    assert.equal(result.status, 1);
    assert(
      result.stderr.includes(
        file === 'release-guard.mjs'
          ? 'Publish only the verified staging package'
          : 'Set an explicit package version before publishing',
      ),
    );
  }
});
