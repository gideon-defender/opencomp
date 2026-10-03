import type { AwsCommandStep } from './ai-remediation.prompt';
import {
  validatePutBucketVersioning,
  validatePutImageTagMutability,
  validateSetTerminationProtection,
  validateUpdateContinuousBackups,
  validateUpdateRoute,
  validateUpdateServiceSetting,
} from './remediation-rollback-validators';
import {
  validateCreateDetector,
  validateQueueEncryption,
  validateTopicEncryption,
  validateTrailLogDelivery,
  validateUpdateDetector,
  validateUpdateLoggingConfiguration,
  validateUpdateStage,
} from './remediation-visibility-validators';

/**
 * Rollback-shape guardrail dispatcher for AI-generated fix steps.
 *
 * Companion to `remediation-param-guardrails`: that module refuses
 * dangerous shapes of the first dual-use actions; this one covers the
 * rest. Per-command validators live in `remediation-rollback-validators`
 * (storage/compute) and `remediation-visibility-validators` (detection
 * off, log delivery emptied) — split out to respect the 300-line limit.
 *
 * `UpdateServiceSetting` is refused wholesale: no adapter emits it as a
 * fix step, and its settings mutate account-wide SSM behavior.
 *
 * Errors follow the `Step N (Command): ...` convention so the AI-repair
 * pass can attribute them to the right step.
 */

/**
 * Returns validation errors for documented-rollback shapes in a fix step.
 * Called from `validateFixStepParams` alongside the first guardrail table
 * — empty array means the params carry no rollback shape.
 */
export function validateRollbackShape(
  step: AwsCommandStep,
  prefix: string,
): string[] {
  const params = step.params ?? {};
  switch (step.command) {
    case 'PutBucketVersioningCommand':
      return validatePutBucketVersioning(params, prefix);
    case 'UpdateContinuousBackupsCommand':
      return validateUpdateContinuousBackups(params, prefix);
    case 'PutImageTagMutabilityCommand':
      return validatePutImageTagMutability(params, prefix);
    case 'SetTerminationProtectionCommand':
      return validateSetTerminationProtection(params, prefix);
    case 'UpdateServiceSettingCommand':
      return validateUpdateServiceSetting(params, prefix);
    case 'CreateDetectorCommand':
      return validateCreateDetector(params, prefix);
    case 'UpdateDetectorCommand':
      return validateUpdateDetector(params, prefix);
    case 'UpdateRouteCommand':
      return validateUpdateRoute(params, prefix);
    case 'UpdateStageCommand':
      return validateUpdateStage(params, prefix);
    case 'UpdateLoggingConfigurationCommand':
      return validateUpdateLoggingConfiguration(params, prefix);
    case 'UpdateTrailCommand':
      return validateTrailLogDelivery(params, prefix);
    case 'SetTopicAttributesCommand':
      return validateTopicEncryption(params, prefix);
    case 'SetQueueAttributesCommand':
      return validateQueueEncryption(params, prefix);
    default:
      return [];
  }
}
