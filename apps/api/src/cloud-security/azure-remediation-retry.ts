import { executeAzurePlanSteps } from './azure-command-executor';
import { validateAzureGuardedPlanSteps } from './azure-plan-step-validation';
import {
  assertAzureRetryBodiesPinned,
  assertAzureRetryTargetsPinned,
} from './azure-remediation-plan.utils';
import { validatedAzureRollbackSteps } from './azure-remediation-rollback-validators';
import type { AzureExecutionState } from './azure-remediation-execute';

/**
 * Self-healing round 2: a non-permission error regenerates the plan with
 * error context and retries. The retry is a new plan the user never
 * acknowledged, so it stays triple-bound: same targets, no new fields at
 * any depth, valid rollback — otherwise the retry is skipped and the
 * original failure stands. Returns the new fix result, or null to keep
 * the original.
 */
export async function runAzureSelfHealRetry(
  state: AzureExecutionState,
): Promise<Awaited<ReturnType<typeof executeAzurePlanSteps>> | null> {
  const { deps, logger, finding, identity, previousState } = state;
  const retryPlan = await deps.aiRemediationService.refineAzureFixPlan({
    finding,
    originalPlan: state.plan,
    realAzureState: {
      ...previousState,
      _lastError: state.fixResult.error?.message,
      _failedStep: state.fixResult.error?.step,
    },
    assetClass: identity.assetClass,
  });

  if (!retryPlan.canAutoFix || retryPlan.fixSteps.length === 0) return null;

  try {
    const retryGuardErrors = validateAzureGuardedPlanSteps(
      retryPlan.fixSteps,
      state.guardOpts,
    );
    if (retryGuardErrors.length > 0) {
      throw new Error(
        `Retry plan validation failed: ${retryGuardErrors.join('; ')}`,
      );
    }
    assertAzureRetryTargetsPinned({
      currentFixSteps: state.plan.fixSteps,
      retryFixSteps: retryPlan.fixSteps,
    });
    // The retry is unacknowledged, so bound its drift twice: same
    // targets (above) AND no new fields at any depth. New values
    // inside previewed fields keep the acknowledged risk class;
    // new fields are new behavior and need a new preview.
    assertAzureRetryBodiesPinned({
      currentFixSteps: state.plan.fixSteps,
      retryFixSteps: retryPlan.fixSteps,
    });
    const retryRollback = validatedAzureRollbackSteps({
      rollbackSteps: retryPlan.rollbackSteps,
      fixSteps: retryPlan.fixSteps,
      previousState,
      expectedSubscriptionId: identity.subscriptionId,
      ...(state.findingResourceGroup
        ? { findingResourceGroup: state.findingResourceGroup }
        : {}),
      assetClass: identity.assetClass,
      logger,
    });
    if (retryRollback.droppedReason) {
      throw new Error(
        `Retry rollback failed validation (${retryRollback.droppedReason})`,
      );
    }
    logger.log(
      `Retrying with regenerated plan (${retryPlan.fixSteps.length} steps)...`,
    );
    state.plan = { ...retryPlan, rollbackSteps: retryRollback.steps };
    return await executeAzurePlanSteps({
      steps: state.plan.fixSteps,
      accessToken: state.spToken,
      autoRollbackSteps: state.plan.rollbackSteps,
    });
  } catch (retryRefusal) {
    logger.warn(
      `Skipping self-heal retry: ${retryRefusal instanceof Error ? retryRefusal.message : String(retryRefusal)}`,
    );
    return null;
  }
}
