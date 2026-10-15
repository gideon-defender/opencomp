import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
FAKE_AWS = '''#!/usr/bin/env python3
import json, os, sys, subprocess
from pathlib import Path
args = sys.argv[1:]
def value(flag): return args[args.index(flag) + 1]
def emit(value): print(json.dumps(value))
trace = Path(os.environ['AWS_TRACE'])
scenario = os.environ.get('SCENARIO', '')
if args[:2] == ['ecs', 'describe-task-definition']:
    container = {'name': 'migrator', 'image': 'old'}
    if scenario in ['shell-entrypoint', 'bad-wrapper']:
        container['entryPoint'] = ['/bin/sh', '-ec']
        container['command'] = ['printf "tls-ready\\\\n" >> "$AWS_TRACE"; exec ./node_modules/.bin/prisma migrate deploy']
        if scenario == 'bad-wrapper': container['command'] = ['echo migration no-op']
    emit({'family': value('--task-definition'), 'containerDefinitions': [container]})
elif args[:2] == ['ecs', 'register-task-definition']:
    data = json.loads(Path(value('--cli-input-json')[7:]).read_text())
    print('arn:' + data['family'] + ':new')
elif args[:2] == ['ecs', 'run-task']:
    data = json.loads(Path(value('--overrides')[7:]).read_text())
    command = data['containerOverrides'][0]['command']
    phase = command[-1].split(' ')[-1]
    if scenario == 'shell-entrypoint':
        completed = subprocess.run(['/bin/sh', '-ec', *command], capture_output=True, text=True)
        if completed.returncode: raise SystemExit(completed.stderr)
    with trace.open('a') as f: f.write('migration:' + phase + '\\n')
    if scenario in ['missing-count', 'duplicate-count', 'invalid-count']:
        counts = Path(os.environ['RUNNER_TEMP']) / 'opencomp-service-counts'
        lines = counts.read_text().splitlines()
        if scenario == 'missing-count': lines = lines[:-1]
        if scenario == 'duplicate-count': lines.append(lines[-1])
        if scenario == 'invalid-count': lines[-1] = lines[-1].split('|')[0] + '|invalid'
        counts.write_text('\\n'.join(lines) + '\\n')
    print('arn:task/' + phase)
elif args[:2] == ['application-autoscaling', 'describe-scalable-targets']:
    if scenario == 'scaling-denied': raise SystemExit('AccessDenied')
    targets = [{'ResourceId': 'service/test/gideon-dev-opencomp-api',
        'SuspendedState': {'DynamicScalingInSuspended': True,
            'DynamicScalingOutSuspended': False, 'ScheduledScalingSuspended': False}}]
    if scenario == 'missing-suspension': targets[0].pop('SuspendedState')
    if scenario == 'null-suspension': targets[0]['SuspendedState'] = None
    if scenario == 'partial-suspension': targets[0]['SuspendedState'] = {'DynamicScalingInSuspended': True}
    emit({'ScalableTargets': targets})
elif args[:2] == ['application-autoscaling', 'register-scalable-target']:
    suspended = value('--suspended-state')
    with trace.open('a') as f: f.write('scaling:' + suspended + '\\n')
elif args[:2] == ['ecs', 'update-service']:
    service = value('--service')
    restart = '--task-definition' in args
    if restart:
        assert 'rollback=false' in value('--deployment-configuration')
        desired = '0' if service.endswith('email-worker') else '2' if service.endswith('-api') else '1'
        assert value('--desired-count') == desired
    with trace.open('a') as f: f.write(('restart:' if restart else 'stop:') + service + '\\n')
elif args[:2] == ['ecs', 'describe-services']:
    services = args[args.index('--services') + 1:]
    states = []
    for service in services:
        expected = 'arn:' + service + ':new'
        restarted = 'restart:' + service in trace.read_text()
        stopped = 'stop:' + service in trace.read_text() and not restarted
        if scenario == 'rollback' and restarted: expected = 'old'
        rollout = 'COMPLETED'
        if scenario == 'rollout-lag' and restarted:
            marker = 'rollout-observed:' + service
            if marker not in trace.read_text(): rollout = 'IN_PROGRESS'
            with trace.open('a') as f: f.write(marker + '\\n')
        if scenario == 'rollout-stuck' and restarted: rollout = 'IN_PROGRESS'
        if scenario == 'rollout-failed' and restarted: rollout = 'FAILED'
        desired = 0 if stopped or service.endswith('email-worker') else 2 if service.endswith('-api') else 1
        states.append({'serviceName': service, 'status': 'ACTIVE', 'schedulingStrategy': 'REPLICA',
            'taskDefinition': expected, 'desiredCount': desired, 'runningCount': desired,
            'pendingCount': 0, 'deployments': [{'taskDefinition': expected, 'rolloutState': rollout}]})
    emit({'services': states})
elif args[:2] == ['ecs', 'list-tasks']:
    status = value('--desired-status')
    assert '--no-paginate' not in args and '--max-items' not in args
    if scenario == 'large-live':
        print('\\t'.join('arn:task/' + str(i) + '/' + value('--service-name') + '/' + status for i in range(101)))
    else:
        print('arn:task/' + value('--service-name') + '/' + status)
elif args[:2] == ['ecs', 'describe-tasks']:
    if '--query' in args:
        print(1 if scenario == 'migration-failure' else 0)
    else:
        task_arns = args[args.index('--tasks') + 1:]
        assert len(task_arns) <= 100
        if scenario == 'large-live':
            with trace.open('a') as f: f.write('batch:' + str(len(task_arns)) + '\\n')
        tasks = []
        for task in task_arns:
            service, desired = task.split('/')[-2:]
            stopped = 'stop:' + service in trace.read_text() and 'restart:' + service not in trace.read_text()
            old = stopped or desired == 'STOPPED'
            draining = scenario == 'old-alive' or (scenario == 'large-live' and task.split('/')[-3] == '100')
            if old and scenario == 'old-drains':
                marker = 'old-observed:' + service
                draining = marker not in trace.read_text()
                with trace.open('a') as f: f.write(marker + '\\n')
            tasks.append({'lastStatus': 'RUNNING' if not old or draining else 'STOPPED',
                'taskDefinitionArn': 'old' if old else 'arn:' + service + ':new'})
        emit({'tasks': tasks})
elif args[:2] == ['ecs', 'wait']: pass
elif args[:2] == ['logs', 'get-log-events']: print('migration failed')
else: raise SystemExit('Unexpected AWS call: ' + repr(args))
'''


class DevDeployTests(unittest.TestCase):
    def run_flow(self, scenario):
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            aws = temporary / 'aws'
            aws.write_text(FAKE_AWS)
            aws.chmod(0o755)
            trace = temporary / 'trace'
            trace.touch()
            (temporary / 'opencomp-stopped-services').write_text('stale drain receipt')
            node = temporary / 'node'
            node.write_text('#!/bin/sh\n'
                'test "$1" = packages/db/scripts/staged-migrate.mjs || exit 1\n'
                'printf "driver:%s\\n" "$2" >> "$AWS_TRACE"\n')
            node.chmod(0o755)
            env = dict(os.environ, PATH=f'{temporary}:{os.environ["PATH"]}',
                       RUNNER_TEMP=directory, AWS_TRACE=str(trace), SCENARIO=scenario,
                       TASK_DRAIN_ATTEMPTS='2' if scenario == 'old-drains' else '1',
                       TASK_DRAIN_DELAY_SECONDS='0',
                       SERVICE_ROLLOUT_ATTEMPTS='2', SERVICE_ROLLOUT_DELAY_SECONDS='0',
                       AWS_REGION='test', ECS_CLUSTER='test', ECR_REGISTRY='test',
                       IMAGE_TAG='test', MIGRATOR_SUBNETS='test', MIGRATOR_SECURITY_GROUP='test')
            result = subprocess.run(['bash', '-c',
                'set -e; bash .github/scripts/deploy-dev.sh; '
                'bash .github/scripts/wait-dev-services.sh; '
                'bash .github/scripts/restore-dev-autoscaling.sh'],
                cwd=ROOT, env=env, capture_output=True, text=True)
            return result, trace.read_text().splitlines()

    def test_offline_migration_requires_a_completed_drain(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(['bash', '.github/scripts/run-dev-migrations.sh', 'offline'],
                cwd=ROOT, env=dict(os.environ, RUNNER_TEMP=directory),
                capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('requires a completed service drain', result.stdout)

    def test_stop_drain_migrate_restart_and_restore_scaling(self):
        result, events = self.run_flow('')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        migration = events.index('migration:offline')
        self.assertEqual(sum(event.startswith('stop:') for event in events[:migration]), 5)
        self.assertEqual(sum(event.startswith('restart:') for event in events[migration:]), 5)
        self.assertTrue(events[0].startswith('scaling:DynamicScalingInSuspended=true'))
        restored = json.loads(events[-1].removeprefix('scaling:'))
        self.assertEqual(restored, {'DynamicScalingInSuspended': True,
            'DynamicScalingOutSuspended': False, 'ScheduledScalingSuspended': False})

    def test_invalid_count_snapshots_block_every_restart(self):
        for scenario in ['missing-count', 'duplicate-count', 'invalid-count']:
            with self.subTest(scenario=scenario):
                result, events = self.run_flow(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Invalid or missing desired count', result.stdout)
                self.assertFalse(any(event.startswith('restart:') for event in events))

    def test_absent_and_partial_suspension_flags_have_explicit_defaults(self):
        for scenario in ['missing-suspension', 'null-suspension', 'partial-suspension']:
            with self.subTest(scenario=scenario):
                result, events = self.run_flow(scenario)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                restored = json.loads(events[-1].removeprefix('scaling:'))
                self.assertEqual(restored, {'DynamicScalingInSuspended': scenario == 'partial-suspension',
                    'DynamicScalingOutSuspended': False, 'ScheduledScalingSuspended': False})

    def test_live_task_after_first_hundred_blocks_migration(self):
        result, events = self.run_flow('large-live')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('batch:100', events)
        self.assertIn('batch:1', events)
        self.assertNotIn('migration:offline', events)
        self.assertFalse(any(event.startswith('restart:') for event in events))

    def test_failed_migration_leaves_services_stopped(self):
        result, events = self.run_flow('migration-failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('migration:offline', events)
        self.assertFalse(any(event.startswith('restart:') for event in events))
        self.assertEqual(sum(event.startswith('scaling:') for event in events), 1)

    def test_shell_entrypoint_executes_driver_and_preserves_tls_bootstrap(self):
        result, events = self.run_flow('shell-entrypoint')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        migration = events.index('migration:offline')
        self.assertEqual(events[migration-2:migration], ['tls-ready', 'driver:offline'])

    def test_unknown_wrapper_blocks_migrations_and_restart(self):
        result, events = self.run_flow('bad-wrapper')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('migration:offline', events)
        self.assertFalse(any(event.startswith('restart:') for event in events))

    def test_scaling_permission_failure_does_not_stop_services(self):
        result, events = self.run_flow('scaling-denied')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(events, [])

    def test_waits_for_rollout_completion_before_restoring_scaling(self):
        result, events = self.run_flow('rollout-lag')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(events[-1].startswith('scaling:{'))
        self.assertEqual(sum(event.startswith('rollout-observed:') for event in events), 10)

    def test_failed_or_stuck_rollouts_leave_scaling_suspended(self):
        for scenario in ['rollout-failed', 'rollout-stuck', 'rollback']:
            with self.subTest(scenario=scenario):
                result, events = self.run_flow(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(sum(event.startswith('scaling:') for event in events), 1)
                self.assertIn('autoscaling restoration is blocked', result.stdout)

    def test_waits_until_old_tasks_actually_stop_before_migration(self):
        result, events = self.run_flow('old-drains')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        migration = events.index('migration:offline')
        self.assertEqual(sum(event.startswith('old-observed:') for event in events[:migration]), 20)

    def test_live_old_tasks_block_migration_and_restart(self):
        result, events = self.run_flow('old-alive')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('migration:offline', events)
        self.assertFalse(any(event.startswith('restart:') for event in events))


if __name__ == '__main__':
    unittest.main()
