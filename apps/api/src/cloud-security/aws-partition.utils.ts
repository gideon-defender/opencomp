import type { AwsCredentialIdentity } from '@aws-sdk/types';

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
  const match = roleArn
    .trim()
    .match(/^arn:(aws|aws-us-gov):iam::(\d{12}):role\/(.+)$/);
  if (!match) return null;

  return {
    partition: match[1] as AwsPartition,
    accountId: match[2],
    roleName: match[3],
  };
}

/**
 * Legacy monolith remediator role name (Phase 4 deprecates it in favor of
 * per-asset-class/region roles, but existing customers still have it).
 */
export const AWS_LEGACY_REMEDIATION_ROLE_NAME = 'OpenComp-Remediator';

/**
 * Prefix for per-asset-class x region remediator roles, e.g.
 * `OpenComp-Remediator-Storage-us-east-1`.
 */
export const AWS_REMEDIATION_ROLE_NAME_PREFIX = 'OpenComp-Remediator-';

export function isValidRemediationRoleName(roleName: string): boolean {
  // ARN captures can include an IAM path (e.g. `team/OpenComp-Remediator`).
  // The allowlist applies to the bare role name after the last `/`.
  const bareName = roleName.split('/').pop() ?? roleName;
  return (
    bareName === AWS_LEGACY_REMEDIATION_ROLE_NAME ||
    bareName.startsWith(AWS_REMEDIATION_ROLE_NAME_PREFIX)
  );
}

/**
 * Fail-closed gate for auto-remediation: the write path needs both a
 * configured remediation role ARN and an External ID
 * (`assumeRemediationRole` throws when either is blank). Callers must
 * return guided-only manual steps (preview) or throw (execute/rollback)
 * when this is false — never fall back to the read-only auditor
 * credentials for writes.
 */
export function hasRemediationRole(
  credentials: Record<string, unknown>,
): boolean {
  return (
    typeof credentials.remediationRoleArn === 'string' &&
    credentials.remediationRoleArn.trim().length > 0 &&
    typeof credentials.externalId === 'string' &&
    credentials.externalId.trim().length > 0
  );
}

export function validateAwsPartitionConfig(params: {
  partition: AwsPartition;
  roleArn?: string;
  regions: string[];
  remediationRoleArn?: string;
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

  if (params.remediationRoleArn) {
    const remediationRoleArn = params.remediationRoleArn.trim();
    const parsedRemediationArn = parseAwsRoleArn(remediationRoleArn);
    if (!parsedRemediationArn) {
      errors.push('Invalid Remediation Role ARN format.');
    } else {
      if (parsedRemediationArn.partition !== params.partition) {
        errors.push(
          `Remediation Role ARN partition (${parsedRemediationArn.partition}) must match selected AWS environment (${params.partition}).`,
        );
      }
      // Fail closed on role confusion: the remediation role must never be
      // the auditor role itself (read-only detection creds must never be
      // used for writes).
      if (params.roleArn && remediationRoleArn === params.roleArn.trim()) {
        errors.push(
          'Remediation Role ARN must differ from the auditor Role ARN. Reusing the read-only auditor role for remediation is not allowed.',
        );
      }
      // The same-account and distinctness checks below need a parsed
      // auditor ARN. Without one they would silently skip — so a missing
      // or unparseable auditor ARN is itself a fail-closed error, never
      // a pass with fewer checks.
      if (!parsedRoleArn) {
        errors.push(
          'Auditor Role ARN is required when a Remediation Role ARN is configured. Reconnect your AWS account.',
        );
      } else {
        if (parsedRemediationArn.accountId !== parsedRoleArn.accountId) {
          errors.push(
            `Remediation Role ARN account (${parsedRemediationArn.accountId}) must match the auditor Role ARN account (${parsedRoleArn.accountId}).`,
          );
        }
      }
      // Only OpenComp remediator roles are assumable for writes. Anything
      // else (auditor role, admin role, service role) is role confusion.
      if (!isValidRemediationRoleName(parsedRemediationArn.roleName)) {
        errors.push(
          `Remediation Role ARN must reference ${AWS_LEGACY_REMEDIATION_ROLE_NAME} (legacy) or ${AWS_REMEDIATION_ROLE_NAME_PREFIX}<AssetClass>-<region> (e.g. OpenComp-Remediator-Storage-us-east-1). Got role name "${parsedRemediationArn.roleName}".`,
        );
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

  return errors;
}
