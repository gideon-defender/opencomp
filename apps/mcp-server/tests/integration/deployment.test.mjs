import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = new URL('../../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
test('dev deploy authorizes the current main SHA and keeps the selected commit pinned through deployment', () => {
  const workflow = parse(read('.github/workflows/deploy-dev.yml'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(
    workflow.jobs.authorize.if,
    "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
  );
  assert.equal(workflow.env.DEPLOY_SHA, '${{ github.sha }}');
  const authorizationSteps = workflow.jobs.authorize.steps;
  assert(
    authorizationSteps.some((step) =>
      step.with?.script?.includes('data.object.sha !== process.env.DEPLOY_SHA'),
    ),
  );
  const administratorCheck = authorizationSteps.find((step) =>
    step.with?.script?.includes('getCollaboratorPermissionLevel'),
  );
  assert(administratorCheck);
  assert.equal(administratorCheck.if, undefined);
  assert(administratorCheck.with.script.includes('GITHUB_TRIGGERING_ACTOR'));
  assert(administratorCheck.with.script.includes("data.permission !== 'admin'"));
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
  assert.equal(workflow.env.IMAGE_TAG, 'dev-${{ github.sha }}-${{ github.run_id }}');
  assert.deepEqual(workflow.jobs.deploy.needs, ['authorize', 'build']);
  assert.equal(
    workflow.jobs.deploy.if,
    "needs.authorize.result == 'success' && needs.build.result == 'success'",
  );
  assert(!deploySteps.includes('getRef'));
  assert(!deploySteps.includes('Reject a superseded main commit'));
  for (const required of ['rolled back', '/healthz']) {
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
