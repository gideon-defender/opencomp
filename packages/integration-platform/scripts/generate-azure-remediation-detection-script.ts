/**
 * Support CLI: generate the customer Cloud Shell script that wires Activity
 * Log detection (alert rules → email action group) for the Azure remediator
 * service principals.
 *
 * Run with:
 *   pnpm run generate:azure-remediation-detection-script --email security@example.com --subscription-id <sub> --resource-group <rg> --service Storage:<sp-app-id> [--service Data:<sp-app-id>]
 *
 * Prints the script to stdout — support pastes it into the customer reply.
 * Generation logic lives in `src/manifests/azure/remediation-detection` and
 * is unit-tested there; this file only parses CLI args.
 */

import {
  AZURE_REMEDIATION_DETECTION_ACTION_GROUP_NAME,
  getAzureRemediationDetectionScript,
  type AzureRemediationDetectionScriptOptions,
  type AzureRemediationDetectionService,
} from '../src/manifests/azure/remediation-detection';

export const USAGE = `Usage: generate:azure-remediation-detection-script --email <addr> --subscription-id <sub> --resource-group <rg> --service <Class:app-id> [options]

  --email <addr>           Alert recipient (action-group verification required). Required.
  --subscription-id <sub> Subscription holding the remediator SPs. Required.
  --resource-group <rg>    Resource group hosting the action group and alert rules. Required.
  --service <Class:app-id> Bound class SP, e.g. Storage:11111111-1111-1111-1111-111111111111. Repeatable. At least one required.
  --action-group-name <n>  Action group name (default: "${AZURE_REMEDIATION_DETECTION_ACTION_GROUP_NAME}").
  --help                   Print this message.`;

export type CliRequest =
  { action: 'help' } | { action: 'run'; options: AzureRemediationDetectionScriptOptions };

/**
 * Parse one --service entry (`Class:app-id`) into a detection service.
 * Throws an Error with a human-readable message on misuse; value validation
 * (asset-class allowlist, app-ID shape) stays in the generator — it throws
 * the same errors here.
 */
export function parseServiceEntry(entry: string): AzureRemediationDetectionService {
  const separator = entry.indexOf(':');
  if (separator <= 0) {
    throw new Error(
      `invalid --service: "${entry}" (expected "<Class>:<sp-app-id>", e.g. "Storage:11111111-1111-1111-1111-111111111111")`,
    );
  }
  const assetClass = entry.slice(0, separator).trim();
  const appId = entry.slice(separator + 1).trim();
  if (!assetClass || !appId) {
    throw new Error(
      `invalid --service: "${entry}" (expected "<Class>:<sp-app-id>", e.g. "Storage:11111111-1111-1111-1111-111111111111")`,
    );
  }
  return {
    assetClass: assetClass as AzureRemediationDetectionService['assetClass'],
    appId,
  };
}

/**
 * Parse raw argv (without node/script entries) into a CLI request.
 * Throws an Error with a human-readable message on misuse; the caller
 * prints `USAGE` alongside it. Value validation (subscription shape,
 * resource-group charset, email quoting) stays in the generator — it throws
 * the same errors here.
 */
export function parseCliArgs(argv: string[]): CliRequest {
  let email: string | undefined;
  let subscriptionId: string | undefined;
  let resourceGroup: string | undefined;
  let actionGroupName: string | undefined;
  const services: AzureRemediationDetectionService[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') {
      return { action: 'help' };
    }
    if (
      arg === '--email' ||
      arg === '--subscription-id' ||
      arg === '--resource-group' ||
      arg === '--action-group-name' ||
      arg === '--service'
    ) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`missing value for ${arg}`);
      }
      index += 1;
      if (arg === '--email') {
        email = value;
      } else if (arg === '--subscription-id') {
        subscriptionId = value;
      } else if (arg === '--resource-group') {
        resourceGroup = value;
      } else if (arg === '--action-group-name') {
        actionGroupName = value;
      } else {
        services.push(parseServiceEntry(value));
      }
      continue;
    }
    throw new Error(`unknown argument: "${arg}"`);
  }

  if (email === undefined) {
    throw new Error('missing required --email');
  }
  if (subscriptionId === undefined) {
    throw new Error('missing required --subscription-id');
  }
  if (resourceGroup === undefined) {
    throw new Error('missing required --resource-group');
  }
  if (services.length === 0) {
    throw new Error('missing required --service (at least one "<Class>:<sp-app-id>" entry)');
  }
  return {
    action: 'run',
    options: { email, subscriptionId, resourceGroup, services, actionGroupName },
  };
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
    const script = getAzureRemediationDetectionScript(request.options);
    return { exitCode: 0, stdout: `${script}\n`, stderr: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: '', stderr: `${message}\n` };
  }
}

// Execute only when run directly (`pnpm exec tsx scripts/...`), not when
// imported by the test suite.
const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('generate-azure-remediation-detection-script.ts')) {
  const result = runCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
