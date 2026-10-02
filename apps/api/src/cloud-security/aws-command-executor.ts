import type { AwsCredentialIdentity } from '@aws-sdk/types';
import type { AwsCommandStep } from './ai-remediation.prompt';
import {
  type AwsPartition,
  getAwsPartitionForRegion,
} from './aws-partition.utils';
import { validateFixStepParams } from './remediation-param-guardrails';

import * as s3 from '@aws-sdk/client-s3';
import * as dynamodb from '@aws-sdk/client-dynamodb';
import * as kinesis from '@aws-sdk/client-kinesis';
import * as redshift from '@aws-sdk/client-redshift';
import * as backup from '@aws-sdk/client-backup';
import * as ecr from '@aws-sdk/client-ecr';
import * as glue from '@aws-sdk/client-glue';
import * as athena from '@aws-sdk/client-athena';
import * as opensearch from '@aws-sdk/client-opensearch';
import * as secretsManager from '@aws-sdk/client-secrets-manager';
import * as kms from '@aws-sdk/client-kms';
import * as cloudtrail from '@aws-sdk/client-cloudtrail';
import * as guardduty from '@aws-sdk/client-guardduty';
import * as configService from '@aws-sdk/client-config-service';
import * as iam from '@aws-sdk/client-iam';
import * as sts from '@aws-sdk/client-sts';
import * as inspector2 from '@aws-sdk/client-inspector2';
import * as macie2 from '@aws-sdk/client-macie2';
import * as cognito from '@aws-sdk/client-cognito-identity-provider';
import * as shield from '@aws-sdk/client-shield';
import * as wafv2 from '@aws-sdk/client-wafv2';
import * as acm from '@aws-sdk/client-acm';
import * as cwLogs from '@aws-sdk/client-cloudwatch-logs';
import * as cloudwatch from '@aws-sdk/client-cloudwatch';
import * as sns from '@aws-sdk/client-sns';
import * as ec2 from '@aws-sdk/client-ec2';
import * as lambda from '@aws-sdk/client-lambda';
import * as eks from '@aws-sdk/client-eks';
import * as emr from '@aws-sdk/client-emr';
import * as codebuild from '@aws-sdk/client-codebuild';
import * as elasticBeanstalk from '@aws-sdk/client-elastic-beanstalk';
import * as sfn from '@aws-sdk/client-sfn';
import * as elbv2 from '@aws-sdk/client-elastic-load-balancing-v2';
import * as cloudfront from '@aws-sdk/client-cloudfront';
import * as rds from '@aws-sdk/client-rds';
import * as apigw from '@aws-sdk/client-apigatewayv2';
import * as route53 from '@aws-sdk/client-route-53';
import * as networkFirewall from '@aws-sdk/client-network-firewall';
import * as transfer from '@aws-sdk/client-transfer';
import * as sqs from '@aws-sdk/client-sqs';
import * as eventbridge from '@aws-sdk/client-eventbridge';
import * as ssm from '@aws-sdk/client-ssm';
import * as kafka from '@aws-sdk/client-kafka';
import * as sagemaker from '@aws-sdk/client-sagemaker';
import * as efs from '@aws-sdk/client-efs';
import * as elasticache from '@aws-sdk/client-elasticache';

type SdkModule = Record<string, any>;

/** Static map of service name → SDK module. Includes common aliases AI might use. */
const SDK_MODULES: Record<string, SdkModule> = {
  s3: s3,
  dynamodb: dynamodb,
  kinesis: kinesis,
  redshift: redshift,
  backup: backup,
  ecr: ecr,
  glue: glue,
  athena: athena,
  opensearch: opensearch,
  'secrets-manager': secretsManager,
  kms: kms,
  cloudtrail: cloudtrail,
  guardduty: guardduty,
  'config-service': configService,
  iam: iam,
  sts: sts,
  inspector2: inspector2,
  macie2: macie2,
  'cognito-identity-provider': cognito,
  shield: shield,
  wafv2: wafv2,
  acm: acm,
  'cloudwatch-logs': cwLogs,
  cloudwatch: cloudwatch,
  sns: sns,
  ec2: ec2,
  lambda: lambda,
  eks: eks,
  emr: emr,
  codebuild: codebuild,
  'elastic-beanstalk': elasticBeanstalk,
  sfn: sfn,
  'elastic-load-balancing-v2': elbv2,
  cloudfront: cloudfront,
  rds: rds,
  apigatewayv2: apigw,
  'route-53': route53,
  'network-firewall': networkFirewall,
  transfer: transfer,
  sqs: sqs,
  eventbridge: eventbridge,
  ssm: ssm,
  kafka: kafka,
  sagemaker: sagemaker,
  efs: efs,
  elasticache: elasticache,
  // Common aliases AI might use
  logs: cwLogs,
  config: configService,
  cognito: cognito,
  waf: wafv2,
  route53: route53,
  'step-functions': sfn,
  elb: elbv2,
  elbv2: elbv2,
  apigateway: apigw,
  msk: kafka,
  inspector: inspector2,
  macie: macie2,
  secretsmanager: secretsManager,
};

/**
 * IAM privilege-escalation writes. Refused on EVERY path, including
 * rollback: undo legitimately needs deletes, but it never mints roles or
 * grants policies — permission grants flow through the one-click scripts
 * gated by the remediation denylist, never through executed steps.
 * Spread into BLOCKED_COMMANDS below so the fix path refuses them too.
 */
const ALWAYS_BLOCKED_COMMANDS = new Set([
  'PutRolePolicyCommand',
  'CreateRoleCommand',
  'AttachRolePolicyCommand',
  // Secret-plaintext reads. Read outputs persist to the action row and feed
  // the next model prompt — executing these pulls secrets into the DB and
  // model context. Refused on every path, including rollback (undo never
  // needs a fresh secret value; it restores stored state).
  'GetSecretValueCommand',
  'GetParameterCommand',
  'GetParametersCommand',
  'GetParametersByPathCommand',
  'DecryptCommand',
]);

/** Commands that are too dangerous or not allowed to execute. */
const BLOCKED_COMMANDS = new Set([
  // Destructive (rollback may still use these to undo — see `allowBlocked`).
  'DeleteBucketCommand',
  'DeleteTableCommand',
  'DeleteDBInstanceCommand',
  'DeleteDBClusterCommand',
  'DeleteFileSystemCommand',
  'TerminateInstancesCommand',
  'DeleteClusterCommand',
  'DeleteStackCommand',
  'DeleteVpcCommand',
  'DeleteSubnetCommand',
  'DeleteUserCommand',
  'DeleteRoleCommand',
  // Monitoring kill-switches. A fix step must never turn detection or
  // logging off — that blinds the control while the plan reads like an
  // improvement. Rollback may still use these to undo (see `allowBlocked`).
  'StopLoggingCommand',
  'DeleteTrailCommand',
  'DeleteDetectorCommand',
  'StopConfigurationRecorderCommand',
  'DisableKeyRotationCommand',
  'DeleteLogGroupCommand',
  // Data-send primitives. A fix step never publishes a topic, sends a queue
  // message, emits a bus event, or routes object events outward — with an
  // attacker-influenced destination that is exfiltration, not a fix.
  // Rollback may still use these to undo (see `allowBlocked`).
  'PublishCommand',
  'SendMessageCommand',
  'PutEventsCommand',
  'PutBucketNotificationConfigurationCommand',
  // IAM privilege escalation: a fix step must never mint roles or grant
  // itself policies. Refused even on rollback (see ALWAYS_BLOCKED_COMMANDS).
  ...ALWAYS_BLOCKED_COMMANDS,
]);

/** Param names that AWS expects as JSON strings, not objects. */
const JSON_STRING_PARAMS = new Set([
  'Content',
  'PolicyDocument',
  'AssumeRolePolicyDocument',
  'Policy',
  'TrustPolicy',
  'ResourcePolicy',
  'Configuration',
  'Definition',
]);

/**
 * Commands where AWS rejects the call with a confusing
 * "Member must not be null" error if a top-level param is missing.
 * We surface a clear, actionable error BEFORE the SDK call so the
 * remediation pipeline fails fast and the customer sees what's wrong.
 *
 * Keep this list narrow — only commands where we've seen the AI omit a
 * required param in practice and the resulting AWS error is unhelpful.
 */
export const REQUIRED_PARAMS: Record<string, readonly string[]> = {
  CreateServiceLinkedRoleCommand: ['AWSServiceName'],
  PutConfigurationRecorderCommand: ['ConfigurationRecorder'],
  PutDeliveryChannelCommand: ['DeliveryChannel'],
  StartConfigurationRecorderCommand: ['ConfigurationRecorderName'],
  PutBucketPolicyCommand: ['Bucket', 'Policy'],
  CreateTrailCommand: ['Name', 'S3BucketName'],
  PutMetricFilterCommand: [
    'logGroupName',
    'filterName',
    'metricTransformations',
  ],
  // A CreateLogGroup with no name is rejected by AWS with an opaque "Member must
  // not be null" error, silently failing the whole remediation (CS-787). Fail
  // fast with a clear message here. This covers CloudTrail AND every sibling
  // remediation that mints a log group (Step Functions, SSM Session Manager,
  // Transfer Family), which the CloudTrail-only name backfill deliberately skips.
  CreateLogGroupCommand: ['logGroupName'],
};

/**
 * Params that must be PRESENT in the request but may legitimately be an empty
 * string — unlike REQUIRED_PARAMS, which also rejects "". For example, AWS
 * CloudWatch Logs PutMetricFilter requires `filterPattern` to be supplied but
 * accepts an empty pattern (an empty filterPattern matches all log events), so
 * we must reject only a missing/null value, not "".
 */
const REQUIRED_PRESENT_PARAMS: Record<string, readonly string[]> = {
  PutMetricFilterCommand: ['filterPattern'],
};

const REQUIRED_PARAM_ONE_OF: Record<string, readonly (readonly string[])[]> = {
  AuthorizeSecurityGroupIngressCommand: [['GroupId', 'GroupName']],
};

const REVOKE_SECURITY_GROUP_INGRESS_RULE_PROPERTY_PARAMS = [
  'CidrIp',
  'FromPort',
  'IpPermissions',
  'IpProtocol',
  'SourceSecurityGroupName',
  'SourceSecurityGroupOwnerId',
  'ToPort',
] as const;

function normalizeArnPartition(value: string, partition: AwsPartition): string {
  if (partition === 'aws-us-gov') {
    return value.replace(/\barn:aws:/g, 'arn:aws-us-gov:');
  }

  return value;
}

function normalizeArnPartitionsInValue(
  value: unknown,
  partition: AwsPartition,
): unknown {
  if (typeof value === 'string') {
    return normalizeArnPartition(value, partition);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeArnPartitionsInValue(item, partition));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeArnPartitionsInValue(item, partition),
      ]),
    );
  }

  return value;
}

function normalizeArnPartitions(
  input: Record<string, unknown>,
  region: string,
): void {
  const partition = getAwsPartitionForRegion(region);
  if (partition === 'aws') return;

  for (const [key, value] of Object.entries(input)) {
    input[key] = normalizeArnPartitionsInValue(value, partition);
  }
}

/**
 * Universal pre-execution param normalisation.
 * Fixes common AI mistakes without per-command logic.
 */
function normaliseInputParams(
  input: Record<string, unknown>,
  command: string,
  region: string,
): void {
  normalizeArnPartitions(input, region);

  for (const [key, value] of Object.entries(input)) {
    // Rule 1: Stringify any object param that AWS expects as a JSON string
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      JSON_STRING_PARAMS.has(key)
    ) {
      input[key] = JSON.stringify(value);
    }
  }

  // Rule 2: S3 CreateBucket needs LocationConstraint for non-us-east-1
  if (command === 'CreateBucketCommand') {
    const bucket = input.Bucket;
    if (typeof bucket === 'string' || typeof bucket === 'number') {
      input.Bucket = String(bucket).toLowerCase().replace(/_/g, '-');
    }
    if (region !== 'us-east-1' && !input.CreateBucketConfiguration) {
      input.CreateBucketConfiguration = { LocationConstraint: region };
    }
  }

  // Rule 3: CloudTrail trails should default to multi-region + validation
  if (command === 'CreateTrailCommand') {
    if (!input.IsMultiRegionTrail) input.IsMultiRegionTrail = true;
    if (!input.EnableLogFileValidation) input.EnableLogFileValidation = true;
  }

  // Rule 4: AWS Config recorder — `allSupported: true` is mutually exclusive
  // with `recordingStrategy`, `exclusionByResourceTypes`, and `resourceTypes`.
  // AWS rejects the combination with a ValidationException. The AI (and a
  // customer's existing exclusion-based recorder, e.g. one that excludes the
  // IAM resource types) frequently echoes those fields back alongside
  // allSupported:true. When the intent is "record all supported types",
  // collapse recordingGroup to the single valid shape that records everything,
  // including the global IAM resource types.
  if (command === 'PutConfigurationRecorderCommand') {
    normalizeConfigRecordingGroup(input);
  }

  // Rule 5: CloudWatch Logs metric filters — `metricTransformations` is a
  // required, NON-EMPTY ARRAY of { metricName, metricNamespace, metricValue }
  // where `metricValue` must be a STRING. The model frequently emits it as a
  // single object instead of an array, or as a number `1` instead of `"1"`,
  // which AWS rejects (the customer-visible "metric transformations were not
  // properly provided to the CloudWatch Logs API" failure that sends the
  // auto-fix to manual steps). Coerce to the one valid shape.
  if (command === 'PutMetricFilterCommand') {
    normalizeMetricFilterTransformations(input);
  }
}

export function normalizeMetricFilterTransformations(
  input: Record<string, unknown>,
): void {
  let transformations = input.metricTransformations;

  // A single transformation object → wrap in an array (AWS expects a list).
  if (
    transformations &&
    typeof transformations === 'object' &&
    !Array.isArray(transformations)
  ) {
    transformations = [transformations];
    input.metricTransformations = transformations;
  }

  if (!Array.isArray(transformations)) return;

  input.metricTransformations = transformations.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }
    const transform = entry as Record<string, unknown>;
    // metricValue must be a string (e.g. "1"); the model often emits a number.
    if (
      transform.metricValue != null &&
      typeof transform.metricValue !== 'string'
    ) {
      return {
        ...transform,
        metricValue: JSON.stringify(transform.metricValue),
      };
    }
    return transform;
  });
}

export function normalizeConfigRecordingGroup(
  input: Record<string, unknown>,
): void {
  const recorder = input.ConfigurationRecorder;
  if (!recorder || typeof recorder !== 'object' || Array.isArray(recorder)) {
    return;
  }
  const recorderObj = recorder as Record<string, unknown>;
  const group = recorderObj.recordingGroup;
  if (!group || typeof group !== 'object' || Array.isArray(group)) return;

  const groupObj = group as Record<string, unknown>;
  const strategy = groupObj.recordingStrategy as
    { useOnly?: string } | undefined;
  // Collapse only on an affirmative full signal. An exclusion list alone
  // must not flip an explicit opt-out (`allSupported: false`) into
  // record-everything — that shape belongs to the validator refusal path.
  const wantsAllSupported =
    groupObj.allSupported === true ||
    strategy?.useOnly === 'ALL_SUPPORTED_RESOURCE_TYPES';

  if (!wantsAllSupported) return;

  recorderObj.recordingGroup = {
    allSupported: true,
    includeGlobalResourceTypes: true,
  };
}

/**
 * Universal send-with-retry. Handles three recoverable error classes:
 *  1. Validation errors  → auto-fix the offending param, retry once
 *  2. Throttling          → exponential backoff, up to 3 retries
 *  3. IAM propagation     → wait and retry (roles/policies take seconds to propagate)
 * Everything else is surfaced immediately.
 */

async function sendWithAutoRetry(
  client: any,

  CommandClass: any,
  input: Record<string, unknown>,
  command: string,
  service: string,
): Promise<Record<string, unknown>> {
  const MAX_ATTEMPTS = 4; // 1 initial + up to 3 retries
  let validationFixed = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const result = await client.send(new CommandClass(input));

      return (result ?? {}) as Record<string, unknown>;
    } catch (err) {
      const awsErr = err as {
        name?: string;
        message?: string;
        Code?: string;
        $metadata?: { httpStatusCode?: number };
      };
      const errName = awsErr.name ?? '';
      const errMsg =
        awsErr.message ||
        awsErr.Code ||
        `${errName} (HTTP ${awsErr.$metadata?.httpStatusCode ?? 'unknown'})`;

      console.error(
        `AWS Command Error [${service}:${command}] attempt ${attempt + 1}:`,
        errName,
        errMsg,
      );

      // ── Idempotent "already exists" → treat as success ──
      // Narrow on purpose: generic "already exists" substrings also match
      // fatal cases like S3 BucketAlreadyExists (name owned by a DIFFERENT
      // account — globally fatal, the bucket is unusable). Only codes that
      // prove the caller already owns an equivalent resource count.
      // Names are the SDK v3 `err.name` values (exception class names —
      // IAM reports `EntityAlreadyExistsException`, not the wire code
      // `EntityAlreadyExists`).
      if (
        errName === 'ResourceAlreadyExistsException' ||
        errName === 'DuplicateDocumentContent' ||
        errName === 'DuplicateDocumentVersionName' ||
        errName === 'BucketAlreadyOwnedByYou' ||
        errName === 'EntityAlreadyExists' ||
        errName === 'EntityAlreadyExistsException' ||
        errName === 'TrailAlreadyExistsException' ||
        errMsg.includes('same metadata and content') ||
        errMsg.includes('DuplicateDocument')
      ) {
        return { _alreadyExists: true, message: errMsg };
      }

      // ── Throttle / rate limit → backoff and retry ──
      if (isThrottleError(errName, errMsg) && attempt < MAX_ATTEMPTS - 1) {
        const delay = Math.min(1000 * 2 ** attempt, 8000); // 1s, 2s, 4s, 8s
        console.log(
          `Throttled on ${service}:${command}, retrying in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // ── IAM propagation → wait and retry ──
      // New roles/policies take seconds to propagate; the first call can
      // fail with NoSuchEntity even though the create succeeded.
      if (
        isIamPropagationError(errName, errMsg) &&
        attempt < MAX_ATTEMPTS - 1
      ) {
        const delay = Math.min(2000 * 2 ** attempt, 8000); // 2s, 4s, 8s
        console.log(
          `IAM propagation delay on ${service}:${command}, retrying in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // ── Validation error → auto-fix param and retry once ──
      if (!validationFixed && isValidationError(errName, errMsg)) {
        const fixed = tryAutoFixValidationError(input, errMsg);
        if (fixed) {
          console.log(
            `Auto-fixed validation error, retrying ${service}:${command}`,
          );
          validationFixed = true;
          continue;
        }
      }

      // ── Not found → clear message ──
      if (
        errName === 'ServiceSettingNotFound' ||
        errName === 'ResourceNotFoundException' ||
        errName === 'NotFoundException' ||
        errName === 'InvalidDocument' ||
        errName === 'NoSuchEntity' ||
        errName === 'NoSuchBucket' ||
        errName === 'DetectorNotFoundException' ||
        errMsg.includes('does not exist') ||
        errMsg.includes('not found')
      ) {
        throw new Error(
          `${service}:${command} failed: target resource not found (${errName}). ${errMsg}`,
        );
      }

      // ── Unknown / unrecoverable ──
      if (!errMsg || errMsg === 'Unknown' || errMsg === 'UnknownError') {
        throw new Error(
          `${service}:${command} failed with ${errName || 'unknown error'} (HTTP ${awsErr.$metadata?.httpStatusCode ?? '?'}). Check IAM permissions and input parameters.`,
        );
      }
      throw err;
    }
  }
  throw new Error(
    `${service}:${command} failed after ${MAX_ATTEMPTS} attempts`,
  );
}

function isThrottleError(errName: string, errMsg: string): boolean {
  return (
    errName === 'Throttling' ||
    errName === 'ThrottlingException' ||
    errName === 'TooManyRequestsException' ||
    errName === 'RequestLimitExceeded' ||
    errMsg.includes('Rate exceeded') ||
    errMsg.includes('Throttling') ||
    errMsg.includes('Too Many Requests')
  );
}

function isIamPropagationError(errName: string, errMsg: string): boolean {
  return (
    errName === 'NoSuchEntity' ||
    errName === 'NoSuchEntityException' ||
    errName === 'InvalidInstanceID.NotFound' ||
    errMsg.includes('role/policy may not exist yet') ||
    errMsg.includes('until it has propagated') ||
    (errMsg.includes('NoSuchEntity') && errMsg.includes('propagat'))
  );
}

function isValidationError(errName: string, errMsg: string): boolean {
  return (
    errName === 'ValidationException' ||
    errName === 'InvalidParameterValue' ||
    errName === 'InvalidParameterValueException' ||
    errMsg.includes('validation error') ||
    errMsg.includes('failed to satisfy constraint')
  );
}

/**
 * Message-only detector for the broader class of validation-style errors
 * that AWS may surface after the rules-based retry inside
 * `sendWithAutoRetry` has given up. Used by `executePlanSteps` to decide
 * whether to invoke the AI step-repair callback.
 *
 * Universal by design — pattern-matches AWS's standard error wording
 * rather than enumerating per-command error names.
 */
export function looksLikeValidationError(message: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('validationexception') ||
    lower.includes('validation error') ||
    lower.includes('failed to satisfy constraint') ||
    lower.includes('member must not be null') ||
    lower.includes('invalidparametervalue') ||
    lower.includes('invalidparameter ') ||
    lower.includes('invalid parameter') ||
    lower.includes('must be a valid') ||
    lower.includes('is required') ||
    lower.includes('missing required') ||
    lower.includes('must contain') ||
    lower.includes('missingparameter') ||
    lower.includes('missing parameter') ||
    lower.includes('parameter is required') ||
    lower.includes('must specify')
  );
}

/**
 * Message-only detector for missing-dependency failures — the step names a
 * resource or output that is not there (`NoSuchBucket`, `... does not
 * exist`). Used ONLY by the post-no-op skip in `executePlanSteps`: when a
 * prior same-service step was a no-op, a later step can fail because it
 * depends on output the no-op never returned (e.g. a version number).
 *
 * Deliberately narrower than `looksLikeValidationError`: malformed-step
 * errors (`is required`, `invalid parameter`, ...) mean the AI generated a
 * broken step, and skipping those would report progress while leaving the
 * resource un-remediated. Those stay fatal.
 */
export function looksLikeMissingDependencyError(message: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('not found') ||
    lower.includes('notfound') ||
    lower.includes('does not exist') ||
    lower.includes('doesnotexist') ||
    lower.includes('no such') ||
    lower.includes('nosuch') ||
    lower.includes('could not be found') ||
    lower.includes('cannot be found') ||
    lower.includes('not exist')
  );
}

/**
 * Param keys that name a resource identifier (`Bucket`, `LogGroupName`,
 * `TrailName`, `TopicArn`, ...). Values under any other key (status flags,
 * version numbers, configuration blobs) are NOT identifiers — two steps can
 * share `Enabled` while touching different resources.
 */
const IDENTIFIER_PARAM_KEY =
  /(name|bucket|arn|resource|ids?|key|table|topic|queue|function|role|policy|group|trail|document|filter|alarm|rule|export|secret|path|prefix|target|source|dest)$/i;

/**
 * Collect identifier-shaped string values from step params: strings under an
 * identifier key, recursing into nested objects and arrays. Numbers,
 * booleans, and short/blank strings never count — a shared port number or
 * status flag is not proof two steps touch the same resource.
 */
export function collectIdentifierStrings(
  value: unknown,
  into: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectIdentifierStrings(item, into);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (IDENTIFIER_PARAM_KEY.test(key)) {
        collectDirectStrings(item, into);
      } else {
        collectIdentifierStrings(item, into);
      }
    }
  }
  // Bare strings carry no key, so they prove nothing — a shared status flag
  // like `Enabled` is not a shared resource. Only keyed values count.
}

function collectDirectStrings(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length >= 3) into.add(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDirectStrings(item, into);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectDirectStrings(item, into);
  }
}

/**
 * True when the failing step names at least one identifier the prior step
 * used. A same-service typo (right service, wrong resource name) shares
 * nothing with the no-op and must stay fatal instead of reporting skipped
 * progress.
 */
export function sharesResourceIdentifier(
  priorParams: unknown,
  failingParams: unknown,
): boolean {
  const prior = new Set<string>();
  collectIdentifierStrings(priorParams, prior);
  if (prior.size === 0) return false;
  const failing = new Set<string>();
  collectIdentifierStrings(failingParams, failing);
  for (const candidate of failing) {
    if (prior.has(candidate)) return true;
  }
  return false;
}

/**
 * Parse the AWS validation error, fix the offending param, return true if fixed.
 * AWS error format: "Value at 'fieldName' failed to satisfy constraint: ..."
 *
 * Key subtlety: AWS errors use camelCase ('documentVersion') but SDK params
 * use PascalCase ('DocumentVersion'). We match case-insensitively.
 */
function tryAutoFixValidationError(
  input: Record<string, unknown>,
  errMsg: string,
): boolean {
  // Extract field name from error (camelCase)
  const fieldMatch = errMsg.match(/Value at '(\w+)'/i);
  if (!fieldMatch?.[1]) return false;

  const errorField = fieldMatch[1];

  // Find the actual key in input (case-insensitive match)
  const inputKey = Object.keys(input).find(
    (k) => k.toLowerCase() === errorField.toLowerCase(),
  );
  if (!inputKey) return false;

  const value = input[inputKey];

  // Fix 1: Regex constraint (version numbers, IDs, etc.)
  //   → remove the param so AWS uses its default
  if (errMsg.includes('regular expression pattern')) {
    delete input[inputKey];
    return true;
  }

  // Fix 2: Object instead of string → stringify
  if (value !== null && typeof value === 'object') {
    input[inputKey] = JSON.stringify(value);
    return true;
  }

  // Fix 3: Length constraint → truncate
  const lengthMatch = errMsg.match(/length less than or equal to (\d+)/);
  if (lengthMatch && typeof value === 'string') {
    input[inputKey] = value.slice(0, Number(lengthMatch[1]));
    return true;
  }

  return false;
}

/**
 * Resolve an AI-supplied command name to the canonical SDK command name for
 * a service. Returns the exact name on a direct hit, the canonical name for
 * a near-miss spelling (singular/plural, small typos), or null when nothing
 * matches. Fail-closed: short generic inputs never collapse onto a longer
 * command, and near-identical actions stay distinct.
 *
 * Validation AND execution must resolve through this one helper. Previously
 * each had its own inline fuzzy match while the param guardrails switched on
 * the raw name — so a near-miss name passed validation, skipped every
 * guardrail case, and still executed as the real dual-use command.
 */
export function resolveCanonicalCommandName(
  service: string,
  command: string,
): string | null {
  const mod = SDK_MODULES[service];
  if (!mod) return null;
  if (mod[command] && typeof mod[command] === 'function') return command;
  const cmdBase = command.replace('Command', '');
  // An empty base (e.g. command === "Command") would match everything —
  // refuse instead of executing a random API.
  if (!cmdBase) return null;
  // Singular/plural and near-miss tolerance: longer gaps mean the input is
  // a different (usually shorter, generic) name, not a typo.
  const MAX_FUZZY_LENGTH_GAP = 2;
  const match = Object.keys(mod).find((k) => {
    if (!k.endsWith('Command') || typeof mod[k] !== 'function') return false;
    const kBase = k.replace('Command', '');
    // Containment either way tolerates singular/plural and near-miss
    // spellings (`SetTopicAttributeCommand`, `TerminateInstanceCommand`),
    // but the length cap keeps short generic inputs from collapsing onto a
    // longer command (`TopicCommand` must not become `CreateTopicCommand`).
    // Near-identical actions stay distinct (`GetAclCommand` must not become
    // `GetBucketAclCommand` — IAM treats them as different permissions).
    // Anything else fails closed as unknown.
    return (
      (kBase.includes(cmdBase) || cmdBase.includes(kBase)) &&
      Math.abs(kBase.length - cmdBase.length) <= MAX_FUZZY_LENGTH_GAP
    );
  });
  return match ?? null;
}

/**
 * Validate all steps in a plan BEFORE executing anything.
 * Catches: unknown services, missing commands, blocked commands, placeholder values.
 * Returns list of errors. Empty = valid.
 *
 * Pass `{ allowBlocked: true }` for rollback steps: rollback legitimately
 * undoes with deletes, so the blocked-command refusal does not apply —
 * every other check (unknown command, placeholders, required params,
 * guardrails) still runs so an AI-planted rollback cannot dodge validation.
 * IAM privilege-escalation writes (ALWAYS_BLOCKED_COMMANDS) stay refused on
 * every path — undo never mints roles or grants policies.
 */
export function validatePlanSteps(
  steps: AwsCommandStep[],
  options?: { allowBlocked?: boolean },
): string[] {
  const errors: string[] = [];
  const allowBlocked = options?.allowBlocked === true;

  for (let i = 0; i < steps.length; i++) {
    errors.push(...validateOneStep(steps[i], i, allowBlocked));
  }

  return errors;
}

/**
 * Validate a single plan step. Shared by `validatePlanSteps` and the AI
 * step-repair safety gate — a repaired step must clear the same checks
 * (blocked commands, required params, placeholders, guardrails) as a
 * freshly generated one, never just the param-shape subset.
 */
export function validateOneStep(
  step: AwsCommandStep,
  index: number,
  allowBlocked: boolean,
): string[] {
  const errors: string[] = [];
  const prefix = `Step ${index + 1} (${step.command})`;

  // Check service exists
  if (!SDK_MODULES[step.service]) {
    errors.push(`${prefix}: Unknown service "${step.service}"`);
    return errors;
  }

  // Check command exists in module (exact or fuzzy match for AI mistakes).
  // Resolve once through the shared helper so validation, the blocked
  // check, and the guardrails below all see the same canonical name
  // the executor will actually run.
  const canonicalCommand = resolveCanonicalCommandName(
    step.service,
    step.command,
  );
  if (!canonicalCommand) {
    errors.push(
      `${prefix}: Command "${step.command}" not found in @aws-sdk/client-${step.service}`,
    );
    return errors;
  }

  // Check command name format
  if (!step.command.endsWith('Command')) {
    errors.push(`${prefix}: Command name must end with "Command"`);
  }

  // Check blocked (against both the raw and the resolved name, so a
  // near-miss spelling of a blocked command is still refused).
  // Rollback validation passes allowBlocked since undo needs deletes —
  // but IAM privilege-escalation writes stay refused on every path.
  const isBlocked =
    BLOCKED_COMMANDS.has(step.command) ||
    BLOCKED_COMMANDS.has(canonicalCommand);
  const isAlwaysBlocked =
    ALWAYS_BLOCKED_COMMANDS.has(step.command) ||
    ALWAYS_BLOCKED_COMMANDS.has(canonicalCommand);
  if ((isBlocked && !allowBlocked) || isAlwaysBlocked) {
    errors.push(`${prefix}: Command is blocked for safety`);
  }

  // Check for placeholder values in params
  const paramStr = JSON.stringify(step.params);
  const placeholders = paramStr.match(/\{\{[\w]+\}\}|<[A-Z_]+>/g);
  if (placeholders) {
    errors.push(
      `${prefix}: Contains placeholder values: ${placeholders.join(', ')}`,
    );
  }

  // Check required top-level params for commands AWS rejects with
  // cryptic "Member must not be null" errors. Fail fast with a clear
  // message instead of letting the SDK return its uninformative one.
  // Keyed on the canonical name so a fuzzy alias cannot dodge the check
  // and then execute as the real command.
  const required = REQUIRED_PARAMS[canonicalCommand];
  if (required) {
    for (const key of required) {
      const value = step.params?.[key];
      if (!hasRequiredParamValue(value)) {
        errors.push(`${prefix}: Required param "${key}" is missing or empty`);
      }
    }
  }

  const requiredPresent = REQUIRED_PRESENT_PARAMS[canonicalCommand];
  if (requiredPresent) {
    for (const key of requiredPresent) {
      const value = step.params?.[key];
      // Must be supplied, but an empty string is valid (e.g. an empty
      // CloudWatch filterPattern matches all log events).
      if (value === undefined || value === null) {
        errors.push(`${prefix}: Required param "${key}" must be provided`);
      }
    }
  }

  const oneOfGroups = REQUIRED_PARAM_ONE_OF[canonicalCommand];
  if (oneOfGroups) {
    for (const group of oneOfGroups) {
      const hasAny = group.some((key) => {
        const value = step.params?.[key];
        return hasRequiredParamValue(value);
      });
      if (!hasAny) {
        errors.push(`${prefix}: One of "${group.join('" or "')}" is required`);
      }
    }
  }

  if (canonicalCommand === 'RevokeSecurityGroupIngressCommand') {
    errors.push(...validateRevokeSecurityGroupIngressParams(step, prefix));
  }

  // Parameter-level safety: refuse dangerous shapes of dual-use actions
  // (resource-policy writes, control-weakening flags) even though the
  // action itself stays granted for its legitimate fix uses. Match on the
  // canonical name so fuzzy spellings cannot dodge the guardrails.
  errors.push(
    ...validateFixStepParams({ ...step, command: canonicalCommand }, prefix),
  );

  return errors;
}

/**
 * Validate AI-generated rollback steps before they can run on the failure
 * path. Same checks as `validatePlanSteps` except the blocked-command
 * refusal for deletes (undo needs them). IAM privilege-escalation writes
 * stay refused. Callers must run this wherever they validate fix steps —
 * an unvalidated rollback runs with `isRollback: true`, which skips the
 * execution-time delete block.
 */
export function validateRollbackSteps(steps: AwsCommandStep[]): string[] {
  return validatePlanSteps(steps, { allowBlocked: true });
}

function validateRevokeSecurityGroupIngressParams(
  step: AwsCommandStep,
  prefix: string,
): string[] {
  const params = step.params ?? {};
  const hasGroupIdentifier =
    hasRequiredParamValue(params.GroupId) ||
    hasRequiredParamValue(params.GroupName);
  const hasRuleIds = hasRequiredParamValue(params.SecurityGroupRuleIds);
  const hasRuleProperties =
    REVOKE_SECURITY_GROUP_INGRESS_RULE_PROPERTY_PARAMS.some((key) =>
      hasRequiredParamValue(params[key]),
    );

  if (!hasRuleIds && !hasRuleProperties) {
    return [
      `${prefix}: One of "SecurityGroupRuleIds" or rule property params is required`,
    ];
  }

  if (hasRuleIds && hasRuleProperties) {
    return [
      `${prefix}: SecurityGroupRuleIds cannot be combined with rule property params`,
    ];
  }

  if (hasRuleIds && !hasRuleProperties) return [];
  if (hasGroupIdentifier) return [];

  return [`${prefix}: One of "GroupId" or "GroupName" is required`];
}

function hasRequiredParamValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

interface StepResult {
  step: AwsCommandStep;
  output: Record<string, unknown>;
}

interface PlanExecutionResult {
  results: StepResult[];
  error?: { stepIndex: number; message: string; step: AwsCommandStep };
  /**
   * Set when `autoRollbackSteps` ran and at least one rollback step failed.
   * The original step error stays in `error` — this never masks it. Callers
   * must surface it: the resource is left partially modified (the
   * remediation role no longer holds Delete/Stop/Disable grants, so undo
   * steps can fail with permission errors while the fix itself applied).
   */
  rollbackError?: string;
  /**
   * Set when `autoRollbackSteps` were provided but SKIPPED because their
   * length does not match the fix steps. Index pairing (`rollbackSteps[i]`
   * undoes `fixSteps[i]`) is the only thing binding an undo step to the
   * resource its fix step touched — on a length mismatch any pairing is a
   * guess, so running them could destroy the wrong resource. Callers must
   * surface this like `rollbackError`: completed steps were NOT undone.
   */
  rollbackSkipped?: string;
}

/**
 * Optional per-step repair callback. Invoked at most ONCE per step when:
 *   1. The SDK call failed with a validation-class error
 *      (`looksLikeValidationError`), AND
 *   2. The existing rules-based `tryAutoFixValidationError` could not fix it.
 *
 * The callback is expected to return a refined `AwsCommandStep` to retry
 * with, or `null` if it cannot repair the step. Returning the same step
 * unchanged also counts as "cannot repair" (we won't loop forever).
 *
 * Universal contract — the callback decides HOW to refine (typically by
 * asking an LLM with the failing step + AWS error + plan context). The
 * executor only cares about the in/out shape, so this scales to any
 * future AWS command without per-command changes here.
 */
type StepRepairFn = (args: {
  step: AwsCommandStep;
  awsError: string;
  stepIndex: number;
}) => Promise<AwsCommandStep | null>;

/**
 * Execute a single AWS SDK v3 command.
 * Uses static imports — no dynamic require, no version mismatches.
 */
async function executeAwsCommand(params: {
  service: string;
  command: string;
  input: Record<string, unknown>;
  credentials: AwsCredentialIdentity;
  region: string;
  isRollback?: boolean;
}): Promise<Record<string, unknown>> {
  const { service, command, input, credentials, region, isRollback } = params;

  const mod = SDK_MODULES[service];
  if (!mod) {
    throw new Error(`Service "${service}" is not supported`);
  }

  // Block dangerous commands — unless this is a rollback (rollback needs
  // Delete to undo). IAM privilege-escalation writes stay blocked on every
  // path: undo never mints roles or grants policies.
  if (
    (BLOCKED_COMMANDS.has(command) && !isRollback) ||
    ALWAYS_BLOCKED_COMMANDS.has(command)
  ) {
    throw new Error(`Command "${command}" is blocked for safety`);
  }

  if (!command.endsWith('Command')) {
    throw new Error(`Invalid command name "${command}"`);
  }

  // Try exact command name first, then fuzzy match if not found
  // (AI sometimes generates wrong command names — resolve through the same
  // helper validation uses so both agree on what will run).
  let CommandClass = mod[command];
  // The name that will actually run: exact on a direct hit, canonical on a
  // fuzzy hit, raw (doomed to the not-found error below) otherwise.
  let effectiveCommand = command;
  if (!CommandClass || typeof CommandClass !== 'function') {
    const canonical = resolveCanonicalCommandName(service, command);
    // Re-check blocked commands against the resolved name (IAM writes stay
    // refused even on rollback).
    if (
      canonical &&
      ((BLOCKED_COMMANDS.has(canonical) && !isRollback) ||
        ALWAYS_BLOCKED_COMMANDS.has(canonical))
    ) {
      throw new Error(`Command "${canonical}" is blocked for safety`);
    }
    CommandClass = canonical ? mod[canonical] : undefined;
    if (canonical) effectiveCommand = canonical;
  }
  if (!CommandClass || typeof CommandClass !== 'function') {
    throw new Error(
      `Command "${command}" not found in @aws-sdk/client-${service}`,
    );
  }

  // ─── Universal param normalisation ──────────────────────────────────
  // Normalization rules key on exact command names, so normalize as the
  // command that will actually run — a fuzzy alias normalized under its
  // raw name would silently skip its canonical defaults.
  normaliseInputParams(input, effectiveCommand, region);

  // Find the client class from the same module (skip internal __Client)
  const clientKey = Object.keys(mod).find(
    (k) =>
      k.endsWith('Client') &&
      k !== 'Client' &&
      !k.startsWith('_') &&
      typeof mod[k] === 'function' &&
      !k.includes('Command') &&
      !k.includes('Exception'),
  );
  if (!clientKey) {
    throw new Error(`No client found in @aws-sdk/client-${service}`);
  }

  const client = new mod[clientKey]({
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  });

  try {
    return await sendWithAutoRetry(
      client,
      CommandClass,
      input,
      command,
      service,
    );
  } finally {
    client.destroy?.();
  }
}

/**
 * Execute a sequence of steps. Stops on first error.
 * When `autoRollbackSteps` is provided and a step fails, automatically
 * undoes completed steps in reverse order (best-effort).
 * Convention: rollbackSteps[i] undoes fixSteps[i].
 */
export async function executePlanSteps(params: {
  steps: AwsCommandStep[];
  credentials: AwsCredentialIdentity;
  region: string;
  isRollback?: boolean;
  autoRollbackSteps?: AwsCommandStep[];
  repairStep?: StepRepairFn;
}): Promise<PlanExecutionResult> {
  const results: StepResult[] = [];

  for (let i = 0; i < params.steps.length; i++) {
    const originalStep = params.steps[i];
    let stepToRun = originalStep;
    let repairAttempted = false;
    let success = false;
    let lastError: Error | null = null;

    // Inner attempt loop: 1 initial attempt + at most 1 AI repair retry.
    // The AI repair fires only on validation-class errors AND only when
    // a repair callback is provided. This keeps reads/rollbacks/no-AI
    // call sites at the same single-attempt behavior they had before.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const output = await executeAwsCommand({
          service: stepToRun.service,
          command: stepToRun.command,
          input: structuredClone(stepToRun.params),
          credentials: params.credentials,
          region: params.region,
          isRollback: params.isRollback,
        });
        results.push({ step: stepToRun, output });
        success = true;
        lastError = null;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const message = lastError.message;

        if (
          !repairAttempted &&
          params.repairStep &&
          looksLikeValidationError(message)
        ) {
          repairAttempted = true;
          console.log(
            `Step ${i + 1} (${originalStep.service}:${originalStep.command}) ` +
              `failed with validation error — attempting AI step repair`,
          );
          const refined = await params.repairStep({
            step: originalStep,
            awsError: message,
            stepIndex: i,
          });
          if (
            refined &&
            JSON.stringify(refined.params ?? {}) !==
              JSON.stringify(originalStep.params ?? {})
          ) {
            // The repair model writes free-form params — re-run the FULL
            // safety gate before retrying (same checks as pre-execution
            // validation: blocked commands, required params, placeholders,
            // guardrails). A param-shape-only check would let a repaired
            // step smuggle in a blocked delete, a missing required param,
            // or a placeholder and retry it against AWS.
            // Rollback executions keep their delete allowance here too.
            const repairGateErrors = validateOneStep(
              refined,
              i,
              params.isRollback === true,
            );
            if (repairGateErrors.length > 0) {
              console.log(
                `AI repair for ${originalStep.command} refused by safety gate — ` +
                  `surfacing refusal instead of retrying`,
              );
              lastError = new Error(repairGateErrors.join('; '));
              break;
            }
            console.log(
              `AI returned refined step for ${originalStep.command} — retrying once`,
            );
            stepToRun = refined;
            continue;
          }
          console.log(
            `AI repair returned no change for ${originalStep.command} — ` +
              `surfacing original AWS error`,
          );
        }
        break;
      }
    }

    if (success) continue;

    // lastError must be set when !success — keep TS happy with a guard.
    if (!lastError) {
      return {
        results,
        error: {
          stepIndex: i,
          message: 'Unknown execution failure',
          step: originalStep,
        },
      };
    }

    const step = stepToRun;
    const err: unknown = lastError;
    {
      const message = err instanceof Error ? err.message : String(err);

      // If a prior step in the SAME service was a no-op (already exists /
      // duplicate content), this step may depend on output from that no-op
      // (e.g., a version number the no-op did not return). Skip it instead
      // of failing the entire execution. Scoped to the same service on
      // purpose: an unrelated no-op (e.g. a log group that already exists)
      // must never mask a genuine validation failure in another service.
      // The matcher is deliberately narrow (missing-dependency shapes
      // only): a malformed step (`is required`, `invalid parameter`, ...)
      // is an AI bug and stays fatal instead of reporting false progress.
      // Two extra guards keep the skip honest. Only a real pre-existing
      // resource (`_alreadyExists`) qualifies — a prior `_skipped` step
      // never resolved its own dependency, so letting it bless the next
      // skip chains false success down the whole plan. And the failing
      // step must name an identifier the no-op step used
      // (`sharesResourceIdentifier`): a same-service typo (right service,
      // wrong resource name) shares nothing with the no-op and stays fatal.
      const priorNoOp = results.find(
        (r) =>
          r.output._alreadyExists === true && r.step.service === step.service,
      );
      const sharesResource =
        priorNoOp !== undefined &&
        sharesResourceIdentifier(priorNoOp.step.params, step.params);
      if (
        priorNoOp !== undefined &&
        sharesResource &&
        looksLikeMissingDependencyError(message)
      ) {
        console.log(
          `Skipping step ${i + 1} (${step.command}) — prior ${step.service} step was no-op, this step likely depends on its output`,
        );
        results.push({ step, output: { _skipped: true, reason: message } });
        continue;
      }

      // Auto-rollback completed steps if rollback steps were provided.
      // Only steps that actually changed something are undone: no-op
      // entries (already-exists / skipped) map to resources this run did
      // not create, so rolling them back would destroy pre-existing infra.
      // Index pairing is load-bearing: rollbackSteps[i] must undo fixSteps[i].
      // On a length mismatch the pairing is unknowable, so rollback is
      // skipped entirely rather than run against the wrong resources.
      let rollbackError: string | undefined;
      let rollbackSkipped: string | undefined;
      if (params.autoRollbackSteps && results.length > 0) {
        if (params.autoRollbackSteps.length !== params.steps.length) {
          rollbackSkipped =
            `Auto-rollback skipped: ${params.autoRollbackSteps.length} rollback step(s) ` +
            `for ${params.steps.length} fix step(s) — cannot pair undo steps safely; ` +
            `completed steps were NOT undone.`;
          console.warn(rollbackSkipped);
        } else {
          const rollbackSlice = results
            .map((r, idx) => ({ r, idx }))
            .filter(({ r }) => !r.output._alreadyExists && !r.output._skipped)
            .map(({ idx }) => params.autoRollbackSteps?.[idx])
            .filter((rb): rb is AwsCommandStep => Boolean(rb))
            .reverse();
          for (const rbStep of rollbackSlice) {
            try {
              await executeAwsCommand({
                service: rbStep.service,
                command: rbStep.command,
                input: structuredClone(rbStep.params),
                credentials: params.credentials,
                region: params.region,
                isRollback: true,
              });
            } catch (rbErr) {
              // Best-effort rollback — don't mask the original error. Record
              // the first failure so the caller can warn about partial state
              // instead of silently leaving half-applied changes behind.
              if (!rollbackError) {
                rollbackError =
                  rbErr instanceof Error ? rbErr.message : String(rbErr);
              }
            }
          }
        }
      }

      const failure: PlanExecutionResult = {
        results,
        error: { stepIndex: i, message, step },
      };
      if (rollbackError) {
        failure.rollbackError = rollbackError;
      }
      if (rollbackSkipped) {
        failure.rollbackSkipped = rollbackSkipped;
      }
      return failure;
    }
  }

  return { results };
}
