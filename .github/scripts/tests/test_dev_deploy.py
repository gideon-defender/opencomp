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
    print('arn:task/' + phase)
elif args[:2] == ['ecs', 'update-service']:
    with trace.open('a') as f: f.write('update:' + value('--service') + '\\n')
elif args[:2] == ['ecs', 'describe-services']:
    expected = 'arn:' + value('--services') + ':new'
    if scenario == 'rollback': expected = 'old'
    rollout = 'COMPLETED'
    if scenario == 'rollout-lag':
        marker = 'rollout-observed:' + value('--services')
        if marker not in trace.read_text(): rollout = 'IN_PROGRESS'
        with trace.open('a') as f: f.write(marker + '\\n')
    if scenario == 'rollout-stuck': rollout = 'IN_PROGRESS'
    if scenario == 'rollout-failed': rollout = 'FAILED'
    emit({'services': [{'taskDefinition': expected, 'desiredCount': 1, 'runningCount': 1,
        'pendingCount': 0, 'deployments': [{'taskDefinition': expected, 'rolloutState': rollout}]}]})
elif args[:2] == ['ecs', 'list-tasks']:
    status = value('--desired-status')
    print('arn:task/' + value('--service-name') + '/' + status)
elif args[:2] == ['ecs', 'describe-tasks']:
    if '--query' in args:
        print(1 if scenario == 'expand-failure' else 0)
    else:
        task = args[args.index('--tasks') + 1]
        service, desired = task.split('/')[-2:]
        old = desired == 'STOPPED'
        draining = scenario == 'old-alive'
        if old and scenario == 'old-drains':
            marker = 'old-observed:' + service
            draining = marker not in trace.read_text()
            with trace.open('a') as f: f.write(marker + '\\n')
        emit({'tasks': [{'lastStatus': 'RUNNING' if not old or draining else 'STOPPED',
            'taskDefinitionArn': 'old' if old else 'arn:' + service + ':new'}]})
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
                'bash .github/scripts/run-dev-migrations.sh contract'],
                cwd=ROOT, env=env, capture_output=True, text=True)
            return result, trace.read_text().splitlines()

    def test_expand_rollout_drain_then_contract(self):
        result, events = self.run_flow('')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(events[0], 'migration:expand')
        self.assertEqual(events[-1], 'migration:contract')
        self.assertEqual(sum(event.startswith('update:') for event in events), 6)

    def test_failed_expansion_never_updates_services(self):
        result, events = self.run_flow('expand-failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(events, ['migration:expand'])

    def test_shell_entrypoint_executes_driver_and_preserves_tls_bootstrap(self):
        result, events = self.run_flow('shell-entrypoint')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(events[:3], ['tls-ready', 'driver:expand', 'migration:expand'])
        self.assertEqual(events[-3:], ['tls-ready', 'driver:contract', 'migration:contract'])

    def test_unknown_wrapper_fails_before_migrations_or_rollout(self):
        result, events = self.run_flow('bad-wrapper')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(events, [])

    def test_waits_for_rollout_completion_after_aws_stability_waiter(self):
        result, events = self.run_flow('rollout-lag')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(events[-1], 'migration:contract')
        self.assertEqual(sum(event.startswith('rollout-observed:') for event in events), 10)

    def test_failed_or_stuck_rollouts_block_contract(self):
        for scenario in ['rollout-failed', 'rollout-stuck']:
            with self.subTest(scenario=scenario):
                result, events = self.run_flow(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('migration:contract', events)

    def test_waits_until_old_tasks_actually_stop(self):
        result, events = self.run_flow('old-drains')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(events[-1], 'migration:contract')
        self.assertEqual(sum(event.startswith('old-observed:') for event in events), 10)

    def test_rollback_or_live_old_task_blocks_contract(self):
        for scenario in ['rollback', 'old-alive']:
            with self.subTest(scenario=scenario):
                result, events = self.run_flow(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('migration:contract', events)


if __name__ == '__main__':
    unittest.main()
