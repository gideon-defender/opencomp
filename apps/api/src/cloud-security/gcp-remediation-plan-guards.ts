/**
 * Plan validation + preview-response assembly for GCP remediation.
 *
 * Extracted from `gcp-remediation.service.ts` to respect the 300-line repo
 * limit: the service orchestrates (context, identity, reads, execution),
 * this module decides whether a plan may run and what the preview promises.
 * No NestJS, no database — the service passes its logger in for warnings.
 */
import type { Logger } from '@nestjs/common';
import type { GcpRemediationAssetClass } from '@gideon-defender/integration-platform';
import type { GcpApiStep, GcpFixPlan } from './gcp-ai-remediation.prompt';
import { validateGcpPlanSteps } from './gcp-plan-step-validation';
import { validateGcpWriteStepParams } from './gcp-remediation-param-guardrails';
import { validateGcpRollbackSteps } from './gcp-remediation-rollback-validators';
import { hashGcpPlanSteps } from './gcp-remediation-plan.utils';
import type { PlanHashBinding } from './remediation-stable-json';

/**
 * Validate fix steps against the class allowlist AND the parameter
 * guardrails. `realState` is the read-step output map when the plan was
 * refined with live state; validators fail closed when the state they
 * need is absent. Empty array means the plan is executable.
 */
export function validateFixPlan(
  plan: GcpFixPlan,
  args: {
    assetClass: GcpRemediationAssetClass;
    realState?: Record<string, unknown>;
    readSteps?: Array<{ method: string; url: string; purpose: string }>;
    /**
     * Project the finding belongs to. Steps naming another project are
     * refused — a fix for one project must never write another, even
     * when the service account would allow it.
     */
    expectedProjectId?: string;
    /**
     * Bucket the finding belongs to. Storage steps must name this bucket
     * — a fix for one bucket must never write another.
     */
    expectedBucket?: string;
  },
): string[] {
  // An empty fix plan can never execute — fail here so previews degrade
  // to guided-only instead of promising a fix button that throws.
  if (!plan.fixSteps || plan.fixSteps.length === 0) {
    return ['AI generated an empty fix plan — refused for safety'];
  }
  const errors = validateGcpPlanSteps(plan.fixSteps, {
    assetClass: args.assetClass,
    enforceAllowlist: true,
    ...(args.expectedProjectId
      ? { expectedProjectId: args.expectedProjectId }
      : {}),
    ...(args.expectedBucket ? { expectedBucket: args.expectedBucket } : {}),
  });
  plan.fixSteps.forEach((step, index) => {
    errors.push(
      ...validateGcpWriteStepParams(step, {
        ...(args.realState ? { realState: args.realState } : {}),
        ...(args.readSteps ? { readSteps: args.readSteps } : {}),
        index,
      }),
    );
  });
  return errors;
}

/**
 * Validate a plan's rollback steps (IAM-verbatim + field-mask shapes +
 * fix-overlap, plus value equality against the pre-fix state when it is
 * available) before anything executes them.
 *
 * Returns the executable steps plus the drop reason when the plan carried
 * rollback steps that failed validation: invalid rollbacks are never
 * executed and never stored, so the auto-rollback path and a later manual
 * rollback cannot run an unreviewed write. The executor treats an empty
 * array as "no safety net" (same as absent), so callers must surface
 * `droppedReason` instead of advertising rollback support.
 */
export function validatedRollbackSteps(args: {
  plan: GcpFixPlan;
  previousState?: Record<string, unknown>;
  assetClass?: GcpRemediationAssetClass;
  readSteps?: Array<{ purpose: string; url: string }>;
  expectedProjectId?: string;
  expectedBucket?: string;
  logger: Pick<Logger, 'warn'>;
}): { steps: GcpApiStep[]; droppedReason?: string } {
  const rollbackSteps = args.plan.rollbackSteps ?? [];
  if (rollbackSteps.length === 0) return { steps: rollbackSteps };
  // Allowlist first when the class is known: execute enforces it and
  // refuses the whole run on mismatch, so a non-allowlisted rollback
  // must drop to "no safety net" here instead of blocking the fix.
  if (args.assetClass) {
    const allowlistErrors = validateGcpPlanSteps(rollbackSteps, {
      assetClass: args.assetClass,
      enforceAllowlist: true,
      isRollback: true,
      ...(args.expectedProjectId
        ? { expectedProjectId: args.expectedProjectId }
        : {}),
      ...(args.expectedBucket ? { expectedBucket: args.expectedBucket } : {}),
    });
    if (allowlistErrors.length > 0) {
      const droppedReason = `non-allowlisted auto-rollback steps: ${allowlistErrors.join('; ')}`;
      args.logger.warn(`Dropping ${droppedReason}`);
      return { steps: [], droppedReason };
    }
  }
  // Bind to the read steps that produced `previousState` — after a refine
  // the plan's own read steps may differ, and binding to the wrong
  // purposes fails closed on valid rollbacks.
  const bindingSteps = args.readSteps ?? args.plan.readSteps;
  const errors = validateGcpRollbackSteps(rollbackSteps, {
    fixSteps: args.plan.fixSteps,
    ...(args.previousState ? { previousState: args.previousState } : {}),
    ...(bindingSteps?.length ? { readSteps: bindingSteps } : {}),
    ...(args.expectedProjectId
      ? { expectedProjectId: args.expectedProjectId }
      : {}),
    ...(args.expectedBucket ? { expectedBucket: args.expectedBucket } : {}),
  });
  if (errors.length > 0) {
    const droppedReason = `invalid auto-rollback steps: ${errors.join('; ')}`;
    args.logger.warn(`Dropping ${droppedReason}`);
    return { steps: [], droppedReason };
  }
  return { steps: rollbackSteps };
}

/**
 * Guided-only preview for a plan that failed validation: names the first
 * error so the user sees why one-click fix is unavailable. Never cached.
 */
export function guidedOnlyForInvalidPlan(
  plan: GcpFixPlan,
  errors: string[],
): Record<string, unknown> {
  return {
    currentState: plan.currentState,
    proposedState: {},
    description: plan.description,
    risk: plan.risk,
    apiCalls: [],
    guidedOnly: true,
    guidedSteps: [
      `Automatic fix is unavailable for this finding: ${errors[0]}. Apply the fix manually in the GCP console.`,
      ...(plan.guidedSteps ?? []),
    ],
    rollbackSupported: false,
    requiresAcknowledgment: undefined,
  };
}

export function buildPreviewResponse(args: {
  plan: GcpFixPlan;
  /**
   * Finding scope for the acknowledgment hash. Execute hashes the same
   * binding, so a hash previewed for one finding never authorizes a run
   * for another.
   */
  binding: PlanHashBinding;
  realState?: Record<string, unknown>;
  assetClass?: GcpRemediationAssetClass;
  expectedProjectId?: string;
  expectedBucket?: string;
  // Read steps that produced `realState` (pre-refinement). Refinement can
  // rename or swap reads, so binding rollback to the refined plan's own
  // reads would validate against a different purpose map than execute —
  // which binds to these same pre-refinement reads (see Phase 3).
  stateReadSteps?: Array<{ purpose: string; url: string }>;
  logger: Pick<Logger, 'warn'>;
}) {
  const apiCalls = args.plan.fixSteps.map((s) => {
    try {
      return `${s.method} ${new URL(s.url).pathname}`;
    } catch {
      return `${s.method} ${s.url}`;
    }
  });

  // Advertise rollback support only for rollbacks that actually validate —
  // against the same live state execute will check, so the preview cannot
  // promise a net that execute drops. Without state this is the
  // shape/overlap bar; an AI-claimed rollback that fails validation must
  // not reach the UI as a promise execute will silently drop.
  // The hash binds the same validated set: execute re-validates before
  // running, so hashing raw AI rollback here would refuse every plan
  // whose net needed trimming.
  const validatedRollback = validatedRollbackSteps({
    plan: args.plan,
    ...(args.realState ? { previousState: args.realState } : {}),
    ...(args.assetClass ? { assetClass: args.assetClass } : {}),
    ...(args.stateReadSteps ? { readSteps: args.stateReadSteps } : {}),
    ...(args.expectedProjectId
      ? { expectedProjectId: args.expectedProjectId }
      : {}),
    ...(args.expectedBucket ? { expectedBucket: args.expectedBucket } : {}),
    logger: args.logger,
  });
  const rollbackSupported =
    args.plan.rollbackSupported && validatedRollback.steps.length > 0;

  return {
    currentState: args.plan.currentState,
    proposedState: args.plan.proposedState,
    description: args.plan.description,
    risk: args.plan.risk,
    apiCalls,
    guidedOnly: false,
    rollbackSupported,
    requiresAcknowledgment: 'checkbox' as const,
    acknowledgmentMessage:
      'This fix will modify your GCP infrastructure. Please review the changes above before proceeding.',
    // Binds execute to this exact plan: pass back as `expectedPlanHash`.
    // Covers the validated rollback set, not the raw AI claim, so the
    // acknowledgment also pins the writes auto-rollback may run.
    planHash: hashGcpPlanSteps(
      args.plan.fixSteps,
      validatedRollback.steps,
      args.binding,
    ),
  };
}
