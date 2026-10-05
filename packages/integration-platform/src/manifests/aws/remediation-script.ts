import type { AwsEnvironment } from './credentials';
import { getAwsRoleAssumerArn } from './credentials';
import {
  buildRemediationPolicyDocument,
  escapeDoubleQuotedShell,
  remediationRoleName,
  type RemediationAssetClass,
} from './remediation-roles';

/**
 * CloudShell setup scripts for per-pair remediation IAM roles
 * (`OpenComp-Remediator-{AssetClass}-{Region}`). The monolith
 * `OpenComp-Remediator` generator was removed in Phase 4 — that role name
 * survives only in the detection patterns, which still watch it.
 */
export interface RemediationScriptPair {
  assetClass: RemediationAssetClass;
  /** Target region. Ignored for `Security-Global` (pinned to us-east-1). */
  region: string;
}

/**
 * CloudShell setup script for ONE per-pair remediation role
 * (`OpenComp-Remediator-{AssetClass}-{Region}`). Same trust shape as the
 * monolith (roleAssumer principal + server-supplied External ID), one
 * 3-statement policy (fix-forward Allow + region Deny + destructive Deny).
 *
 * `Security-Global` roles carry no region condition, are assumed in
 * us-east-1 only, and print a human-approval warning — highest blast
 * radius, gated last per the rollout plan.
 *
 * S3 limitation (documented in the script output): bucket ARNs carry no
 * region, so `aws:RequestedRegion` is a best-effort gate for S3 — narrow
 * further with `arn:<partition>:s3:::<prefix>-*` resources when the
 * account uses a bucket prefix, otherwise keep those fixes manual.
 */
export function getAwsRemediationScriptForPair(
  environment: AwsEnvironment = 'aws',
  pair: RemediationScriptPair,
  externalId = 'YOUR_EXTERNAL_ID',
): string {
  const roleAssumerArn = getAwsRoleAssumerArn(environment);
  const roleName = remediationRoleName(pair);
  const effectiveRegion = pair.assetClass === 'Security-Global' ? 'us-east-1' : pair.region.trim();
  // roleName and the policy document derive from validated builders only:
  // roleName is charset-checked in remediationRoleName, and the policy
  // document is JSON (single-quoted below) whose only variable content is
  // the validated region — neither can carry shell metacharacters. The
  // external ID is caller-controlled free text, so it is escaped for the
  // double-quoted assignment below.
  const safeExternalId = escapeDoubleQuotedShell(externalId);
  const policyDocument = JSON.stringify(
    buildRemediationPolicyDocument({ assetClass: pair.assetClass, region: effectiveRegion }),
  );
  const approvalWarning =
    pair.assetClass === 'Security-Global'
      ? '# WARNING: this role covers account/global services (IAM reads, KMS, CloudTrail,\n# GuardDuty, Config, WAF, ACM). It is assumed in us-east-1 only and every use\n# of it should go through explicit human approval — enable it last.\n'
      : '';

  return `# Create Remediation Role ${roleName} (fix-forward only)
# Run this in AWS CloudShell after setting up the Auditor role.
# Safe to re-run: an existing role is reused, its trust policy is RESET to
# the document below (re-add any custom principals afterwards), its max
# session duration is converged in place, and its policy is OVERWRITTEN.
# S3 note: bucket ARNs carry no region, so the region gate below is
# best-effort for S3 — keep S3 fixes manual unless buckets share a prefix
# you scope here.

(
set -euo pipefail

EXTERNAL_ID="${safeExternalId}"
ROLE_NAME="${roleName}"
TRUST_POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"${roleAssumerArn}"},"Action":"sts:AssumeRole","Condition":{"StringEquals":{"sts:ExternalId":"'"$EXTERNAL_ID"'"}}}]}'

ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || aws iam create-role --role-name "$ROLE_NAME" --max-session-duration 3600 \\
  --assume-role-policy-document "$TRUST_POLICY" \\
  --query 'Role.Arn' --output text)

# Reset trust to the expected document on pre-existing roles (this
# overwrites — it does not merge — so custom principals need re-adding).
# Converge the session cap (IAM minimum is 3600s; the API requests 900s
# sessions which fit inside that cap).
aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST_POLICY"
aws iam update-role --role-name "$ROLE_NAME" --max-session-duration 3600

${approvalWarning}aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name OpenComp-Remediation \\
  --policy-document '${policyDocument}'

echo ""
echo "============================================"
echo "  Remediation Role ARN (paste this below):"
echo ""
echo "  $ROLE_ARN"
echo ""
echo "============================================"
)`;
}
