import { z } from 'zod';

import { escapeDoubleQuotedShell } from './remediation-roles';

export type AwsEnvironment = 'aws' | 'aws-us-gov';

const COMP_AI_COMMERCIAL_ROLE_ASSUMER_ACCOUNT_ID = '684120556289';
const COMP_AI_GOVCLOUD_ROLE_ASSUMER_ACCOUNT_ID = '633779453318';

export function normalizeAwsEnvironment(value: unknown): AwsEnvironment {
  return value === 'aws-us-gov' ? 'aws-us-gov' : 'aws';
}

export function getAwsRoleAssumerArn(environment: AwsEnvironment): string {
  const accountId =
    environment === 'aws-us-gov'
      ? COMP_AI_GOVCLOUD_ROLE_ASSUMER_ACCOUNT_ID
      : COMP_AI_COMMERCIAL_ROLE_ASSUMER_ACCOUNT_ID;

  return `arn:${environment}:iam::${accountId}:role/roleAssumer`;
}

function getAwsManagedPolicyArn(environment: AwsEnvironment, policyName: string): string {
  return `arn:${environment}:iam::aws:policy/${policyName}`;
}

export function getAwsCloudShellUrl(environment: AwsEnvironment = 'aws'): string {
  return environment === 'aws-us-gov'
    ? 'https://console.amazonaws-us-gov.com/cloudshell'
    : 'https://console.aws.amazon.com/cloudshell';
}

/**
 * AWS credential fields for the connection form
 */
export const awsCredentialFields = [
  {
    id: 'awsType',
    label: 'AWS Environment',
    type: 'select' as const,
    required: true,
    placeholder: 'Select AWS environment',
    helpText: 'Choose the AWS partition where this account runs.',
    options: [
      { value: 'aws', label: 'Commercial AWS' },
      { value: 'aws-us-gov', label: 'AWS GovCloud (US)' },
    ],
  },
  {
    id: 'connectionName',
    label: 'Connection Name',
    type: 'text' as const,
    required: true,
    placeholder: 'Production Account',
    helpText: 'A friendly name to identify this AWS account',
  },
  {
    id: 'roleArn',
    label: 'Role ARN',
    type: 'text' as const,
    required: true,
    placeholder: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
    helpText: 'Paste the Role ARN from the script output above',
  },
  {
    id: 'externalId',
    label: 'External ID',
    type: 'text' as const,
    required: false,
    placeholder: 'Issued automatically (org_<orgId>_<id>)',
    helpText:
      'Minted by the server when the connection is created and shown once in the setup flow. Paste it nowhere — the setup script already carries it. Existing connections keep their stored value.',
  },
  {
    id: 'remediationRoleArn',
    label: 'Remediation Role ARN',
    type: 'text' as const,
    required: false,
    placeholder: 'arn:aws:iam::123456789012:role/OpenComp-Remediator',
    helpText:
      'Optional: A separate IAM role with write permissions for auto-remediation. The audit role stays read-only.',
  },
  {
    id: 'regions',
    label: 'Regions to scan',
    type: 'multi-select' as const,
    required: true,
    placeholder: 'Select regions...',
    helpText: 'Choose which AWS regions to scan for security findings',
    options: [
      // US Regions
      { value: 'us-east-1', label: 'us-east-1 (N. Virginia)' },
      { value: 'us-east-2', label: 'us-east-2 (Ohio)' },
      { value: 'us-west-1', label: 'us-west-1 (N. California)' },
      { value: 'us-west-2', label: 'us-west-2 (Oregon)' },
      // AWS GovCloud (US) Regions
      { value: 'us-gov-west-1', label: 'us-gov-west-1 (GovCloud US-West)' },
      { value: 'us-gov-east-1', label: 'us-gov-east-1 (GovCloud US-East)' },
      // Europe Regions
      { value: 'eu-west-1', label: 'eu-west-1 (Ireland)' },
      { value: 'eu-west-2', label: 'eu-west-2 (London)' },
      { value: 'eu-west-3', label: 'eu-west-3 (Paris)' },
      { value: 'eu-central-1', label: 'eu-central-1 (Frankfurt)' },
      { value: 'eu-central-2', label: 'eu-central-2 (Zurich)' },
      { value: 'eu-north-1', label: 'eu-north-1 (Stockholm)' },
      { value: 'eu-south-1', label: 'eu-south-1 (Milan)' },
      { value: 'eu-south-2', label: 'eu-south-2 (Spain)' },
      // Asia Pacific Regions
      { value: 'ap-east-1', label: 'ap-east-1 (Hong Kong)' },
      { value: 'ap-south-1', label: 'ap-south-1 (Mumbai)' },
      { value: 'ap-south-2', label: 'ap-south-2 (Hyderabad)' },
      { value: 'ap-northeast-1', label: 'ap-northeast-1 (Tokyo)' },
      { value: 'ap-northeast-2', label: 'ap-northeast-2 (Seoul)' },
      { value: 'ap-northeast-3', label: 'ap-northeast-3 (Osaka)' },
      { value: 'ap-southeast-1', label: 'ap-southeast-1 (Singapore)' },
      { value: 'ap-southeast-2', label: 'ap-southeast-2 (Sydney)' },
      { value: 'ap-southeast-3', label: 'ap-southeast-3 (Jakarta)' },
      { value: 'ap-southeast-4', label: 'ap-southeast-4 (Melbourne)' },
      { value: 'ap-southeast-5', label: 'ap-southeast-5 (Malaysia)' },
      // Canada
      { value: 'ca-central-1', label: 'ca-central-1 (Central)' },
      { value: 'ca-west-1', label: 'ca-west-1 (Calgary)' },
      // South America
      { value: 'sa-east-1', label: 'sa-east-1 (São Paulo)' },
      // Middle East
      { value: 'me-south-1', label: 'me-south-1 (Bahrain)' },
      { value: 'me-central-1', label: 'me-central-1 (UAE)' },
      // Africa
      { value: 'af-south-1', label: 'af-south-1 (Cape Town)' },
      // Israel
      { value: 'il-central-1', label: 'il-central-1 (Tel Aviv)' },
    ],
  },
];

/**
 * Validation schema for AWS credentials
 */
export const awsCredentialSchema = z.object({
  awsType: z.enum(['aws', 'aws-us-gov']),
  connectionName: z.string().min(1, 'Connection name is required'),
  roleArn: z
    .string()
    .regex(
      /^arn:(aws|aws-us-gov):iam::\d{12}:role\/[A-Za-z0-9_+=,.@/-]+$/,
      'Must be a valid IAM Role ARN',
    ),
  externalId: z.string().min(1).optional().or(z.literal('')),
  remediationRoleArn: z
    .string()
    .regex(
      /^arn:(aws|aws-us-gov):iam::\d{12}:role\/[A-Za-z0-9_+=,.@/-]+$/,
      'Must be a valid IAM Role ARN',
    )
    .optional()
    .or(z.literal('')),
  // Per-pair map, stored as a JSON string: { "Class:region": "arn:..." }.
  // Preferred over the legacy single ARN (dual-read window keeps both).
  // Shape-checked server-side in validateAwsPartitionConfig; the schema
  // only asserts "looks like a JSON object" so malformed input fails here.
  remediationRoles: z
    .string()
    .refine(
      (value) => {
        if (!value.trim()) return true;
        try {
          const parsed: unknown = JSON.parse(value);
          return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
        } catch {
          return false;
        }
      },
      { message: 'Must be a JSON object mapping "<AssetClass>:<region>" to role ARN' },
    )
    .optional()
    .or(z.literal('')),
  regions: z.array(z.string()).min(1, 'Select at least one region'),
});

/**
 * CloudShell setup script for customers to create the IAM role.
 * Pass the connection's server-issued External ID so the script is ready
 * to run as-is; the default placeholder keeps generic (pre-connection)
 * renders working. The value is escaped for the double-quoted assignment.
 */
export function getAwsCloudShellScript(
  environment: AwsEnvironment = 'aws',
  externalId = 'YOUR_EXTERNAL_ID',
): string {
  const roleAssumerArn = getAwsRoleAssumerArn(environment);
  const securityAuditPolicyArn = getAwsManagedPolicyArn(environment, 'SecurityAudit');
  const viewOnlyPolicyArn = getAwsManagedPolicyArn(environment, 'job-function/ViewOnlyAccess');
  const safeExternalId = escapeDoubleQuotedShell(externalId);

  return `# Create Auditor Role for OpenComp
# Run this in AWS CloudShell to create the read-only IAM role.
# EXTERNAL_ID below is issued for your connection — use it as-is.

(
set -euo pipefail

EXTERNAL_ID="${safeExternalId}"
ROLE_NAME="OpenComp-Auditor"

echo "Creating IAM role $ROLE_NAME..."

ROLE_ARN=$(aws iam create-role --role-name "$ROLE_NAME" --max-session-duration 43200 \\
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"${roleAssumerArn}"},"Action":"sts:AssumeRole","Condition":{"StringEquals":{"sts:ExternalId":"'$EXTERNAL_ID'"}}}]}' \\
  --query 'Role.Arn' --output text)

aws iam attach-role-policy --role-name "$ROLE_NAME" \\
  --policy-arn ${securityAuditPolicyArn}

aws iam attach-role-policy --role-name "$ROLE_NAME" \\
  --policy-arn ${viewOnlyPolicyArn}

aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name OpenComp-CostExplorer \\
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"ce:GetCostAndUsage","Resource":"*"}]}'

aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name OpenComp-ExtraReadAccess \\
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["ssm:GetDocument","ssm:DescribeDocument","ssm:ListDocuments","iam:GetLoginProfile"],"Resource":"*"}]}'

echo ""
echo "============================================"
echo "  Role ARN (paste this below):"
echo ""
echo "  $ROLE_ARN"
echo ""
echo "============================================"
)`;
}

export const awsCloudShellScript = getAwsCloudShellScript();

/**
 * Setup instructions for AWS IAM Role (partition-aware).
 * Pass the connection's server-issued External ID so the command is ready
 * to run as-is; the default placeholder keeps generic (pre-connection)
 * renders working. The value is escaped for the double-quoted assignment.
 *
 * NOTE: the AWS manifest does not ship these statically — a static string
 * can never carry the per-connection issued value, and a copyable command
 * with the placeholder creates a role the server rejects. Surfaces that
 * need instructions render the per-connection CloudShell script instead.
 */
export function getAwsSetupInstructions(
  environment: AwsEnvironment = 'aws',
  externalId = 'YOUR_EXTERNAL_ID',
): string {
  const roleAssumerArn = getAwsRoleAssumerArn(environment);
  const securityAuditPolicyArn = getAwsManagedPolicyArn(environment, 'SecurityAudit');
  const viewOnlyPolicyArn = getAwsManagedPolicyArn(environment, 'job-function/ViewOnlyAccess');
  const cloudShellUrl = getAwsCloudShellUrl(environment);
  const safeExternalId = escapeDoubleQuotedShell(externalId);

  return `Setup (AWS CloudShell)

1. Open AWS CloudShell at ${cloudShellUrl.replace('https://', '')}
2. Generate the connection in OpenComp first — OpenComp issues a unique External ID per connection. Run the following command with your issued value (the connect flow shows the exact script):

EXTERNAL_ID="${safeExternalId}" && ROLE_NAME="OpenComp-Auditor" && aws iam create-role --role-name "$ROLE_NAME" --max-session-duration 43200 --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"${roleAssumerArn}"},"Action":"sts:AssumeRole","Condition":{"StringEquals":{"sts:ExternalId":"'$EXTERNAL_ID'"}}}]}' --query 'Role.Arn' --output text && aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn ${securityAuditPolicyArn} && aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn ${viewOnlyPolicyArn} && aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name OpenComp-CostExplorer --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"ce:GetCostAndUsage","Resource":"*"}]}' && aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name OpenComp-ExtraReadAccess --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["ssm:GetDocument","ssm:DescribeDocument","ssm:ListDocuments","iam:GetLoginProfile"],"Resource":"*"}]}'

3. Copy the Role ARN from the output
4. Paste the Role ARN into the form below (the External ID is already on file)`;
}
