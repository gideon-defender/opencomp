import type { AwsEnvironment } from './credentials';
import { getAwsRoleAssumerArn } from './credentials';
import {
  buildRemediationPolicyDocument,
  escapeDoubleQuotedShell,
  remediationRoleName,
  type RemediationAssetClass,
} from './remediation-roles';

/**
 * CloudShell setup script for the remediation IAM role (the auditor role
 * stays read-only). Grants fix-forward actions only — everything in
 * `@gideon-defender/utils/remediation-denylist` stays manual-review-only.
 *
 * Split out of `./credentials` to respect the 300-line file limit — edit
 * the script here, never by copying it elsewhere.
 */
/**
 * Monolith remediation role script.
 *
 * @deprecated During the Phase 2 dual-read window this still provisions the
 * legacy single `OpenComp-Remediator` role for connections without a
 * `remediationRoles` map. New setups must use
 * {@link getAwsRemediationScriptForPair} per asset-class x region pair.
 * Removal is tracked in Phase 4 of the split plan.
 */
export function getAwsRemediationScript(environment: AwsEnvironment = 'aws'): string {
  const roleAssumerArn = getAwsRoleAssumerArn(environment);

  return `# Create Remediation Role for Auto-Fix (fix-forward only)
# Run this in AWS CloudShell after setting up the Auditor role.
# Safe to re-run: an existing role is reused, its trust policy is RESET to
# the document below (re-add any custom principals afterwards), its max
# session duration is converged in place, its policies are OVERWRITTEN
# in place, and the legacy destructive rollback policy is removed.

(
set -euo pipefail

EXTERNAL_ID="YOUR_EXTERNAL_ID"
ROLE_NAME="OpenComp-Remediator"
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

# Remove the legacy destructive rollback policy if present (denylist cleanup).
# Consequence: automatic rollback of Delete/Stop/Disable undo steps loses its
# grants — a failed fix keeps partial changes and the API says so explicitly
# instead of implying a clean non-application.
aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name OpenComp-Rollback 2>/dev/null || true
# Remove the mis-cased security policy from earlier script versions so it
# does not linger alongside the correctly-cased one below.
aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name opencomp-securityRemediation 2>/dev/null || true

# Storage Remediation (fix-forward): S3 encryption/versioning/PAB, DynamoDB PITR, Redshift logging, Glue, Athena
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name OpenComp-StorageRemediation \\
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetPublicAccessBlock","s3:PutPublicAccessBlock","s3:GetBucketEncryption","s3:PutBucketEncryption","s3:GetBucketVersioning","s3:PutBucketVersioning","s3:GetBucketPolicy","dynamodb:DescribeContinuousBackups","dynamodb:UpdateContinuousBackups","dynamodb:DescribeTable","redshift:DescribeLoggingStatus","redshift:EnableLogging","glue:GetDataCatalogEncryptionSettings","glue:PutDataCatalogEncryptionSettings","athena:GetWorkGroup"],"Resource":"*"}]}'

# Compute Remediation (fix-forward): EBS default encryption, EMR termination protection (reads for CodeBuild/Step Functions)
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name OpenComp-ComputeRemediation \\
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["ec2:GetEbsEncryptionByDefault","ec2:EnableEbsEncryptionByDefault","elasticmapreduce:DescribeCluster","elasticmapreduce:SetTerminationProtection","codebuild:BatchGetProjects","states:DescribeStateMachine"],"Resource":"*"}]}'

# Network Remediation: ELB, CloudFront, API Gateway, Route53 query logging, Network Firewall, Transfer Family
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name OpenComp-NetworkRemediation \\
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["elasticloadbalancing:DescribeLoadBalancerAttributes","elasticloadbalancing:ModifyLoadBalancerAttributes","cloudfront:GetDistributionConfig","cloudfront:GetDistribution","cloudfront:UpdateDistribution","apigateway:GET","apigateway:PATCH","route53:CreateQueryLoggingConfig","route53:ListQueryLoggingConfigs","network-firewall:DescribeLoggingConfiguration","network-firewall:UpdateLoggingConfiguration","transfer:DescribeServer","transfer:UpdateServer"],"Resource":"*"}]}'

# Security Remediation (enable-only): KMS rotation, CloudTrail, GuardDuty, Config, Inspector, Macie (reads for Cognito/IAM)
# NOTE: iam:UpdateAccountPasswordPolicy is intentionally absent — it is an
# iam write the denylist blocks from auto-grant, so it needs manual review.
# NOTE: guardduty:UpdateDetector is intentionally absent — it takes
# 'Enable: false' and would let a generated script silently blind GuardDuty.
# Detector creation stays covered via guardduty:CreateDetector; detector
# config changes need manual review (see the denylist).
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name OpenComp-SecurityRemediation \\
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["kms:GetKeyRotationStatus","kms:EnableKeyRotation","cloudtrail:GetTrailStatus","cloudtrail:GetTrail","cloudtrail:CreateTrail","cloudtrail:StartLogging","cloudtrail:UpdateTrail","guardduty:CreateDetector","guardduty:ListDetectors","config:DescribeConfigurationRecorders","config:DescribeConfigurationRecorderStatus","config:DescribeDeliveryChannels","config:DescribeDeliveryChannelStatus","config:PutConfigurationRecorder","config:PutDeliveryChannel","config:StartConfigurationRecorder","inspector2:Enable","inspector2:BatchGetAccountStatus","macie2:EnableMacie","macie2:GetMacieSession","cognito-idp:DescribeUserPool","iam:GetAccountPasswordPolicy","iam:ListRolePolicies","iam:GetRolePolicy","iam:GetRole"],"Resource":"*"}]}'

# Messaging Remediation (fix-forward): SNS/SQS attributes, KMS rotation reads, Kinesis encryption, EventBridge/ECR/RDS reads
# NOTE: ssm:UpdateServiceSetting is intentionally absent — the guardrails
# refuse UpdateServiceSettingCommand wholesale ("never the documented fix"),
# so granting it would widen the role for a command that can never execute
# as an auto-fix. Account-wide SSM mutations need manual review.
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name OpenComp-MessagingRemediation \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["sns:GetTopicAttributes","sns:SetTopicAttributes","sns:CreateTopic","sqs:GetQueueAttributes","sqs:SetQueueAttributes","sqs:GetQueueUrl","kinesis:DescribeStream","kinesis:StartStreamEncryption","kinesis:EnableEnhancedMonitoring","events:DescribeEventBus","ecr:DescribeRepositories","ecr:PutImageScanningConfiguration","ecr:PutImageTagMutability","ssm:GetServiceSetting","ssm:GetDocument","ssm:DescribeDocument","rds:DescribeDBInstances"],"Resource":"*"}]}'

# Extended Remediation (fix-forward): CloudWatch metric filters/alarms, Backup create, ACM renew, reads for Shield/Beanstalk/Lambda/EKS/OpenSearch/MSK/Secrets/SageMaker/ElastiCache/EFS/AppFlow/WAF
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name OpenComp-ExtendedRemediation \\
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["shield:DescribeSubscription","elasticbeanstalk:DescribeConfigurationSettings","elasticbeanstalk:DescribeEnvironments","lambda:GetPolicy","lambda:GetFunction","eks:DescribeCluster","logs:PutMetricFilter","logs:DescribeLogGroups","cloudwatch:PutMetricAlarm","cloudwatch:DescribeAlarms","backup:CreateBackupPlan","backup:CreateBackupSelection","backup:ListBackupPlans","es:DescribeDomain","kafka:DescribeCluster","kafka:UpdateMonitoring","secretsmanager:DescribeSecret","sagemaker:DescribeNotebookInstance","acm:DescribeCertificate","acm:RenewCertificate","elasticache:DescribeReplicationGroups","elasticache:DescribeCacheClusters","efs:DescribeFileSystems","appflow:DescribeFlow","wafv2:GetWebACL"],"Resource":"*"}]}'

echo ""
echo "============================================"
echo "  Remediation Role ARN (paste this below):"
echo ""
echo "  $ROLE_ARN"
echo ""
echo "============================================"
)`;
}

export const awsRemediationScript = getAwsRemediationScript();

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
