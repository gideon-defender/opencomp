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

test('dev deploy drains services before approved migrations and restores scaling only after verified rollout', () => {
  const workflow = parse(read('.github/workflows/deploy-dev.yml'));
  const steps = workflow.jobs.deploy.steps;
  const deploy = steps.findIndex((step) =>
    step.run?.includes('bash .github/scripts/deploy-dev.sh'),
  );
  const verify = steps.findIndex((step) =>
    step.run?.includes('bash .github/scripts/wait-dev-services.sh'),
  );
  const restore = steps.findIndex((step) =>
    step.run?.includes('bash .github/scripts/restore-dev-autoscaling.sh'),
  );
  const health = steps.findIndex((step) => step.run?.includes('/healthz'));
  assert(deploy >= 0, 'Maintenance deployment step is required');
  assert(verify > deploy, 'Verify the rollout after starting the new images');
  assert(restore > verify, 'Restore autoscaling only after a successful rollout');
  assert(health > restore, 'Check the hosted edge after service recovery');
  assert.equal(steps[verify].if, undefined, 'Keep the default success-only execution');
  assert.equal(steps[restore].if, undefined, 'A failed rollout must block autoscaling restoration');

  const script = read('.github/scripts/deploy-dev.sh');
  assert(script.includes('gideon-dev-opencomp-mcp|$mcp_task_definition'));
  const stop = script.indexOf('bash .github/scripts/stop-dev-services.sh');
  const migration = script.indexOf('bash .github/scripts/run-dev-migrations.sh offline');
  const update = script.indexOf('aws ecs update-service');
  assert(stop >= 0 && migration > stop, 'All old services must stop before migration');
  assert(update > migration, 'Migration must succeed before any service restarts');
  assert(script.includes('rollback=false'), 'Do not roll back to images that use the old columns');

  const drain = read('.github/scripts/stop-dev-services.sh');
  for (const required of [
    '--desired-count 0',
    'RUNNING STOPPED',
    '.lastStatus == "STOPPED"',
    'opencomp-stopped-services',
    'exit 1',
  ]) {
    assert(drain.includes(required), `Missing maintenance drain check: ${required}`);
  }

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
  assert(migrator.includes('aws ecs describe-task-definition'));
  assert(migrator.includes('test -s "$RUNNER_TEMP/opencomp-stopped-services"'));
  assert(
    read('packages/db/scripts/tenant-migration-state.mjs').includes('app.oidc_rename_approved=yes'),
  );
  assert(
    migrator.includes('jq --arg phase "$phase" -f .github/scripts/migrator-overrides.jq'),
    'Build overrides from the actual task definition to preserve its bootstrap',
  );
  const overrides = read('.github/scripts/migrator-overrides.jq');
  assert(overrides.includes('packages/db/scripts/staged-migrate.mjs'));
  assert(overrides.includes('Unsupported migrator bootstrap command'));
  assert(overrides.includes('Unsupported migrator entrypoint'));
  assert(migrator.includes('if [ "$exit_code" != 0 ]; then'));
  for (const path of [
    '.github/scripts/deploy-dev.sh',
    '.github/scripts/wait-dev-services.sh',
    '.github/scripts/run-dev-migrations.sh',
    '.github/scripts/stop-dev-services.sh',
    '.github/scripts/restore-dev-autoscaling.sh',
  ]) {
    assert.equal(spawnSync('bash', ['-n', fileURLToPath(new URL(path, root))]).status, 0);
  }
});
