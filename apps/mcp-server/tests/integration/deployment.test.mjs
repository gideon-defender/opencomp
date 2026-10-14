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
  assert(deploySteps.includes('/healthz'));
});

test('dev deploy stages migrations around a verified rollout and blocks contract after failure', () => {
  const workflow = parse(read('.github/workflows/deploy-dev.yml'));
  const steps = workflow.jobs.deploy.steps;
  const expand = steps.findIndex((step) =>
    step.run?.includes('bash .github/scripts/deploy-dev.sh'),
  );
  const drain = steps.findIndex((step) =>
    step.run?.includes('bash .github/scripts/wait-dev-services.sh'),
  );
  const contract = steps.findIndex((step) =>
    step.run?.includes('bash .github/scripts/run-dev-migrations.sh contract'),
  );
  const health = steps.findIndex((step) => step.run?.includes('/healthz'));
  assert(expand >= 0, 'Expansion and rollout step is required');
  assert(drain > expand, 'Verify the rollout after updating services');
  assert(contract > drain, 'Contract must wait for old tasks to stop');
  assert(health > contract, 'Check the hosted edge after contract completes');
  assert.equal(steps[drain].if, undefined, 'Keep the default success-only execution');
  assert.equal(steps[contract].if, undefined, 'A failed rollout must block contract');

  const script = read('.github/scripts/deploy-dev.sh');
  assert(script.includes('gideon-dev-opencomp-mcp|$mcp_task_definition'));
  const expansion = script.indexOf('bash .github/scripts/run-dev-migrations.sh expand');
  const update = script.indexOf('aws ecs update-service');
  assert(expansion >= 0 && update > expansion, 'Expansion must succeed before service updates');
  assert(
    !script.includes('run-dev-migrations.sh contract'),
    'Do not contract before draining old tasks',
  );

  const waiter = read('.github/scripts/wait-dev-services.sh');
  for (const required of [
    '.taskDefinition == $expected',
    '.rolloutState == "COMPLETED"',
    'RUNNING STOPPED',
    '.lastStatus == "STOPPED"',
    '.taskDefinitionArn == $expected',
    'exit 1',
  ])
    assert(waiter.includes(required), `Missing rollout check: ${required}`);

  const migrator = read('.github/scripts/run-dev-migrations.sh');
  assert(migrator.includes('staged-migrate.mjs'));
  assert(migrator.includes('if [ "$exit_code" != 0 ]; then'));
  for (const path of [
    '.github/scripts/deploy-dev.sh',
    '.github/scripts/wait-dev-services.sh',
    '.github/scripts/run-dev-migrations.sh',
  ]) {
    assert.equal(spawnSync('bash', ['-n', fileURLToPath(new URL(path, root))]).status, 0);
  }
});
