import type { AwsCommandStep } from './ai-remediation.prompt';
import { validateRollbackShape } from './remediation-rollback-guardrails';
import { validatePutPublicAccessBlock } from './remediation-s3-guardrails';

/**
 * Parameter-level guardrails for AI-generated fix steps.
 *
 * The IAM denylist (`remediation-denylist`) decides which *actions* may be
 * auto-granted, but some granted actions are dual-use: one parameter value is
 * the fix, another value silently undoes a security control. Blocking the
 * whole action would end auto-remediation for that finding class, so these
 * checks reject only the dangerous parameter shapes instead.
 *
 * Errors follow the `Step N (Command): ...` convention from
 * `validatePlanSteps` so the AI-repair pass can attribute them to the right
 * step. Every rejection routes the plan to manual steps — never to execution.
 */

function isPolicyAttributeName(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'policy';
}

/** SNS sets one attribute per call via `AttributeName`. */
function validateSetTopicAttributes(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  if (isPolicyAttributeName(params.AttributeName)) {
    return [
      `${prefix}: writing the "Policy" attribute replaces the topic resource policy and can open it to the public — refused for safety`,
    ];
  }
  return [];
}

/**
 * SQS sets attributes via the `Attributes` map (key `Policy` replaces the
 * queue resource policy). A stray `AttributeName`/`Attribute` pair is checked
 * too in case the model emits the SNS shape against SQS.
 */
function validateSetQueueAttributes(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const attributes = params.Attributes;
  if (
    attributes !== null &&
    typeof attributes === 'object' &&
    !Array.isArray(attributes)
  ) {
    const hasPolicyKey = Object.keys(attributes).some(
      (key) => key.trim().toLowerCase() === 'policy',
    );
    if (hasPolicyKey) {
      return [
        `${prefix}: writing the "Policy" attribute replaces the queue resource policy and can open it to the public — refused for safety`,
      ];
    }
  }
  if (
    isPolicyAttributeName(params.AttributeName) ||
    isPolicyAttributeName(params.Attribute)
  ) {
    return [
      `${prefix}: writing the "Policy" attribute replaces the queue resource policy and can open it to the public — refused for safety`,
    ];
  }
  return [];
}

/**
 * CloudTrail `UpdateTrail` is the fix API for trail findings, but explicitly
 * turning a hardening flag OFF is never the fix — it blinds the trail while
 * the plan description still reads like an improvement.
 *
 * Destination and key changes are refused too. The documented UpdateTrail
 * fixes only flip hardening flags or wire the CloudWatch log group (see the
 * cloudwatch adapter) — `CreateTrailCommand` owns bucket setup for new
 * trails. An `S3BucketName` or `KmsKeyId` on an UpdateTrail step redirects
 * trail output or re-keys it, which is exfiltration shape, not a fix.
 * `SnsTopicName` is refused for the same reason: it routes notifications
 * to an unreviewed destination and never appears in a documented fix.
 * (`CloudWatchLogsLogGroupArn` and `CloudWatchLogsRoleArn` stay allowed —
 * wiring the log group, role included, IS the documented
 * cloudwatch-no-cloudtrail-integration fix.)
 */
function validateUpdateTrail(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const errors: string[] = [];
  for (const flag of [
    'EnableLogFileValidation',
    'IsMultiRegionTrail',
    'IsOrganizationTrail',
    // Global-service events (IAM, STS, CloudFront) are the highest-value
    // trail records — turning them off blinds identity forensics while the
    // plan reads like hardening.
    'IncludeGlobalServiceEvents',
  ]) {
    if (params[flag] === false) {
      errors.push(
        `${prefix}: explicitly disabling "${flag}" weakens the trail — refused for safety`,
      );
    }
  }
  for (const field of ['S3BucketName', 'KmsKeyId']) {
    if (typeof params[field] === 'string' && params[field].trim().length > 0) {
      errors.push(
        `${prefix}: changing "${field}" on an existing trail redirects trail output — refused for safety`,
      );
    }
  }
  if (
    typeof params.SnsTopicName === 'string' &&
    params.SnsTopicName.trim().length > 0
  ) {
    errors.push(
      `${prefix}: setting "SnsTopicName" on an existing trail routes notifications to an unreviewed destination — refused for safety`,
    );
  }
  return errors;
}

/**
 * AWS Config `PutConfigurationRecorder` is the fix API for recorder
 * findings, but narrowing coverage reintroduces the finding instead of
 * fixing it. This mirrors the execution-time normalizer
 * (`normalizeConfigRecordingGroup` in `aws-command-executor`): shapes the
 * normalizer collapses to full coverage are allowed through, everything
 * else that narrows coverage is refused.
 */
function validatePutConfigurationRecorder(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const recorder = params.ConfigurationRecorder;
  if (
    recorder === null ||
    typeof recorder !== 'object' ||
    Array.isArray(recorder)
  ) {
    return [];
  }
  const group = (recorder as Record<string, unknown>).recordingGroup;
  if (group === null || typeof group !== 'object' || Array.isArray(group)) {
    return [];
  }
  const groupObj = group as Record<string, unknown>;
  // Shapes the normalizer collapses to "record everything" need no refusal.
  // An exclusion list alone does NOT count: without an affirmative full
  // signal (`allSupported: true` or `useOnly: ALL_SUPPORTED_RESOURCE_TYPES`)
  // it narrows coverage, so it falls through to the refusal below.
  const strategy = groupObj.recordingStrategy as
    { useOnly?: unknown } | undefined;
  const collapsesToFull =
    groupObj.allSupported === true ||
    strategy?.useOnly === 'ALL_SUPPORTED_RESOURCE_TYPES';
  if (collapsesToFull) {
    return [];
  }
  // Fail-closed: any group shape without an affirmative full signal narrows
  // or ambiguously defines coverage — including an empty group, which
  // records nothing. Only the collapsed-to-full shapes above pass.
  return [
    `${prefix}: narrowing recorder coverage (allSupported: false, resource-type exclusions, an inclusion list, or ambiguous coverage) reintroduces the finding — refused for safety`,
  ];
}

/**
 * Config `PutDeliveryChannel` is the fix API for missing delivery channels,
 * and the documented fix only ever sets the channel name and `s3BucketName`
 * (the S3 bucket is the fix mechanism itself, like `CreateTrailCommand`'s
 * bucket — no server-side ground truth exists to verify it against, so it
 * stays allowed). `snsTopicARN` never appears in any documented fix, so a
 * topic ARN here only redirects Config history somewhere unreviewed.
 */
function validatePutDeliveryChannel(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const channel = params.DeliveryChannel;
  if (
    channel === null ||
    typeof channel !== 'object' ||
    Array.isArray(channel)
  ) {
    return [];
  }
  const topicArn = (channel as Record<string, unknown>).snsTopicARN;
  if (typeof topicArn === 'string' && topicArn.trim().length > 0) {
    return [
      `${prefix}: setting "snsTopicARN" redirects Config history to an unreviewed topic — refused for safety`,
    ];
  }
  return [];
}

/**
 * ECR `PutImageScanningConfiguration` is the fix API for unscanned repos,
 * and the fix only ever sets `scanOnPush` to true. Explicit false disables
 * scanning while the plan reads like an improvement.
 */
function validatePutImageScanningConfiguration(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const config = params.imageScanningConfiguration;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return [];
  }
  if ((config as Record<string, unknown>).scanOnPush === false) {
    return [
      `${prefix}: explicitly disabling "scanOnPush" stops image scanning — refused for safety`,
    ];
  }
  return [];
}

/**
 * Returns validation errors for dangerous parameter shapes in a fix step.
 * `prefix` is the `Step N (Command)` label built by `validatePlanSteps`.
 * Consults the first guardrail table below plus the rollback-shape table
 * (`validateRollbackShape`) — a step must clear both. Empty array means
 * the params carry no blocked shape.
 */
export function validateFixStepParams(
  step: AwsCommandStep,
  prefix: string,
): string[] {
  const params = step.params ?? {};
  switch (step.command) {
    case 'SetTopicAttributesCommand':
      return [
        ...validateSetTopicAttributes(params, prefix),
        ...validateRollbackShape(step, prefix),
      ];
    case 'SetQueueAttributesCommand':
      return [
        ...validateSetQueueAttributes(params, prefix),
        ...validateRollbackShape(step, prefix),
      ];
    case 'UpdateTrailCommand':
      return [
        ...validateUpdateTrail(params, prefix),
        ...validateRollbackShape(step, prefix),
      ];
    case 'PutConfigurationRecorderCommand':
      return validatePutConfigurationRecorder(params, prefix);
    case 'PutPublicAccessBlockCommand':
      return validatePutPublicAccessBlock(params, prefix);
    case 'PutDeliveryChannelCommand':
      return validatePutDeliveryChannel(params, prefix);
    case 'PutImageScanningConfigurationCommand':
      return validatePutImageScanningConfiguration(params, prefix);
    default:
      return validateRollbackShape(step, prefix);
  }
}
