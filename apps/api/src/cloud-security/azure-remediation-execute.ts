import { db, Prisma } from '@db';
import type { Logger } from '@nestjs/common';
import { validateAzureGuardedPlanSteps } from './azure-plan-step-validation';
import type { AzureGuardedValidationOptions } from './azure-plan-step-validation';
import { extractAzureResourceGroup } from './azure-remediation-step-url';
import { assertAcknowledgedPlanHash } from './azure-remediation-plan.utils';
import type { AzureFixPlan } from './azure-ai-remediation.prompt';
import type { FindingContext } from './ai-remediation.service';
import type { PlanHashBinding } from './remediation-stable-json';
import type { executeAzurePlanSteps } from './azure-command-executor';
import {
  resolveAzureExecutionIdentity,
  type AzureExecutionIdentity,
} from './azure-remediation-role-resolver';
import { mintAzureSpToken } from './azure-remediation-identity';
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

export interface AzureExecuteParams {
  connectionId: string;
  organizationId: string;
  checkResultId: string;
  remediationKey: string;
  userId: string;
  acknowledgment?: string;
  expectedPlanHash?: string;
}

/** Mutable state threaded through the execute phases. */
export interface AzureExecutionState {
  deps: AzureRemediationFlowDeps;
  logger: Logger;
  params: AzureExecuteParams;
  finding: FindingContext;
  accessToken: string;
  identity: AzureExecutionIdentity;
  spToken: string;
  plan: AzureFixPlan;
  previousState: Record<string, unknown>;
  fixResult: Awaited<ReturnType<typeof executeAzurePlanSteps>>;
  binding: PlanHashBinding;
  findingResourceGroup: string | undefined;
  guardOpts: AzureGuardedValidationOptions;
  action: { id: string };
  cacheKey: string;
}

/**
 * Resolve context, executor identity, and the plan to run (cached or
 * regenerated), then enforce the acknowledgment binding before any write.
 * Creates the action record. Stops before Phase 1 reads.
 */
export async function prepareAzureExecution(args: {
  deps: AzureRemediationFlowDeps;
  params: AzureExecuteParams;
}): Promise<AzureExecutionState> {
  const { deps, params } = args;
  const logger = deps.logger;
  const { finding, accessToken, credentials } = await resolveAzureContext(
    deps,
    params.connectionId,
    params.organizationId,
    params.checkResultId,
  );

  if (!accessToken) {
    throw new Error('Azure access token unavailable. Check credentials.');
  }

  // Resolve the class SP that must execute this fix. Unbound pairs and
  // approval-gated classes throw here — fixes never run on the user
  // OAuth token, which carries unbounded RBAC. Reads below keep the
  // auditor token; only writes use the SP token.
  const identity = resolveAzureExecutionIdentity({
    credentials: credentials ?? {},
    resourceType: finding.resourceType,
    subscriptionId: extractSubscriptionId(finding.resourceId) ?? '',
  });
  const tenantId =
    typeof credentials?.tenantId === 'string'
      ? credentials.tenantId
      : undefined;
  if (!tenantId) {
    throw new Error(
      'Azure tenant unavailable for this connection. Reconnect the integration.',
    );
  }
  const spToken = (
    await mintAzureSpToken({
      tenantId,
      clientId: identity.spAppId,
      clientSecret: identity.secret,
    })
  ).accessToken;

  // Retrieve or regenerate plan
  const cacheParams = {
    organizationId: params.organizationId,
    connectionId: params.connectionId,
    checkResultId: params.checkResultId,
    remediationKey: params.remediationKey,
  };
  const cacheKey = azurePlanCacheKey(cacheParams);
  const cached = deps.planCache.getFresh(cacheKey);
  let plan: AzureFixPlan;

  // Only reuse a fresh AND usable plan — reusing a stale empty / non-auto-
  // fixable plan is what makes "Retry" a no-op (execute reloads the same
  // dead plan and fails identically).
  if (cached && isUsableAzurePlan(cached.plan)) {
    plan = cached.plan;
  } else {
    deps.planCache.delete(cacheKey);
    plan = await deps.aiRemediationService.generateAzureFixPlan(
      finding,
      identity.assetClass,
    );
    if (!isUsableAzurePlan(plan)) {
      throw new Error(
        'This finding cannot be auto-fixed. Use guided steps instead.',
      );
    }
  }

  // Fast-fail before any work: executing infrastructure changes without
  // an explicit acknowledgment, or under a stale one, is never allowed.
  // The hash binds the acknowledgment to the exact previewed steps.
  if (!params.acknowledgment || params.acknowledgment !== 'acknowledged') {
    throw new Error(
      'Acknowledgment is required before executing any remediation.',
    );
  }
  if (!params.expectedPlanHash) {
    throw new Error(
      'Execute requires the previewed plan hash (expectedPlanHash from the preview response). Preview again and acknowledge the new plan before executing.',
    );
  }
  const binding = azurePlanBinding(cacheParams);
  const findingResourceGroup = extractAzureResourceGroup(finding.resourceId);
  if (!findingResourceGroup) {
    logger.warn(
      `Finding ${finding.findingKey} carries no resource group — subscription-wide write scope for ${identity.subscriptionId}.`,
    );
  }
  const guardOpts: AzureGuardedValidationOptions = {
    assetClass: identity.assetClass,
    enforceAllowlist: true,
    expectedSubscriptionId: identity.subscriptionId,
    ...(findingResourceGroup ? { findingResourceGroup } : {}),
  };
  const loadGuardErrors = validateAzureGuardedPlanSteps(
    plan.fixSteps,
    guardOpts,
  );
  if (loadGuardErrors.length > 0) {
    throw new Error(
      `Fix plan validation failed: ${loadGuardErrors.join('; ')}`,
    );
  }
  assertAcknowledgedPlanHash({
    expectedPlanHash: params.expectedPlanHash,
    binding,
    fixSteps: plan.fixSteps,
    rollbackSteps: plan.rollbackSteps,
  });

  // Create action record
  const action = await db.remediationAction.create({
    data: {
      connectionId: params.connectionId,
      organizationId: params.organizationId,
      checkResultId: params.checkResultId,
      remediationKey: params.remediationKey,
      resourceId: finding.resourceId || params.checkResultId,
      resourceType: finding.resourceType || 'azure-resource',
      previousState: {},
      appliedState: {},
      status: 'executing',
      riskLevel: plan.risk,
      acknowledgmentText: params.acknowledgment,
      acknowledgedAt: params.acknowledgment ? new Date() : null,
      initiatedById: params.userId,
    },
  });

  return {
    deps,
    logger,
    params,
    finding,
    accessToken,
    identity,
    spToken,
    plan,
    previousState: {},
    fixResult: { results: [] },
    binding,
    findingResourceGroup,
    guardOpts,
    action,
    cacheKey,
  };
}

/**
 * Record a mid-flow failure: drop the cached plan so Retry regenerates,
 * mark the action failed, and rethrow for the caller to surface.
 */
export async function failAzureExecution(
  state: AzureExecutionState,
  error: unknown,
): Promise<never> {
  const msg = error instanceof Error ? error.message : String(error);
  // Drop the cached plan so a subsequent "Retry" regenerates instead of
  // reloading the plan that just failed.
  state.deps.planCache.delete(state.cacheKey);
  await db.remediationAction.update({
    where: { id: state.action.id },
    data: {
      status: 'failed',
      appliedState: { error: msg },
      executedAt: new Date(),
    },
  });
  throw error;
}

/** Prisma JSON cast for state blobs (matches the previous inline casts). */
export function asPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
