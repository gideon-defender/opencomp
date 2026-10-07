import { executeAzurePlanSteps } from './azure-command-executor';
import { validateAzureGuardedPlanSteps } from './azure-plan-step-validation';
import { extractAzureResourceGroup } from './azure-remediation-step-url';
import { hashAzurePlanSteps } from './azure-remediation-plan.utils';
import { validatedAzureRollbackSteps } from './azure-remediation-rollback-validators';
import {
  approvalGatedAzurePlan,
  buildAzureGuidedResponse,
  buildAzurePreviewResponse,
  unscopedAzurePlan,
} from './azure-remediation-responses';
import { resolveAzureRemediationIdentity } from './azure-remediation-role-resolver';
import {
  extractSubscriptionId,
  resolveAzureContext,
  type AzureRemediationFlowDeps,
} from './azure-remediation-context';
import {
  azurePlanBinding,
  azurePlanCacheKey,
  isUsableAzurePlan,
} from './azure-remediation-plan-cache';

/**
 * Preview an Azure remediation: generate the AI fix plan, ground it with
 * real-ARM reads, gate it through the allowlist, and cache the usable
 * result for execute. Refused plans go guided-only and nothing is cached.
 */
export async function previewAzureRemediation(args: {
  deps: AzureRemediationFlowDeps;
  connectionId: string;
  organizationId: string;
  checkResultId: string;
  remediationKey: string;
}) {
  const { deps } = args;
  const { finding, accessToken, credentials } = await resolveAzureContext(
    deps,
    args.connectionId,
    args.organizationId,
    args.checkResultId,
  );

  // Approval-gated classes never auto-execute: surface guided steps
  // without spending an AI plan call. A configured binding there
  // enables reads, never writes.
  const gate = resolveAzureRemediationIdentity({
    credentials: credentials ?? {},
    resourceType: finding.resourceType,
    subscriptionId: extractSubscriptionId(finding.resourceId) ?? '',
  });
  if (gate.approvalGated) {
    return buildAzureGuidedResponse(
      approvalGatedAzurePlan({
        assetClass: gate.assetClass,
        title: finding.title,
      }),
    );
  }

  // Generate AI plan, grounded in the finding's asset-class allowlist
  // so the model only proposes calls the validator will accept.
  const assetClass = gate.assetClass;
  const subscriptionId = extractSubscriptionId(finding.resourceId) ?? '';
  const findingResourceGroup = extractAzureResourceGroup(finding.resourceId);
  if (!findingResourceGroup) {
    deps.logger.warn(
      `Finding ${finding.findingKey} carries no resource group — subscription-wide write scope for ${subscriptionId}.`,
    );
  }

  // Fail closed without a subscription scope: the allowlist strips the
  // subscription head before it matches, so an unscoped finding would
  // validate any subscription's resources on shape alone — and the
  // identity resolver cannot bind an executor pair without one either.
  if (!subscriptionId) {
    return buildAzureGuidedResponse(unscopedAzurePlan(finding.title));
  }

  let plan = await deps.aiRemediationService.generateAzureFixPlan(
    finding,
    assetClass,
  );

  if (!plan.canAutoFix) {
    return buildAzureGuidedResponse(plan);
  }

  // Execute read steps to get real Azure state. Reads validate as
  // reads first (GET-only, subscription-pinned): a write smuggled into
  // readSteps never executes, and cross-subscription reads never run on
  // the user token. Refused reads fail into the ungrounded path below
  // instead of grounding refinement on attacker-shaped data.
  const realState: Record<string, unknown> = {};
  if (plan.readSteps.length > 0 && accessToken) {
    const previewReadErrors = validateAzureGuardedPlanSteps(plan.readSteps, {
      assetClass,
      isRead: true,
      ...(subscriptionId ? { expectedSubscriptionId: subscriptionId } : {}),
    });
    if (previewReadErrors.length > 0) {
      deps.logger.warn(
        `Preview reads refused: ${previewReadErrors.join('; ')}`,
      );
    } else {
      const readResult = await executeAzurePlanSteps({
        steps: plan.readSteps,
        accessToken,
      });

      for (const r of readResult.results) {
        if (r.success && r.response) {
          realState[r.step.purpose] = r.response;
        }
      }

      // Refine plan with real Azure state
      if (Object.keys(realState).length > 0) {
        plan = await deps.aiRemediationService.refineAzureFixPlan({
          finding,
          originalPlan: plan,
          realAzureState: realState,
          assetClass,
        });
      }
    }
  }

  // The refined plan can flip canAutoFix to false after seeing real state —
  // surface guided steps instead of a misleading auto-fix preview.
  if (!plan.canAutoFix) {
    return buildAzureGuidedResponse(plan);
  }

  // Phase B: allowlist-first gate at preview — refused plans go
  // guided-only and nothing is cached. The executor's denylist stays as
  // the runtime second layer, never the only one.
  const guardErrors = validateAzureGuardedPlanSteps(plan.fixSteps, {
    assetClass,
    enforceAllowlist: true,
    ...(subscriptionId ? { expectedSubscriptionId: subscriptionId } : {}),
    ...(findingResourceGroup ? { findingResourceGroup } : {}),
  });
  if (guardErrors.length > 0) {
    deps.logger.warn(
      `Fix plan refused by allowlist: ${guardErrors.join('; ')}`,
    );
    return buildAzureGuidedResponse(plan);
  }

  // A plan whose rollback cannot be proven sound ships no safety net —
  // fail the preview to guided-only instead of caching it.
  const checkedRollback = validatedAzureRollbackSteps({
    rollbackSteps: plan.rollbackSteps,
    fixSteps: plan.fixSteps,
    previousState: realState,
    ...(subscriptionId ? { expectedSubscriptionId: subscriptionId } : {}),
    ...(findingResourceGroup ? { findingResourceGroup } : {}),
    assetClass,
    logger: deps.logger,
  });
  if (checkedRollback.droppedReason) {
    deps.logger.warn(
      `Fix plan rollback refused: ${checkedRollback.droppedReason}`,
    );
    return buildAzureGuidedResponse(plan);
  }
  plan = { ...plan, rollbackSteps: checkedRollback.steps };

  // Cache plan for execute. Never cache an unusable (empty / non-auto-
  // fixable) plan — caching one turns "Retry" into a no-op that reloads the
  // same dead plan.
  const cacheParams = {
    connectionId: args.connectionId,
    organizationId: args.organizationId,
    checkResultId: args.checkResultId,
    remediationKey: args.remediationKey,
  };
  const binding = azurePlanBinding(cacheParams);
  const planHash = hashAzurePlanSteps(
    plan.fixSteps,
    plan.rollbackSteps,
    binding,
  );
  const cacheKey = azurePlanCacheKey(cacheParams);
  if (isUsableAzurePlan(plan)) {
    deps.planCache.set(cacheKey, plan);
  }

  return { ...buildAzurePreviewResponse(plan), planHash };
}
