import { asRecord, retentionSeconds } from './gcp-remediation-validator-shared';
import { coveringReadSteps } from './gcp-remediation-prior-lookups';
import {
  findBoundPriorRecord,
  findPriorStateValue,
  isFieldMaskedReadUrl,
  type GcpReadStepRef,
  type GcpStepIdentity,
} from './gcp-remediation-prior-state';

/**
 * Bucket retention-policy guardrails for AI-generated GCP fix steps.
 *
 * Split from `gcp-remediation-bucket-guardrails` to respect the 300-line
 * repo limit. Every rejection routes the plan to guided-only, never to
 * execution.
 */

/**
 * True when the fix provably ADDS a retention policy instead of editing
 * one: exactly one read covers the fix target, its output is a record
 * carrying no `retentionPolicy` key, and no covering read selects a field
 * subset. A field-masked read (`?fields=name`) omits the policy even when
 * the bucket has one — "no key" then proves nothing, so masked covering
 * reads fail the proof. Anything else (no bound read, several, or a
 * masked one) leaves the prior period unprovable and the caller refuses.
 */
function isNewRetentionPolicy(args: {
  realState: Record<string, unknown> | undefined;
  readSteps?: GcpReadStepRef[];
  fixStep: GcpStepIdentity;
}): boolean {
  const bound = findBoundPriorRecord(args.realState, {
    ...(args.readSteps ? { readSteps: args.readSteps } : {}),
    fixStep: args.fixStep,
  });
  if (!bound || 'retentionPolicy' in bound) return false;
  // Same covering matcher as the bound lookup above — a second matcher
  // here could disagree on which reads ground the fix and let a masked
  // read's omission read as proof.
  const covering = coveringReadSteps({
    ...(args.readSteps ? { readSteps: args.readSteps } : {}),
    fixStep: args.fixStep,
  });
  if (covering.length === 0) return false;
  return covering.every((step) => !isFieldMaskedReadUrl(step));
}

/**
 * Durability posture: disabling versioning-adjacent retention or clearing
 * the retention policy is never an exposure fix — it deletes recovery
 * guarantees. PATCH merges, so only explicit clears refuse (absent ≠
 * removal). Shortening compares against the bound pre-fix period when
 * readable; without any pre-fix read state the shortening is unprovable
 * and refuses instead of weakening blind.
 */
export function validateGcpBucketRetentionPolicy(args: {
  body: Record<string, unknown>;
  prefix: string;
  step: GcpStepIdentity;
  realState: Record<string, unknown> | undefined;
  readSteps?: GcpReadStepRef[];
}): string[] {
  const errors: string[] = [];
  if (args.body.retentionPolicy === null) {
    errors.push(
      `${args.prefix}: clearing the bucket retention policy removes deletion protection — refused for safety`,
    );
    return errors;
  }
  const retention = asRecord(args.body.retentionPolicy);
  if (!retention || !('retentionPeriod' in retention)) return errors;
  const period =
    typeof retention.retentionPeriod === 'string'
      ? retention.retentionPeriod
      : '';
  const seconds = retentionSeconds(period);
  if (seconds === undefined || seconds === 0) {
    errors.push(
      `${args.prefix}: clearing the bucket retention policy removes deletion protection — refused for safety`,
    );
    return errors;
  }
  // Shortening weakens deletion protection the same way clearing
  // does — compare against the bound pre-fix period when readable.
  // Without any pre-fix read state the shortening is unprovable:
  // refuse instead of weakening blind (the same bar the rollback
  // validators and databaseFlags checks hold elsewhere).
  if (!args.realState || Object.keys(args.realState).length === 0) {
    errors.push(
      `${args.prefix}: retention edits without pre-fix read state cannot prove they preserve deletion protection — refused for safety`,
    );
    return errors;
  }
  const prior = findPriorStateValue(args.realState, 'retentionPolicy', {
    ...(args.readSteps ? { readSteps: args.readSteps } : {}),
    fixStep: args.step,
  });
  const priorPeriod = asRecord(prior?.value)?.retentionPeriod;
  const priorSeconds =
    typeof priorPeriod === 'string' ? retentionSeconds(priorPeriod) : undefined;
  if (priorSeconds !== undefined) {
    if (seconds < priorSeconds) {
      errors.push(
        `${args.prefix}: shortening the bucket retention period weakens deletion protection — refused for safety`,
      );
    }
    return errors;
  }
  // No readable prior period and no proof the bucket lacks one:
  // a year-to-hour shortening would pass the comparison above
  // by default and silently remove deletion protection. Refuse
  // instead of weakening blind.
  if (
    !isNewRetentionPolicy({
      realState: args.realState,
      ...(args.readSteps ? { readSteps: args.readSteps } : {}),
      fixStep: args.step,
    })
  ) {
    errors.push(
      `${args.prefix}: retention shortening without a readable pre-fix period cannot prove it preserves deletion protection — refused for safety`,
    );
  }
  return errors;
}
