import type { GcpRemediationAssetClass } from '@gideon-defender/integration-platform';
import {
  validateGcpPlanSteps,
  type GcpApiStep,
} from './gcp-plan-step-validation';

export interface GcpExecutorOptions {
  steps: GcpApiStep[];
  accessToken: string;
  autoRollbackSteps?: GcpApiStep[];
  isRollback?: boolean;
  /**
   * When provided with `enforceAllowlist`, fix/rollback steps are also
   * checked against the asset-class allowlist — not just the URL shape.
   * Callers executing writes must pass the finding's asset class so
   * AI-generated rollback steps cannot bypass the allowlist on the
   * auto-rollback path.
   */
  assetClass?: GcpRemediationAssetClass;
  enforceAllowlist?: boolean;
  /**
   * Read executions (auditor token, no acknowledgment) must pass
   * `isRead: true`: steps are validated as read-only (GET, or POST for
   * `:getIamPolicy`) against the read-host allowlist before anything runs.
   */
  isRead?: boolean;
  /**
   * Project the finding under remediation belongs to. When provided, every
   * step that names a project must name this one — a fix for one project
   * must never write another, even when the token would allow it. Steps
   * without a project signal (bare bucket paths) are unaffected.
   */
  expectedProjectId?: string;
  /**
   * Bucket the finding belongs to. Storage steps must name this bucket —
   * bare bucket paths carry no project signal but always carry a bucket,
   * so without this a fix for one bucket writes any globally named one.
   */
  expectedBucket?: string;
}

export interface GcpPreconditionFailure {
  stepIndex: number;
  // Optional: plan-level refusals (empty steps, rollback present on a read)
  // name no single step. Consumers must not dereference this blindly.
  step?: GcpApiStep;
  message: string;
}

/**
 * Pre-execution gates for GCP plan steps. Validates ALL step URLs before
 * anything runs — fix steps and rollback steps validate under different
 * flags (rollback steps allow prefix-scoped DELETE, fix steps never do).
 * Returns the failure to report, or null when execution may proceed.
 * Pure function, no network — the executor executes, this module refuses.
 */
export function checkGcpExecutionPreconditions(
  opts: GcpExecutorOptions,
): GcpPreconditionFailure | null {
  const baseOpts = {
    ...(opts.assetClass ? { assetClass: opts.assetClass } : {}),
    ...(opts.enforceAllowlist ? { enforceAllowlist: true } : {}),
    ...(opts.expectedProjectId
      ? { expectedProjectId: opts.expectedProjectId }
      : {}),
    ...(opts.expectedBucket ? { expectedBucket: opts.expectedBucket } : {}),
  };
  const validationErrors = [
    ...validateGcpPlanSteps(opts.steps, {
      ...baseOpts,
      ...(opts.isRollback ? { isRollback: true } : {}),
      ...(opts.isRead ? { isRead: true } : {}),
    }),
    ...validateGcpPlanSteps(opts.autoRollbackSteps ?? [], {
      ...baseOpts,
      isRollback: true,
    }),
  ];
  if (validationErrors.length > 0) {
    return {
      stepIndex: 0,
      step: opts.steps[0] ?? opts.autoRollbackSteps?.[0],
      message: `URL validation failed: ${validationErrors.join('; ')}`,
    };
  }

  // Read executions run pre-acknowledgment with the auditor token: they
  // must never trigger writes. Rollback steps are refused above; the
  // retry loop below is also read-safe: `executeWithRetry` skips the
  // `services:enable` auto-enablement on reads (a billable config change
  // outside every allowlist) and fails the read instead.
  if (opts.isRead && (opts.autoRollbackSteps?.length ?? 0) > 0) {
    return {
      stepIndex: 0,
      step: opts.steps[0] ?? opts.autoRollbackSteps?.[0],
      message:
        'Read executions cannot carry rollback steps — refused for safety',
    };
  }

  // The auto-rollback loop below compensates by position
  // (rollback[j] undoes fix step j), so a present rollback array must line
  // up 1:1. An empty array means "no safety net" (same as absent) — the fix
  // proceeds without auto-rollback. Anything else would roll back the wrong
  // subset — refuse instead of executing a plan whose compensation does
  // not match its writes.
  if (
    opts.autoRollbackSteps &&
    opts.autoRollbackSteps.length > 0 &&
    opts.autoRollbackSteps.length !== opts.steps.length
  ) {
    return {
      stepIndex: 0,
      step: opts.steps[0] ?? opts.autoRollbackSteps?.[0],
      message:
        `Rollback mismatch: ${opts.autoRollbackSteps.length} rollback steps ` +
        `for ${opts.steps.length} fix steps. Refusing to execute without 1:1 compensation.`,
    };
  }
  return null;
}
