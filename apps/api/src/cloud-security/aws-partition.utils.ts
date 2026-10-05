import type { AwsCredentialIdentity } from '@aws-sdk/types';
import {
  AWS_REMEDIATION_ROLE_NAME_PREFIX,
  getRemediationRolesParseError,
  isRemediationRoleKey,
  parseRemediationRolesMap,
  REMEDIATION_ASSET_CLASSES,
  SAFE_AWS_REGION_PATTERN,
} from '@gideon-defender/integration-platform';

// Single source of truth for the role-name constants lives in
// `@gideon-defender/integration-platform` (shared with the frontend
// setup UI). Re-exported here so existing API imports keep working.
export { AWS_REMEDIATION_ROLE_NAME_PREFIX };

// Remediation gate/resolve/validate helpers live in
// `./aws-remediation-roles.utils` — re-exported here so existing API
// imports keep working.
import {
  expectedRemediationRoleNameForKey,
  hasRemediationRole,
  remediationRoleNameFromArn,
  resolveRemediationRoleArn,
  validateOneRemediationArn,
} from './aws-remediation-roles.utils';

export {
  expectedRemediationRoleNameForKey,
  hasRemediationRole,
  remediationRoleNameFromArn,
  resolveRemediationRoleArn,
  validateOneRemediationArn,
};

export type AwsPartition = 'aws' | 'aws-us-gov';

const AWS_PARTITIONS = new Set<AwsPartition>(['aws', 'aws-us-gov']);

export function normalizeAwsPartition(value: unknown): AwsPartition {
  return typeof value === 'string' && AWS_PARTITIONS.has(value as AwsPartition)
    ? (value as AwsPartition)
    : 'aws';
}

export function getAwsDefaultRegion(partition: AwsPartition): string {
  return partition === 'aws-us-gov' ? 'us-gov-west-1' : 'us-east-1';
}

export function getAwsPartitionForRegion(region: string): AwsPartition {
  return region.startsWith('us-gov-') ? 'aws-us-gov' : 'aws';
}

export function getAwsRoleAssumerEnvName(partition: AwsPartition): string {
  return partition === 'aws-us-gov'
    ? 'SECURITY_HUB_GOVCLOUD_ROLE_ASSUMER_ARN'
    : 'SECURITY_HUB_ROLE_ASSUMER_ARN';
}

export function getAwsRoleAssumerArn(
  partition: AwsPartition,
): string | undefined {
  return process.env[getAwsRoleAssumerEnvName(partition)];
}

export function getAwsBaseCredentials(
  partition: AwsPartition,
): AwsCredentialIdentity | undefined {
  if (partition !== 'aws-us-gov') return undefined;

  const accessKeyId = process.env.SECURITY_HUB_GOVCLOUD_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SECURITY_HUB_GOVCLOUD_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return undefined;

  return {
    accessKeyId,
    secretAccessKey,
  };
}

export function parseAwsRoleArn(
  roleArn: string,
): { partition: AwsPartition; accountId: string; roleName: string } | null {
  // Trim here (not just at call sites): the vault stores raw credential
  // strings, so a pasted ARN with a trailing space must parse the same way
  // everywhere — validation, metadata backfill, and the STS assume path.
  // The role token is restricted to IAM's own charset (word chars plus
  // `+=,.@-` and `/` for paths): every shell metacharacter (`"`, `$`,
  // backtick, `;`, …) is rejected, so a validated ARN cannot break out of
  // the double-quoted `ROLE="..."` header in generated grant scripts.
  const match = roleArn
    .trim()
    .match(/^arn:(aws|aws-us-gov):iam::(\d{12}):role\/([A-Za-z0-9_+=,.@/-]+)$/);
  if (!match) return null;

  return {
    partition: match[1] as AwsPartition,
    accountId: match[2],
    roleName: match[3],
  };
}

export function isValidRemediationRoleName(roleName: string): boolean {
  // ARN captures can include an IAM path (e.g.
  // `team/OpenComp-Remediator-Storage-us-east-1`). The allowlist applies
  // to the bare role name after the last `/`.
  const bareName = roleName.split('/').pop() ?? roleName;
  return bareName.startsWith(AWS_REMEDIATION_ROLE_NAME_PREFIX);
}

export function validateAwsPartitionConfig(params: {
  partition: AwsPartition;
  roleArn?: string;
  regions: string[];
  /**
   * Per-pair map (`Class:region` → ARN), stored as a JSON string in
   * credentials. Validated entry-by-entry with fail-closed rules.
   * Accepts the raw credential value.
   */
  remediationRoles?: Record<string, string> | string;
}): string[] {
  const errors: string[] = [];
  const parsedRoleArn = params.roleArn
    ? parseAwsRoleArn(params.roleArn.trim())
    : null;

  if (params.roleArn) {
    if (!parsedRoleArn) {
      errors.push(
        'Invalid IAM Role ARN format. Expected: arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME or arn:aws-us-gov:iam::ACCOUNT_ID:role/ROLE_NAME',
      );
    } else if (parsedRoleArn.partition !== params.partition) {
      errors.push(
        `IAM Role ARN partition (${parsedRoleArn.partition}) must match selected AWS environment (${params.partition}).`,
      );
    }
  }

  if (params.remediationRoles !== undefined) {
    // The lenient parser yields `{}` for garbage so read paths fail
    // closed — validation must reject that garbage instead of looping
    // over zero entries and passing with no errors.
    const rawError = getRemediationRolesParseError(params.remediationRoles);
    if (rawError) {
      errors.push(rawError);
    } else {
      const map = parseRemediationRolesMap(params.remediationRoles);
      for (const [key, arn] of Object.entries(map)) {
        const label = `remediationRoles["${key}"]`;
        if (!isRemediationRoleKey(key)) {
          errors.push(
            `${label}: invalid key. Expected "<AssetClass>:<region>" with AssetClass in ${REMEDIATION_ASSET_CLASSES.join(', ')} (Security-Global is pinned to us-east-1).`,
          );
          continue;
        }
        validateOneRemediationArn({
          remediationRoleArn: arn,
          partition: params.partition,
          roleArn: params.roleArn,
          parsedRoleArn,
          label,
          errors,
          expectedRoleName: expectedRemediationRoleNameForKey(key),
        });
      }
    }
  }

  const mismatchedRegions = params.regions.filter(
    (region) => getAwsPartitionForRegion(region) !== params.partition,
  );
  if (mismatchedRegions.length > 0) {
    errors.push(
      `Selected regions do not match ${params.partition}: ${mismatchedRegions.join(', ')}.`,
    );
  }
  // Regions flow into generated shell scripts via role names — reject
  // anything outside the AWS region charset instead of minting poisoned
  // scripts or throwing later at assume time.
  const malformedRegions = params.regions.filter(
    (region) => !SAFE_AWS_REGION_PATTERN.test(region.trim()),
  );
  if (malformedRegions.length > 0) {
    errors.push(`Invalid AWS region names: ${malformedRegions.join(', ')}.`);
  }

  return errors;
}
