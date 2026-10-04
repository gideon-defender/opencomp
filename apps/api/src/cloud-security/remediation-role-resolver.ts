import {
  findingToAssetClass,
  remediationRoleName,
  SECURITY_GLOBAL_PINNED_REGION,
  type RemediationAssetClass,
} from '@gideon-defender/integration-platform';
import {
  remediationRoleNameFromArn,
  resolveRemediationRoleArn,
} from './aws-partition.utils';

/**
 * Resolve the remediation role for one finding: pair map first
 * (`Class:region`), legacy single ARN as fallback (dual-read window).
 * `roleName` is the bare IAM name for `iam:*` API reads; both are
 * `undefined` when the connection has no role for this pair — callers
 * fail closed (guided-only preview / throw) instead of assuming.
 *
 * Routing is not authorization: callers must additionally refuse
 * auto-execute for `isApprovalGatedAssetClass(assetClass)` (Network,
 * Security-Global) — a configured pair role there enables reads, never
 * writes.
 */
export function resolveFindingRemediationRole(args: {
  credentials: Record<string, unknown>;
  resourceType: string | null;
  region: string;
}): {
  roleArn: string | undefined;
  roleName: string | undefined;
  assetClass: RemediationAssetClass;
  expectedRoleName: string;
} {
  const assetClass = findingToAssetClass(args.resourceType);
  // Blank regions are rejected at connection validation, so this fallback
  // is unreachable defense — it keeps role-name minting total.
  const region = args.region.trim() || 'us-east-1';
  // Garbage regions (evidence typos, unexpected casing) must degrade to
  // guided-only, never throw a 500 out of preview. Minting throws on
  // anything outside the region charset, so catch here and leave the
  // role unresolved — every caller already fails closed on undefined.
  let expectedRoleName: string;
  try {
    expectedRoleName = remediationRoleName({ assetClass, region });
  } catch {
    // The global class is pinned to one region, so its expected name
    // does not depend on the finding's region — minting it with a
    // garbage region would name a role that can never validate.
    expectedRoleName =
      assetClass === 'Security-Global'
        ? remediationRoleName({
            assetClass,
            region: SECURITY_GLOBAL_PINNED_REGION,
          })
        : `OpenComp-Remediator-${assetClass}-${region}`;
    return {
      roleArn: undefined,
      roleName: undefined,
      assetClass,
      expectedRoleName,
    };
  }
  const roleArn = resolveRemediationRoleArn({
    credentials: args.credentials,
    resourceType: args.resourceType,
    region,
  });
  return {
    roleArn,
    roleName: roleArn ? remediationRoleNameFromArn(roleArn) : undefined,
    assetClass,
    expectedRoleName,
  };
}
