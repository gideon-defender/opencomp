import type { AwsEnvironment } from './credentials';
import {
  AWS_LEGACY_REMEDIATION_ROLE_NAME,
  AWS_REMEDIATION_ROLE_NAME_PREFIX,
  escapeDoubleQuotedShell,
} from './remediation-roles';

/**
 * Customer-side detection for the per-pair remediation roles
 * (`OpenComp-Remediator-{AssetClass}-{Region}`, plus the legacy monolith).
 *
 * OpenComp cannot deploy into the customer's account, so this module ships
 * the artifacts the customer deploys instead:
 *
 * - three EventBridge event patterns (real-time alerts),
 * - three CloudTrail Lake queries (threat-hunt / forensics),
 * - a CloudShell setup script wiring the rules to an SNS email topic.
 *
 * The three signals mirror the rollout plan: every remediator assume,
 * every denied call from a remediator session (covers `DenyOutsideRegion`
 * hits — the explicit-deny Sid is not recorded in the event, so match on
 * the assumed-role session ARN instead), and any `Security-Global` use.
 */

export const REMEDIATION_DETECTION_TOPIC_NAME = 'OpenComp-Remediator-Alerts';

export const REMEDIATION_DETECTION_RULES = [
  'OpenComp-RemediatorAssume',
  'OpenComp-RemediatorDenied',
  'OpenComp-RemediatorSecurityGlobal',
] as const;

export type RemediationDetectionRule = (typeof REMEDIATION_DETECTION_RULES)[number];

export const REMEDIATION_DETECTION_SUBJECTS: Record<RemediationDetectionRule, string> = {
  'OpenComp-RemediatorAssume': 'OpenComp: remediation role assumed',
  'OpenComp-RemediatorDenied': 'OpenComp: denied call from a remediation session',
  'OpenComp-RemediatorSecurityGlobal':
    'OpenComp: Security-Global remediation role used (review required)',
};

export interface RemediationDetectionPatternOptions {
  /** IAM partition for role ARNs. Defaults to `aws` (`aws-us-gov` for GovCloud). */
  partition?: AwsEnvironment;
}

export interface RemediationDetectionScriptOptions {
  /** Email that receives the alerts (subscribed to the SNS topic, confirmation required). */
  email: string;
  /** SNS topic name. Defaults to `OpenComp-Remediator-Alerts`. */
  topicName?: string;
  partition?: AwsEnvironment;
}

/**
 * Resolve the IAM partition, rejecting anything outside the environments
 * the repo models. A free-form partition would flow into EventBridge JSON
 * embedded in a single-quoted shell string — JSON does not escape single
 * quotes, so validation here is what keeps the generated script intact.
 *
 * Deliberately strict (throws), unlike `normalizeAwsEnvironment` in
 * `./credentials` which defaults unknown input to `aws` for the connection
 * form. A silent default here would emit a broken detector that drops
 * GovCloud alerts, so this path fails fast instead.
 */
const resolvePartition = (
  options?: RemediationDetectionPatternOptions | RemediationDetectionScriptOptions,
): AwsEnvironment => {
  const partition = options?.partition ?? 'aws';
  if (partition !== 'aws' && partition !== 'aws-us-gov') {
    throw new Error(`unknown IAM partition: "${partition}" (expected "aws" or "aws-us-gov")`);
  }
  return partition;
};

/**
 * AssumeRole calls against any remediator role (per-pair + legacy monolith).
 * Fires on success AND on failed assumes (wrong ExternalId probes included —
 * those are signal, not noise).
 */
export function buildRemediationAssumePattern(
  options?: RemediationDetectionPatternOptions,
): Record<string, unknown> {
  const partition = resolvePartition(options);
  return {
    source: ['aws.sts'],
    'detail-type': ['AWS API Call via CloudTrail'],
    detail: {
      eventSource: ['sts.amazonaws.com'],
      eventName: ['AssumeRole'],
      requestParameters: {
        roleArn: [
          { wildcard: `arn:${partition}:iam::*:role/${AWS_LEGACY_REMEDIATION_ROLE_NAME}` },
          { wildcard: `arn:${partition}:iam::*:role/${AWS_REMEDIATION_ROLE_NAME_PREFIX}*` },
        ],
      },
    },
  };
}

/**
 * Denied API calls made from a remediator session. This is the observable
 * proxy for `DenyOutsideRegion` / `NeverDestructive` hits: CloudTrail does
 * not record which Sid denied the call, but the assumed-role session ARN
 * (`assumed-role/OpenComp-Remediator-…/finding-…`) identifies the actor.
 */
export function buildRemediationDeniedPattern(
  options?: RemediationDetectionPatternOptions,
): Record<string, unknown> {
  const partition = resolvePartition(options);
  // No `source` filter: a denied call arrives under the *called* service's
  // source (aws.s3, aws.ec2, …), so scoping to one source would miss most
  // hits. The errorCode + session-ARN pair is the selective part.
  // Two ARN entries (not one bare prefix): assumed-role ARNs always carry a
  // `/session-name` suffix, so the legacy role matches `…/OpenComp-Remediator/*`
  // while per-pair roles match `…/OpenComp-Remediator-*`. A single
  // `OpenComp-Remediator*` entry would also match unrelated roles such as
  // `OpenComp-RemediatorEvil`.
  return {
    'detail-type': ['AWS API Call via CloudTrail'],
    detail: {
      errorCode: ['AccessDenied', 'AccessDeniedException'],
      userIdentity: {
        arn: [
          {
            wildcard: `arn:${partition}:sts::*:assumed-role/${AWS_LEGACY_REMEDIATION_ROLE_NAME}/*`,
          },
          {
            wildcard: `arn:${partition}:sts::*:assumed-role/${AWS_REMEDIATION_ROLE_NAME_PREFIX}*`,
          },
        ],
      },
    },
  };
}

/**
 * Any use of the `Security-Global` role. It holds the highest-blast-radius
 * writes (KMS, CloudTrail, Config, GuardDuty-enable, WAF, Cognito,
 * IAM-password-policy) and is human-gated — every assume pages a human.
 */
export function buildSecurityGlobalAssumePattern(
  options?: RemediationDetectionPatternOptions,
): Record<string, unknown> {
  const partition = resolvePartition(options);
  return {
    source: ['aws.sts'],
    'detail-type': ['AWS API Call via CloudTrail'],
    detail: {
      eventSource: ['sts.amazonaws.com'],
      eventName: ['AssumeRole'],
      requestParameters: {
        roleArn: [
          {
            wildcard: `arn:${partition}:iam::*:role/${AWS_REMEDIATION_ROLE_NAME_PREFIX}Security-Global`,
          },
        ],
      },
    },
  };
}

export function buildDetectionPattern(params: {
  rule: RemediationDetectionRule;
  options?: RemediationDetectionPatternOptions;
}): Record<string, unknown> {
  switch (params.rule) {
    case 'OpenComp-RemediatorAssume':
      return buildRemediationAssumePattern(params.options);
    case 'OpenComp-RemediatorDenied':
      return buildRemediationDeniedPattern(params.options);
    case 'OpenComp-RemediatorSecurityGlobal':
      return buildSecurityGlobalAssumePattern(params.options);
    default:
      throw new Error(`unknown remediation detection rule: "${params.rule}"`);
  }
}

export interface RemediationLakeQuery {
  name: string;
  description: string;
  /** Presto/Trino SQL against the CloudTrail Lake event data store. `<EDS_ID>` is the store ID. */
  sql: string;
}

export const REMEDIATION_LAKE_QUERIES: RemediationLakeQuery[] = [
  {
    name: 'remediator-assumes-7d',
    description:
      'Every AssumeRole against a remediator role in the last 7 days, including failed assumes (wrong-ExternalId probes).',
    sql: `SELECT eventTime, userIdentity.arn AS assumer, requestParameters.roleArn AS roleArn, sourceIPAddress, errorCode
FROM <EDS_ID>
WHERE eventSource = 'sts.amazonaws.com' AND eventName = 'AssumeRole'
  AND (requestParameters.roleArn LIKE '%:role/${AWS_LEGACY_REMEDIATION_ROLE_NAME}'
    OR requestParameters.roleArn LIKE '%:role/${AWS_REMEDIATION_ROLE_NAME_PREFIX}%')
  AND eventTime > date_add('day', -7, current_timestamp)
ORDER BY eventTime DESC LIMIT 100`,
  },
  {
    name: 'remediator-denied-7d',
    description:
      'Denied API calls from remediator sessions — the forensic view of DenyOutsideRegion / NeverDestructive hits.',
    sql: `SELECT eventTime, eventSource, eventName, userIdentity.arn AS sessionArn, errorCode, errorMessage
FROM <EDS_ID>
WHERE errorCode IN ('AccessDenied', 'AccessDeniedException')
  AND (userIdentity.arn LIKE '%assumed-role/${AWS_LEGACY_REMEDIATION_ROLE_NAME}/%'
    OR userIdentity.arn LIKE '%assumed-role/${AWS_REMEDIATION_ROLE_NAME_PREFIX}%')
  AND eventTime > date_add('day', -7, current_timestamp)
ORDER BY eventTime DESC LIMIT 100`,
  },
  {
    name: 'security-global-use-30d',
    description:
      'Every assume and every session call for the Security-Global role in the last 30 days. Each row needs a human review note.',
    sql: `SELECT eventTime, eventSource, eventName, userIdentity.arn AS actor, requestParameters.roleArn AS roleArn, errorCode
FROM <EDS_ID>
WHERE (requestParameters.roleArn LIKE '%:role/${AWS_REMEDIATION_ROLE_NAME_PREFIX}Security-Global'
   OR userIdentity.arn LIKE '%assumed-role/${AWS_REMEDIATION_ROLE_NAME_PREFIX}Security-Global/%')
  AND eventTime > date_add('day', -30, current_timestamp)
ORDER BY eventTime DESC LIMIT 100`,
  },
];

/** SNS topic names allow letters, numbers, hyphens, and underscores (max 256 chars). */
const SAFE_SNS_TOPIC_NAME_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * CloudShell setup script: creates the SNS topic (with a topic policy so
 * EventBridge can publish), subscribes `email`, and wires the three rules
 * to it. Run once per account that holds remediator roles.
 */
export function getRemediationDetectionScript(options: RemediationDetectionScriptOptions): string {
  const rawTopicName = options.topicName ?? REMEDIATION_DETECTION_TOPIC_NAME;
  // The topic name lands inside a double-quoted shell string. Reject
  // anything outside the SNS charset instead of escaping — the charset has
  // no shell metacharacters, so a validated name cannot break out, and a
  // rejected name fails fast here instead of failing in CloudShell.
  if (!SAFE_SNS_TOPIC_NAME_PATTERN.test(rawTopicName)) {
    throw new Error(
      `invalid SNS topic name: "${rawTopicName}" (letters, numbers, hyphens, underscores only)`,
    );
  }
  const topicName = rawTopicName;
  const safeEmail = escapeDoubleQuotedShell(options.email);
  const partition = resolvePartition(options);

  const ruleBlock = (rule: RemediationDetectionRule): string => {
    const pattern = JSON.stringify(buildDetectionPattern({ rule, options: { partition } }));
    const subject = REMEDIATION_DETECTION_SUBJECTS[rule];
    return [
      `# ${rule} — ${subject}.`,
      `aws events put-rule --name "${rule}" --event-pattern '${pattern}' --description "${subject}"`,
      // Raw event delivery: the email body carries eventName / roleArn /
      // errorCode, which is what the runbook triages on. No input
      // transformer — one less quoting layer to break in CloudShell.
      `aws events put-targets --rule "${rule}" --targets "Id=\\"1\\",Arn=\\"${topicArn}\\""`,
    ].join('\n');
  };

  // `${topicArn}` is a *script-time* variable (resolved by `create-topic`
  // output), not a build-time value — hence the escaped template below.
  const topicArn =
    '$(aws sns create-topic --name "' + topicName + '" --query TopicArn --output text)';

  // Topic policy scoped to EventBridge rules carrying the remediator prefix.
  // The account and region stay wildcards — they are only known at
  // script-run time — but no unrelated rule can publish to the alert topic.
  const topicPolicyDocument = `{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"events.amazonaws.com"},"Action":"sns:Publish","Resource":"$TOPIC_ARN","Condition":{"ArnLike":{"aws:SourceArn":"arn:${partition}:events:*:*:rule/${AWS_LEGACY_REMEDIATION_ROLE_NAME}*"}}}]}`;
  // Escape for embedding inside a double-quoted shell string. JSON.stringify
  // escapes `"` and `\` (a bare `"`,→`\"` replace would miss backslashes), and
  // slicing off the outer quotes leaves the inner document. `$TOPIC_ARN` is
  // intentionally left for the shell to expand at script-run time.
  const escapedTopicPolicy = JSON.stringify(topicPolicyDocument).slice(1, -1);

  return [
    'set -euo pipefail',
    '',
    '# 1. SNS topic for the alerts.',
    `TOPIC_ARN="${topicArn}"`,
    `aws sns set-topic-attributes --topic-arn "$TOPIC_ARN" --attribute-name Policy --attribute-value "${escapedTopicPolicy}"`,
    `aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "${safeEmail}"`,
    'echo "Confirm the SNS subscription email before expecting alerts."',
    '',
    '# 2. One EventBridge rule per signal, all targeting the topic.',
    ...REMEDIATION_DETECTION_RULES.flatMap((rule) => ['', ruleBlock(rule)]),
    '',
    'echo "Detection wired. Current rules:"',
    'aws events list-rules --query "Rules[?starts_with(Name, \'OpenComp-Remediator\')].Name" --output table',
  ].join('\n');
}
