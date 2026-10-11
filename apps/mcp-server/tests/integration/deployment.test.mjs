import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = new URL('../../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
test('main deploy consumes successful push CI, pins its SHA and requires provisioned MCP infrastructure', () => {
  const workflow = parse(read('.github/workflows/deploy-dev.yml'));
  assert.deepEqual(workflow.on.workflow_run, {
    workflows: ['CI'],
    types: ['completed'],
    branches: ['main'],
  });
  for (const condition of [
    "conclusion == 'success'",
    "event == 'push'",
    'head_repository.full_name == github.repository',
    "github.ref == 'refs/heads/main'",
  ])
    assert(workflow.jobs.authorize.if.includes(condition));
  assert(workflow.env.DEPLOY_SHA.includes('github.event.workflow_run.head_sha'));
  assert.deepEqual(workflow.jobs.build.needs, ['authorize', 'preflight']);
  for (const name of ['build', 'deploy']) {
    const checkout = workflow.jobs[name].steps.find((step) =>
      step.uses?.startsWith('actions/checkout'),
    );
    assert.equal(checkout.with.ref, '${{ env.DEPLOY_SHA }}');
  }
  const images = workflow.jobs.build.strategy.matrix.include;
  assert(
    images.some(
      ({ image, file }) =>
        image === 'gideon-dev-opencomp-mcp' && file === 'apps/mcp-server/Dockerfile',
    ),
  );
  const buildSteps = JSON.stringify(workflow.jobs.build.steps);
  for (const required of [
    '--read-only',
    '--hosted',
    '--mode dynamic',
    'statusCode===401',
    'docker push',
  ])
    assert(buildSteps.includes(required));
  const deploySteps = JSON.stringify(workflow.jobs.deploy.steps);
  for (const required of [
    'data.object.sha !== process.env.DEPLOY_SHA',
    'rolled back',
    '/healthz',
  ]) {
    assert(deploySteps.includes(required));
  }
  const script = read('.github/scripts/deploy-dev.sh');
  assert(script.includes('gideon-dev-opencomp-mcp|$mcp_task_definition'));
  assert(script.indexOf('migrator_exit_code') < script.indexOf('aws ecs update-service'));
  assert.equal(
    spawnSync('bash', ['-n', fileURLToPath(new URL('.github/scripts/deploy-dev.sh', root))]).status,
    0,
  );
});
