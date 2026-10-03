import type { AwsEnvironment } from './credentials';
import { getAwsRoleAssumerArn } from './credentials';

/**
 * CloudShell setup script for the remediation IAM role (the auditor role
 * stays read-only). Grants fix-forward actions only — everything in
 * `@gideon-defender/utils/remediation-denylist` stays manual-review-only.
 *
 * Split out of `./credentials` to respect the 300-line file limit — edit
 * the script here, never by copying it elsewhere.
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
