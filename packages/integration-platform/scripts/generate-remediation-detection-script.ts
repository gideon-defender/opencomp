/**
 * Support CLI: generate the customer CloudShell script that wires CloudTrail
 * detection (EventBridge rules → SNS email) for the remediator roles.
 *
 * Run with:
 *   pnpm run generate:remediation-detection-script --email security@example.com
 *   pnpm run generate:remediation-detection-script --email sec@example.com --partition aws-us-gov
 *
 * Prints the script to stdout — support pastes it into the customer reply.
 * Generation logic lives in `src/manifests/aws/remediation-detection.ts` and
 * is unit-tested there; this file only parses CLI args.
 */

import type { AwsEnvironment } from '../src/manifests/aws/credentials';
import {
  getRemediationDetectionScript,
  REMEDIATION_DETECTION_TOPIC_NAME,
  type RemediationDetectionScriptOptions,
} from '../src/manifests/aws/remediation-detection';

export const USAGE = `Usage: generate:remediation-detection-script --email <addr> [options]

  --email <addr>        Alert recipient (SNS subscription, confirmation required). Required.
  --topic-name <name>   SNS topic name (default: ${REMEDIATION_DETECTION_TOPIC_NAME}).
  --partition <env>     aws (default) or aws-us-gov for GovCloud accounts.
  --help                Print this message.`;

export type CliRequest =
  { action: 'help' } | { action: 'run'; options: RemediationDetectionScriptOptions };

const PARTITIONS: readonly AwsEnvironment[] = ['aws', 'aws-us-gov'];

function isPartition(value: string): value is AwsEnvironment {
  return (PARTITIONS as readonly string[]).includes(value);
}

/**
 * Parse raw argv (without node/script entries) into a CLI request.
 * Throws an Error with a human-readable message on misuse; the caller
 * prints `USAGE` alongside it. Value validation (partition charset, topic
 * name shape) stays in the generator — it throws the same errors here.
 */
export function parseCliArgs(argv: string[]): CliRequest {
  let email: string | undefined;
  let topicName: string | undefined;
  let partition: AwsEnvironment | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') {
      return { action: 'help' };
    }
    if (arg === '--email' || arg === '--topic-name' || arg === '--partition') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`missing value for ${arg}`);
      }
      index += 1;
      if (arg === '--email') {
        email = value;
      } else if (arg === '--topic-name') {
        topicName = value;
      } else if (isPartition(value)) {
        partition = value;
      } else {
        throw new Error(`unknown partition: "${value}" (expected "aws" or "aws-us-gov")`);
      }
      continue;
    }
    throw new Error(`unknown argument: "${arg}"`);
  }

  if (email === undefined) {
    throw new Error('missing required --email');
  }
  return { action: 'run', options: { email, topicName, partition } };
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Run the CLI without touching process globals — the guard below does I/O. */
export function runCli(argv: string[]): CliResult {
  let request: CliRequest;
  try {
    request = parseCliArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: '', stderr: `${message}\n\n${USAGE}\n` };
  }
  if (request.action === 'help') {
    return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  }
  try {
    const script = getRemediationDetectionScript(request.options);
    return { exitCode: 0, stdout: `${script}\n`, stderr: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: '', stderr: `${message}\n` };
  }
}

// Execute only when run directly (`pnpm exec tsx scripts/...`), not when
// imported by the test suite.
const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('generate-remediation-detection-script.ts')) {
  const result = runCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
