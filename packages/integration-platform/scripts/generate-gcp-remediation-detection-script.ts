/**
 * Support CLI: generate the customer Cloud Shell script that wires Cloud
 * Logging detection (log-based metrics → alerting policies → email) for the
 * GCP remediator service accounts.
 *
 * Run with:
 *   pnpm run generate:gcp-remediation-detection-script --email security@example.com --project-id my-proj-123
 *
 * Prints the script to stdout — support pastes it into the customer reply.
 * Generation logic lives in `src/manifests/gcp/remediation-detection.ts` and
 * is unit-tested there; this file only parses CLI args.
 */

import {
  getGcpRemediationDetectionScript,
  type GcpRemediationDetectionScriptOptions,
} from '../src/manifests/gcp/remediation-detection';

export const USAGE = `Usage: generate:gcp-remediation-detection-script --email <addr> --project-id <id> [options]

  --email <addr>       Alert recipient (notification-channel verification required). Required.
  --project-id <id>    GCP project holding the remediator SAs. Required.
  --channel-name <n>   Notification channel display name (default: "OpenComp Remediator Alerts").
  --help               Print this message.`;

export type CliRequest =
  { action: 'help' } | { action: 'run'; options: GcpRemediationDetectionScriptOptions };

/**
 * Parse raw argv (without node/script entries) into a CLI request.
 * Throws an Error with a human-readable message on misuse; the caller
 * prints `USAGE` alongside it. Value validation (project-id shape, email
 * quoting) stays in the generator — it throws the same errors here.
 */
export function parseCliArgs(argv: string[]): CliRequest {
  let email: string | undefined;
  let projectId: string | undefined;
  let channelName: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') {
      return { action: 'help' };
    }
    if (arg === '--email' || arg === '--project-id' || arg === '--channel-name') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`missing value for ${arg}`);
      }
      index += 1;
      if (arg === '--email') {
        email = value;
      } else if (arg === '--project-id') {
        projectId = value;
      } else {
        channelName = value;
      }
      continue;
    }
    throw new Error(`unknown argument: "${arg}"`);
  }

  if (email === undefined) {
    throw new Error('missing required --email');
  }
  if (projectId === undefined) {
    throw new Error('missing required --project-id');
  }
  return { action: 'run', options: { email, projectId, channelName } };
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
    const script = getGcpRemediationDetectionScript(request.options);
    return { exitCode: 0, stdout: `${script}\n`, stderr: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: '', stderr: `${message}\n` };
  }
}

// Execute only when run directly (`pnpm exec tsx scripts/...`), not when
// imported by the test suite.
const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('generate-gcp-remediation-detection-script.ts')) {
  const result = runCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
