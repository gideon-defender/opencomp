import { db } from '@db';
import { executeAzurePlanSteps } from './azure-command-executor';
import { validateAzureGuardedPlanSteps } from './azure-plan-step-validation';
import { azureFixWrittenPathsByPurpose } from './azure-remediation-verify-paths';
import { isFixVerifiedByState } from './azure-remediation-plan.utils';
import { parseAzurePermissionError } from './remediation-error.utils';
import {
  asPrismaJson,
  type AzureExecutionState,
} from './azure-remediation-execute';

/**
 * Finalize the run: log step results, record failures, then verify by
 * re-reading the resource. Verification only credits changes on paths
 * the fix wrote — unrelated drift (etag churn, another actor's edit)
 * reads as unverified, never as proof the fix worked.
 */
export async function verifyAndFinalizeAzureExecution(
  state: AzureExecutionState,
) {
  const { deps, logger, finding, accessToken, identity, plan, previousState } =
    state;
  const fixResult = state.fixResult;

  // Log every step result for audit trail
  for (const r of fixResult.results) {
    logger.log(
      `Step result: ${r.step.method} ${r.step.url} → ${r.success ? `${r.statusCode} OK` : `FAILED: ${r.error}`}`,
    );
  }

  // If still failing after self-healing attempts
  if (fixResult.error) {
    // Drop the dead plan so Retry regenerates instead of reloading it.
    deps.planCache.delete(state.cacheKey);
    const permError = parseAzurePermissionError(fixResult.error.message);

    // Store ALL completed steps (even partial) so we can see what was modified
    await db.remediationAction.update({
      where: { id: state.action.id },
      data: {
        status: 'failed',
        previousState: asPrismaJson(previousState),
        appliedState: asPrismaJson({
          error: fixResult.error.message,
          stepIndex: fixResult.error.stepIndex,
          executedAs: {
            spAppId: identity.spAppId,
            assetClass: identity.assetClass,
            key: identity.expectedKey,
          },
          completedSteps: fixResult.results
            .filter((r) => r.success)
            .map((r) => ({
              method: r.step.method,
              url: r.step.url,
              purpose: r.step.purpose,
              statusCode: r.statusCode,
            })),
          failedStep: {
            method: fixResult.error.step.method,
            url: fixResult.error.step.url,
            purpose: fixResult.error.step.purpose,
            error: fixResult.error.message,
          },
          rollbackSteps: plan.rollbackSteps,
          // parseAzurePermissionError always returns an object — gate on
          // the flag, not truthiness, or every failure carries empty
          // permission fields.
          ...(permError.isPermissionError
            ? {
                missingActions: permError.missingActions,
                fixScript: permError.fixScript,
              }
            : {}),
        }),
        executedAt: new Date(),
      },
    });

    return {
      actionId: state.action.id,
      status: 'failed' as const,
      resourceId: finding.resourceId,
      error: fixResult.error.message,
      previousState,
      ...(permError.isPermissionError
        ? {
            missingPermissions: permError.missingActions,
            permissionFixScript: permError.fixScript,
          }
        : {}),
    };
  }

  // Phase 4: Verify — re-read the resource to confirm fix took effect.
  // Refinement rewrites readSteps after the Phase-1 check, so the
  // verify block re-validates them as reads first: a write smuggled
  // into refined readSteps must never execute on the user token, and
  // cross-subscription reads must never run here.
  let verified = false;
  if (plan.readSteps.length > 0) {
    const verifyReadErrors = validateAzureGuardedPlanSteps(plan.readSteps, {
      assetClass: identity.assetClass,
      isRead: true,
      expectedSubscriptionId: identity.subscriptionId,
    });
    if (verifyReadErrors.length > 0) {
      throw new Error(`Invalid verify steps: ${verifyReadErrors.join('; ')}`);
    }
    // Wait briefly for Azure to propagate the change
    await new Promise((r) => setTimeout(r, 2000));

    const verifyResult = await executeAzurePlanSteps({
      steps: plan.readSteps,
      accessToken,
    });

    const postFixState: Record<string, unknown> = {};
    for (const r of verifyResult.results) {
      if (r.success && r.response) {
        postFixState[r.step.purpose] = r.response;
      }
    }

    // Compare on canonical JSON: key order in ARM responses is not
    // stable, so a raw stringify flips verified/unverified on
    // identical states. No verify data is not proof of a fix either:
    // an empty post-state (every verify read failed) must read as
    // unverified, never as "changed" — and with no captured before
    // state there is nothing to compare against. Each purpose verifies
    // against its own writes: drift in one entry never proves a fix
    // written to another.
    verified = isFixVerifiedByState({
      previousState,
      postFixState,
      writtenPathsByPurpose: azureFixWrittenPathsByPurpose({
        fixSteps: plan.fixSteps,
        readSteps: plan.readSteps,
      }),
    });
  }

  const status: 'success' | 'unverified' = verified ? 'success' : 'unverified';
  await db.remediationAction.update({
    where: { id: state.action.id },
    data: {
      status,
      previousState: asPrismaJson(previousState),
      appliedState: asPrismaJson({
        steps: fixResult.results.map((r) => ({
          purpose: r.step.purpose,
          statusCode: r.statusCode,
          response: r.response,
        })),
        rollbackSteps: plan.rollbackSteps,
        verified,
        executedAs: {
          spAppId: identity.spAppId,
          assetClass: identity.assetClass,
          key: identity.expectedKey,
        },
      }),
      executedAt: new Date(),
    },
  });

  deps.planCache.delete(state.cacheKey);

  if (!verified) {
    logger.warn(
      `Fix for ${finding.findingKey} executed but verification shows no state change. ` +
        `The fix may need time to propagate or may not have addressed the finding correctly.`,
    );
  }

  return {
    actionId: state.action.id,
    status: status,
    resourceId: finding.resourceId,
    previousState,
    appliedState: { description: plan.description, verified },
  };
}
