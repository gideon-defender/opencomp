import {
  AWS_REMEDIATION_ROLE_NAME_PREFIX,
  findingToAssetClass,
  isRemediationRoleKey,
  parseRemediationRolesMap,
  remediationRoleKey,
  remediationRoleName,
  type RemediationAssetClass,
} from '@gideon-defender/integration-platform';
import {
  isValidRemediationRoleName,
  parseAwsRoleArn,
  type AwsPartition,
} from './aws-partition.utils';

/**
 * Fail-closed gate for auto-remediation: the write path needs an External ID
 * plus a non-empty `remediationRoles` pair map (`assumeRemediationRole`
 * throws when the resolved ARN is blank). Callers must return guided-only
 * manual steps (preview) or throw (execute/rollback) when this is false —
 * never fall back to the read-only auditor credentials for writes.
 */
export function hasRemediationRole(
  credentials: Record<string, unknown>,
): boolean {
  if (
    typeof credentials.externalId !== 'string' ||
    credentials.externalId.trim().length === 0
  ) {
    return false;
  }
  // Count only usable entries: a map whose keys are malformed (or whose
  // values are not valid remediator ARNs) can never satisfy
  // resolveRemediationRoleArn for any finding, so it must not flip the
  // gate to "configured" — otherwise capabilities report enabled and the
  // failure surfaces later at assume time instead of at setup.
  // Entries must name exactly the role their key routes to (same binding
  // as save-time validation) — a prefix-only check would accept another
  // pair's role and promote the finding to a wider-blast-radius role.
  return Object.entries(
    parseRemediationRolesMap(credentials.remediationRoles),
  ).some(([key, arn]) => {
    if (!isRemediationRoleKey(key)) return false;
    const parsed = parseAwsRoleArn(arn);
    if (parsed === null || !isValidRemediationRoleName(parsed.roleName))
      return false;
    const separator = key.indexOf(':');
    const assetClass = key.slice(0, separator) as RemediationAssetClass;
    const region = key.slice(separator + 1);
    let expected: string;
    try {
      expected = remediationRoleName({ assetClass, region });
    } catch {
      return false;
    }
    return parsed.roleName === expected;
  });
}

/**
 * Resolve the remediation role ARN for one finding from the pair map
 * (`Class:region` key). Returns `undefined` when no pair is configured —
 * callers treat that as "no write path" and stay guided-only / throw.
 */
export function resolveRemediationRoleArn(params: {
  credentials: Record<string, unknown>;
  resourceType: unknown;
  region: string;
}): string | undefined {
  const region = params.region.trim();
  if (region) {
    try {
      const assetClass = findingToAssetClass(params.resourceType);
      const key = remediationRoleKey({ assetClass, region });
      const mapped = parseRemediationRolesMap(
        params.credentials.remediationRoles,
      )[key];
      if (mapped) {
        // Enforce the same exact-pair binding as save-time validation:
        // a Storage key pointing at another pair's role (or a pathed ARN
        // sharing the suffix) must not route — fall through to legacy so
        // callers fail closed instead of assuming the wrong role.
        const parsed = parseAwsRoleArn(mapped);
        if (parsed !== null) {
          const expected = remediationRoleName({ assetClass, region });
          if (parsed.roleName === expected) return mapped;
        }
      }
    } catch {
      // Invalid region or unroutable type leaves the role unresolved —
      // every caller already fails closed on undefined.
    }
  }
  return undefined;
}

/**
 * Bare IAM role name from a remediation ARN for `iam:*` API calls, which
 * take `RoleName` without the IAM path (`team/Name` → `Name`).
 */
export function remediationRoleNameFromArn(
  roleArn: string,
): string | undefined {
  const bare = parseAwsRoleArn(roleArn)?.roleName.split('/').pop();
  return bare && bare.length > 0 ? bare : undefined;
}

/**
 * Validate one remediation ARN against the auditor connection. Shared by
 * every per-pair map entry so all pairs enforce the identical fail-closed
 * rules.
 */
export function validateOneRemediationArn(args: {
  remediationRoleArn: string;
  partition: AwsPartition;
  roleArn: string | undefined;
  parsedRoleArn: { partition: AwsPartition; accountId: string } | null;
  /** Prefix for map-entry errors, e.g. `remediationRoles["Storage:us-east-1"]`. */
  label: string;
  errors: string[];
  /**
   * Exact IAM role name the ARN must carry (bare name after the last `/`).
   * `Storage:us-east-1` must not point at the `Security-Global` role (or
   * any other pair's role) — that would silently promote the finding to a
   * wider-blast-radius role at assume time.
   */
  expectedRoleName: string;
}): void {
  const {
    remediationRoleArn,
    partition,
    roleArn,
    parsedRoleArn,
    label,
    errors,
  } = args;
  const where = label ? `${label}: ` : '';
  const parsedRemediationArn = parseAwsRoleArn(remediationRoleArn);
  if (!parsedRemediationArn) {
    errors.push(`${where}Invalid Remediation Role ARN format.`);
    return;
  }
  if (parsedRemediationArn.partition !== partition) {
    errors.push(
      `${where}Remediation Role ARN partition (${parsedRemediationArn.partition}) must match selected AWS environment (${partition}).`,
    );
  }
  // Fail closed on role confusion: the remediation role must never be
  // the auditor role itself (read-only detection creds must never be
  // used for writes).
  if (roleArn && remediationRoleArn === roleArn.trim()) {
    errors.push(
      `${where}Remediation Role ARN must differ from the auditor Role ARN. Reusing the read-only auditor role for remediation is not allowed.`,
    );
  }
  // The same-account and distinctness checks below need a parsed
  // auditor ARN. Without one they would silently skip — so a missing
  // or unparseable auditor ARN is itself a fail-closed error, never
  // a pass with fewer checks.
  if (!parsedRoleArn) {
    errors.push(
      `${where}Auditor Role ARN is required when a Remediation Role ARN is configured. Reconnect your AWS account.`,
    );
  } else if (parsedRemediationArn.accountId !== parsedRoleArn.accountId) {
    errors.push(
      `${where}Remediation Role ARN account (${parsedRemediationArn.accountId}) must match the auditor Role ARN account (${parsedRoleArn.accountId}).`,
    );
  }
  // Only OpenComp remediator pair roles are assumable for writes.
  // Anything else (auditor role, admin role, service role) is role
  // confusion.
  if (!isValidRemediationRoleName(parsedRemediationArn.roleName)) {
    errors.push(
      `${where}Remediation Role ARN must reference ${AWS_REMEDIATION_ROLE_NAME_PREFIX}<AssetClass>-<region> (e.g. OpenComp-Remediator-Storage-us-east-1). Got role name "${parsedRemediationArn.roleName}".`,
    );
  }
  // Pair isolation: the ARN must name exactly the role the map key routes
  // to. A prefix check alone would accept another pair's role, and a
  // bare-name check would accept `extra-path/<name>` — a different IAM
  // role object sharing the suffix (generated scripts manage path-less
  // roles only, so paths never legitimately appear here).
  if (parsedRemediationArn.roleName !== args.expectedRoleName) {
    errors.push(
      `${where}Remediation Role ARN must reference the "${args.expectedRoleName}" role for this pair. Got role name "${parsedRemediationArn.roleName}".`,
    );
  }
}

/**
 * Exact IAM role name a validated map key routes to, e.g.
 * `Storage:us-east-1` → `OpenComp-Remediator-Storage-us-east-1`.
 * Call only with keys that pass `isRemediationRoleKey`.
 */
export function expectedRemediationRoleNameForKey(key: string): string {
  const separator = key.indexOf(':');
  const assetClass = key.slice(0, separator) as RemediationAssetClass;
  const region = key.slice(separator + 1);
  return remediationRoleName({ assetClass, region });
}
