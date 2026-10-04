/**
 * Per-pair fix-forward allowlists and policy shape (Phase 2).
 *
 * Split from `./remediation-roles` to respect the 300-line file limit.
 * The lists are verbatim splits of the monolith script blocks — see the
 * notes on `FIX_FORWARD_ALLOWLIST` for the Extended-block distribution.
 */
import type { RemediationAssetClass } from './remediation-roles';

/**
 * Fix-forward allowlist per asset class — split verbatim from the monolith
 * script blocks (`./remediation-script`), with the old "Extended" block
 * distributed to the closest class (Backup/EFS → Storage, Lambda/EKS/
 * Beanstalk/SageMaker/ECR → Compute, ES/MSK/Secrets/ElastiCache/RDS-reads/
 * AppFlow → Data, Shield/WAF/ACM/CloudWatch-logs → Security-Global).
 */
export const FIX_FORWARD_ALLOWLIST: Record<RemediationAssetClass, readonly string[]> = {
  Storage: [
    's3:GetPublicAccessBlock',
    's3:PutPublicAccessBlock',
    's3:GetBucketEncryption',
    's3:PutBucketEncryption',
    's3:GetBucketVersioning',
    's3:PutBucketVersioning',
    's3:GetBucketPolicy',
    'dynamodb:DescribeContinuousBackups',
    'dynamodb:UpdateContinuousBackups',
    'dynamodb:DescribeTable',
    'redshift:DescribeLoggingStatus',
    'redshift:EnableLogging',
    'glue:GetDataCatalogEncryptionSettings',
    'glue:PutDataCatalogEncryptionSettings',
    'athena:GetWorkGroup',
    'backup:CreateBackupPlan',
    'backup:CreateBackupSelection',
    'backup:ListBackupPlans',
    'efs:DescribeFileSystems',
  ],
  Compute: [
    'ec2:GetEbsEncryptionByDefault',
    'ec2:EnableEbsEncryptionByDefault',
    'elasticmapreduce:DescribeCluster',
    'elasticmapreduce:SetTerminationProtection',
    'codebuild:BatchGetProjects',
    'states:DescribeStateMachine',
    'lambda:GetPolicy',
    'lambda:GetFunction',
    'eks:DescribeCluster',
    'elasticbeanstalk:DescribeConfigurationSettings',
    'elasticbeanstalk:DescribeEnvironments',
    'sagemaker:DescribeNotebookInstance',
    'ecr:DescribeRepositories',
    'ecr:PutImageScanningConfiguration',
    'ecr:PutImageTagMutability',
  ],
  Network: [
    'elasticloadbalancing:DescribeLoadBalancerAttributes',
    'elasticloadbalancing:ModifyLoadBalancerAttributes',
    'cloudfront:GetDistributionConfig',
    'cloudfront:GetDistribution',
    'cloudfront:UpdateDistribution',
    'apigateway:GET',
    'apigateway:PATCH',
    'route53:CreateQueryLoggingConfig',
    'route53:ListQueryLoggingConfigs',
    'network-firewall:DescribeLoggingConfiguration',
    'network-firewall:UpdateLoggingConfiguration',
    'transfer:DescribeServer',
    'transfer:UpdateServer',
  ],
  Data: [
    'sns:GetTopicAttributes',
    'sns:SetTopicAttributes',
    'sns:CreateTopic',
    'sqs:GetQueueAttributes',
    'sqs:SetQueueAttributes',
    'sqs:GetQueueUrl',
    'kinesis:DescribeStream',
    'kinesis:StartStreamEncryption',
    'kinesis:EnableEnhancedMonitoring',
    'events:DescribeEventBus',
    'ssm:GetServiceSetting',
    'ssm:GetDocument',
    'ssm:DescribeDocument',
    'rds:DescribeDBInstances',
    'es:DescribeDomain',
    'kafka:DescribeCluster',
    'kafka:UpdateMonitoring',
    'secretsmanager:DescribeSecret',
    'elasticache:DescribeReplicationGroups',
    'elasticache:DescribeCacheClusters',
    'appflow:DescribeFlow',
  ],
  'Security-Global': [
    'kms:GetKeyRotationStatus',
    'kms:EnableKeyRotation',
    'cloudtrail:GetTrailStatus',
    'cloudtrail:GetTrail',
    'cloudtrail:CreateTrail',
    'cloudtrail:StartLogging',
    'cloudtrail:UpdateTrail',
    'guardduty:CreateDetector',
    'guardduty:ListDetectors',
    'config:DescribeConfigurationRecorders',
    'config:DescribeConfigurationRecorderStatus',
    'config:DescribeDeliveryChannels',
    'config:DescribeDeliveryChannelStatus',
    'config:PutConfigurationRecorder',
    'config:PutDeliveryChannel',
    'config:StartConfigurationRecorder',
    'inspector2:Enable',
    'inspector2:BatchGetAccountStatus',
    'macie2:EnableMacie',
    'macie2:GetMacieSession',
    'cognito-idp:DescribeUserPool',
    'iam:GetAccountPasswordPolicy',
    'iam:ListRolePolicies',
    'iam:GetRolePolicy',
    'iam:GetRole',
    'shield:DescribeSubscription',
    'wafv2:GetWebACL',
    'acm:DescribeCertificate',
    'acm:RenewCertificate',
    'logs:PutMetricFilter',
    'logs:DescribeLogGroups',
    'cloudwatch:PutMetricAlarm',
    'cloudwatch:DescribeAlarms',
  ],
};

/**
 * Explicit destructive deny for every per-pair policy. Belt-and-suspenders
 * over the fix-forward allowlist: even if a future allowlist addition is
 * too broad, these can never be granted to a remediator role. Reads that
 * share a prefix with a denied write (e.g. `wafv2:GetWebACL` vs
 * `wafv2:UpdateWebACL`) stay allowed — Deny entries name the write only.
 * IAM follows the same rule: only mutating `iam:` actions are denied so
 * the four allowlisted reads (`GetAccountPasswordPolicy`, `ListRolePolicies`,
 * `GetRolePolicy`, `GetRole`) keep working — a blanket `iam:*` Deny would
 * override the Allow (explicit Deny wins) and break the policy read.
 */
export const NEVER_ALLOW_REMEDIATION_ACTIONS: readonly string[] = [
  's3:Delete*',
  's3:CreateBucket',
  's3:PutBucketPolicy',
  'iam:Add*',
  'iam:Attach*',
  'iam:Change*',
  'iam:Create*',
  'iam:Delete*',
  'iam:Detach*',
  'iam:Disable*',
  'iam:Enable*',
  'iam:PassRole',
  'iam:Put*',
  'iam:Remove*',
  'iam:Set*',
  'iam:Tag*',
  'iam:Untag*',
  'iam:Update*',
  'iam:Upload*',
  'dynamodb:Delete*',
  'redshift:DisableLogging',
  'backup:Delete*',
  'kms:Disable*',
  'kms:ScheduleKeyDeletion',
  'sns:Subscribe',
  'sns:Unsubscribe',
  'events:PutPermission',
  'events:RemovePermission',
  'shield:CreateSubscription',
  'guardduty:Delete*',
  'guardduty:Update*',
  'cloudtrail:DeleteTrail',
  'cloudtrail:StopLogging',
  'config:Delete*',
  'inspector2:Disable*',
  'macie2:DisableMacie',
  'cognito-idp:UpdateUserPool',
  'cognito-idp:Delete*',
  'wafv2:UpdateWebACL',
  'wafv2:Delete*',
  'apigateway:DELETE*',
  'route53:DeleteQueryLoggingConfig',
  'ec2:TerminateInstances',
  'rds:Delete*',
  'rds:ModifyDBInstance',
  'rds:StopDBInstance',
  'es:DeleteDomain',
  'es:UpdateDomainConfig',
  'secretsmanager:DeleteSecret',
  'kafka:Delete*',
];

/** Global services `aws:RequestedRegion` cannot constrain — carved out of the region deny. */
const GLOBAL_SERVICE_CARVE_OUT = ['iam:*', 'cloudfront:*', 'route53:*', 'support:*', 'shield:*'];

export interface RemediationPolicyDocument {
  Version: '2012-10-17';
  Statement: Record<string, unknown>[];
}

/**
 * The 3-statement policy for one pair: fix-forward Allow (+
 * `aws:RequestedRegion` condition on regional roles), region Deny with the
 * globals carve-out, destructive Deny. `Security-Global` carries no region
 * condition — it is assumed in us-east-1 only with human approval.
 *
 * S3 note: bucket ARNs carry no region, so `aws:RequestedRegion` is
 * unreliable for S3 — the Allow stays `Resource: "*"` with the region
 * condition as a best-effort gate (documented in the generated script).
 */
export function buildRemediationPolicyDocument(params: {
  assetClass: RemediationAssetClass;
  region: string;
}): RemediationPolicyDocument {
  const allowStatement: Record<string, unknown> = {
    Sid: 'FixForwardOnly',
    Effect: 'Allow',
    Action: [...FIX_FORWARD_ALLOWLIST[params.assetClass]],
    Resource: '*',
  };
  const statements: Record<string, unknown>[] = [allowStatement];

  if (params.assetClass !== 'Security-Global') {
    allowStatement.Condition = {
      StringEquals: { 'aws:RequestedRegion': [params.region] },
    };
    // IfExists: requests that carry no region (S3, other keyless calls)
    // must not match the deny — a plain StringNotEquals is true when the
    // key is absent, which would deny legitimate in-region fixes.
    statements.push({
      Sid: 'DenyOutsideRegion',
      Effect: 'Deny',
      NotAction: [...GLOBAL_SERVICE_CARVE_OUT],
      Resource: '*',
      Condition: { StringNotEqualsIfExists: { 'aws:RequestedRegion': [params.region] } },
    });
  }

  statements.push({
    Sid: 'NeverDestructive',
    Effect: 'Deny',
    Action: [...NEVER_ALLOW_REMEDIATION_ACTIONS],
    Resource: '*',
  });

  return { Version: '2012-10-17', Statement: statements };
}
