import { db } from '@db';
import { executeAzurePlanSteps } from './azure-command-executor';
import { validateAzureGuardedPlanSteps } from './azure-plan-step-validation';
import { assertAcknowledgedPlanHash } from './azure-remediation-plan.utils';
import { validatedAzureRollbackSteps } from './azure-remediation-rollback-validators';
import { checkAzureWriteAccess } from './azure-remediation-preconditions';
import { parseAzurePermissionError } from './remediation-error.utils';
import {
  asPrismaJson,
  type AzureExecutionState,
} from './azure-remediation-execute';
import { runAzureSelfHealRetry } from './azure-remediation-retry';

/**
 * Run the fix phases: capture pre-fix reads, refine with real state,
 * re-validate post-refinement, execute with the SP token, and self-heal
 * once on non-permission errors. Returns an early response when the
 * refined plan cannot auto-fix, or null to continue to verification.
 */
export interface AzureDeadPlanResponse {
  actionId: string;
  status: 'failed';
  resourceId: string;
  error: string;
  previousState: Record<string, unknown>;
  guidedSteps: string[] | undefined;
}

export async function runAzureFixPhases(
  state: AzureExecutionState,
): Promise<{ earlyResponse: AzureDeadPlanResponse } | null> {
  const { deps, logger, finding, accessToken, identity } = state;
  let plan = state.plan;

  // Phase 1: Execute read steps to capture previous state. Reads
  // validate as reads first — a write smuggled into readSteps, or a
  // read outside the finding's subscription, fails the run instead
  // of executing on the user token.
  const previousState: Record<string, unknown> = {};
  if (plan.readSteps.length > 0) {
    const preFixReadErrors = validateAzureGuardedPlanSteps(plan.readSteps, {
      assetClass: identity.assetClass,
      isRead: true,
      expectedSubscriptionId: identity.subscriptionId,
    });
    if (preFixReadErrors.length > 0) {
      throw new Error(`Invalid read steps: ${preFixReadErrors.join('; ')}`);
    }
    const readResult = await executeAzurePlanSteps({
      steps: plan.readSteps,
      accessToken,
    });
    for (const r of readResult.results) {
      if (r.success && r.response) {
        previousState[r.step.purpose] = r.response;
      }
    }
  }

  // Phase 2: Refine plan with real state
  if (Object.keys(previousState).length > 0) {
    plan = await deps.aiRemediationService.refineAzureFixPlan({
      finding,
      originalPlan: plan,
      realAzureState: previousState,
      assetClass: identity.assetClass,
    });
  }

  // Post-refine binding: refinement rewrites steps, so the pre-refine
  // check alone is a TOCTOU pass-through. Re-validate the rewritten
  // steps and refuse drifted plans before any write.
  const refinedGuardErrors = validateAzureGuardedPlanSteps(
    plan.fixSteps,
    state.guardOpts,
  );
  if (refinedGuardErrors.length > 0) {
    throw new Error(
      `Fix plan validation failed after refinement: ${refinedGuardErrors.join('; ')}`,
    );
  }
  assertAcknowledgedPlanHash({
    expectedPlanHash: state.params.expectedPlanHash,
    binding: state.binding,
    fixSteps: plan.fixSteps,
    rollbackSteps: plan.rollbackSteps,
  });

  // A plan whose rollback cannot be proven sound ships no safety net —
  // refuse the run instead of executing without one.
  const checkedRollback = validatedAzureRollbackSteps({
    rollbackSteps: plan.rollbackSteps,
    fixSteps: plan.fixSteps,
    previousState,
    expectedSubscriptionId: identity.subscriptionId,
    ...(state.findingResourceGroup
      ? { findingResourceGroup: state.findingResourceGroup }
      : {}),
    assetClass: identity.assetClass,
    logger,
  });
  if (checkedRollback.droppedReason) {
    throw new Error(
      `Rollback steps failed validation (${checkedRollback.droppedReason}) — refusing to run without a safety net.`,
    );
  }
  plan = { ...plan, rollbackSteps: checkedRollback.steps };

  logger.log(
    `AI plan for ${finding.findingKey}: canAutoFix=${plan.canAutoFix}, ` +
      `fixSteps=${plan.fixSteps.length}, readSteps=${plan.readSteps.length}, ` +
      `rollbackSteps=${plan.rollbackSteps.length}`,
  );

  // If AI decided it can't auto-fix after seeing real state, fail clearly
  if (!plan.canAutoFix || plan.fixSteps.length === 0) {
    // Drop the dead plan so Retry regenerates instead of reloading it.
    deps.planCache.delete(state.cacheKey);
    await db.remediationAction.update({
      where: { id: state.action.id },
      data: {
        status: 'failed',
        previousState: asPrismaJson(previousState),
        appliedState: asPrismaJson({
          error:
            plan.reason ||
            'Auto-fix not possible for this finding after analyzing real resource state.',
          guidedSteps: plan.guidedSteps,
        }),
        executedAt: new Date(),
      },
    });

    return {
      earlyResponse: {
        actionId: state.action.id,
        status: 'failed' as const,
        resourceId: finding.resourceId,
        error:
          plan.reason ||
          'Auto-fix not possible. The required resources (e.g., Log Analytics workspace) may not exist in your subscription.',
        previousState,
        guidedSteps: plan.guidedSteps,
      },
    };
  }

  // Phase 2.5: Pre-flight — the executor identity must provably hold a
  // write grant. Fail closed: unproven writes do not run.
  await checkAzureWriteAccess({
    accessToken: state.spToken,
    subscriptionId: identity.subscriptionId,
  });

  // Phase 3: Execute fix steps with self-healing retry
  // Executor auto-handles: provider registration, throttling, retries, provisioning waits
  for (const step of plan.fixSteps) {
    logger.log(`Fix step: ${step.method} ${step.url} — ${step.purpose}`);
  }

  // Fix steps were allowlist-validated pre- and post-refinement above;
  // the executor re-validates its denylist at runtime as the last layer.
  state.plan = plan;
  state.previousState = previousState;
  state.fixResult = await executeAzurePlanSteps({
    steps: plan.fixSteps,
    accessToken: state.spToken,
    autoRollbackSteps: plan.rollbackSteps,
  });

  // If permission error, report it clearly — don't attempt self-healing role grants
  if (state.fixResult.error) {
    const permError = parseAzurePermissionError(state.fixResult.error.message);
    if (permError?.isPermissionError) {
      logger.warn(
        `Permission error: ${state.fixResult.error.message}. Re-run the setup script for the bound pair ${identity.expectedKey} to repair the binding.`,
      );
    }
  }

  // Self-healing round 2: non-permission error → regenerate plan with error context → retry
  if (
    state.fixResult.error &&
    !parseAzurePermissionError(state.fixResult.error.message)?.isPermissionError
  ) {
    logger.log(
      'Non-permission error — regenerating fix plan with error context...',
    );
    const retried = await runAzureSelfHealRetry(state);
    if (retried) state.fixResult = retried;
  }

  return null;
}
