import { db } from '@db';
import { executeAzurePlanSteps } from './azure-command-executor';
import {
  narrowToAzureApiSteps,
  validateAzureGuardedPlanSteps,
} from './azure-plan-step-validation';
import { extractAzureResourceGroup } from './azure-remediation-step-url';
import { resolveAzureExecutionIdentity } from './azure-remediation-role-resolver';
import { mintAzureSpToken } from './azure-remediation-identity';
import { checkAzureWriteAccess } from './azure-remediation-preconditions';
import { parseAzurePermissionError } from './remediation-error.utils';
import {
  extractSubscriptionId,
  resolveAzureCredentials,
  type AzureRemediationFlowDeps,
} from './azure-remediation-context';

/**
 * Roll back a completed remediation: reload the stored rollback steps,
 * re-resolve the executor identity (never trust stored state), re-validate
 * the stored steps as rollback writes, and run them on the class SP token.
 */
export async function rollbackAzureRemediation(args: {
  deps: AzureRemediationFlowDeps;
  actionId: string;
  organizationId: string;
}) {
  const { deps, actionId, organizationId } = args;
  const logger = deps.logger;
  const action = await db.remediationAction.findFirst({
    where: {
      id: actionId,
      organizationId,
      status: { in: ['success', 'unverified'] },
    },
    include: {
      connection: { include: { provider: true } },
    },
  });

  if (!action) {
    throw new Error('Remediation action not found or cannot be rolled back.');
  }

  const appliedState = action.appliedState as Record<string, unknown> | null;
  const rollbackSteps = narrowToAzureApiSteps(
    appliedState?.rollbackSteps ?? [],
  );

  if (!rollbackSteps) {
    throw new Error('Stored rollback steps are malformed — refusing to run.');
  }

  if (rollbackSteps.length === 0) {
    throw new Error('No rollback steps available for this action.');
  }

  // Resolve the class SP that must run the rollback — same gates as
  // execute. The binding is re-resolved (not trusted from stored state)
  // so a binding removed since the fix refuses instead of running on
  // the user token.
  const rollbackCreds = await resolveAzureCredentials(
    deps,
    action.connectionId,
    action.organizationId,
  );
  if (!rollbackCreds) {
    throw new Error(
      'Cannot obtain Azure credentials for rollback. Please reconnect the integration.',
    );
  }
  const rollbackIdentity = resolveAzureExecutionIdentity({
    credentials: rollbackCreds,
    resourceType:
      typeof action.resourceType === 'string' ? action.resourceType : null,
    subscriptionId: extractSubscriptionId(action.resourceId) ?? '',
  });
  const rollbackTenant =
    typeof rollbackCreds.tenantId === 'string'
      ? rollbackCreds.tenantId
      : undefined;
  if (!rollbackTenant) {
    throw new Error(
      'Azure tenant unavailable for this connection. Reconnect the integration.',
    );
  }
  const rollbackSpToken = (
    await mintAzureSpToken({
      tenantId: rollbackTenant,
      clientId: rollbackIdentity.spAppId,
      clientSecret: rollbackIdentity.secret,
    })
  ).accessToken;

  logger.log(`Rolling back action ${action.id}: ${rollbackSteps.length} steps`);
  for (const step of rollbackSteps) {
    logger.log(
      `Rollback step: ${(step as { method?: string }).method} ${(step as { url?: string }).url} — ${(step as { purpose?: string }).purpose}`,
    );
  }

  // Pre-flight: the executor identity must provably hold a write grant.
  await checkAzureWriteAccess({
    accessToken: rollbackSpToken,
    subscriptionId: rollbackIdentity.subscriptionId,
  });

  // Stored steps are AI-generated too: re-validate them as rollback
  // writes (allowlist + shape) instead of trusting the stored state.
  // Approval-gated classes already refused above at identity resolution.
  const rollbackResourceGroup = extractAzureResourceGroup(action.resourceId);
  if (!rollbackResourceGroup) {
    logger.warn(
      `Rollback for action ${action.id} carries no resource group — subscription-wide write scope for ${rollbackIdentity.subscriptionId}.`,
    );
  }
  const rollbackGuardErrors = validateAzureGuardedPlanSteps(rollbackSteps, {
    assetClass: rollbackIdentity.assetClass,
    enforceAllowlist: true,
    isRollback: true,
    expectedSubscriptionId: rollbackIdentity.subscriptionId,
    ...(rollbackResourceGroup
      ? { findingResourceGroup: rollbackResourceGroup }
      : {}),
  });
  if (rollbackGuardErrors.length > 0) {
    throw new Error(
      `Stored rollback failed validation: ${rollbackGuardErrors.join('; ')} — re-preview the finding.`,
    );
  }

  const result = await executeAzurePlanSteps({
    steps: rollbackSteps,
    accessToken: rollbackSpToken,
    isRollback: true,
  });

  // If permission error during rollback, log clearly
  if (result.error) {
    const permError = parseAzurePermissionError(result.error.message);
    if (permError?.isPermissionError) {
      logger.warn(
        `Rollback permission error: ${result.error.message}. Re-run the setup script for the bound pair ${rollbackIdentity.expectedKey} to repair the binding.`,
      );
    }
  }

  // Log each rollback step result
  for (const r of result.results) {
    logger.log(
      `Rollback result: ${r.step.method} ${r.step.url} → ${r.success ? `${r.statusCode} OK` : `FAILED: ${r.error}`}`,
    );
  }

  if (result.error) {
    const permError = parseAzurePermissionError(result.error.message);
    const completedCount = result.results.filter((r) => r.success).length;

    logger.error(
      `Rollback failed at step ${result.error.stepIndex}: ${result.error.message}. ` +
        `${completedCount}/${rollbackSteps.length} steps completed before failure.`,
    );

    await db.remediationAction.update({
      where: { id: action.id },
      data: {
        status: 'rollback_failed',
        rolledBackAt: new Date(),
        appliedState: {
          ...((action.appliedState as Record<string, unknown>) ?? {}),
          rollbackError: result.error.message,
          rollbackCompletedSteps: result.results
            .filter((r) => r.success)
            .map((r) => ({
              method: r.step.method,
              url: r.step.url,
              purpose: r.step.purpose,
            })),
          rollbackFailedStep: {
            method: result.error.step.method,
            url: result.error.step.url,
            purpose: result.error.step.purpose,
            error: result.error.message,
          },
        },
      },
    });

    return {
      status: 'rollback_failed' as const,
      connectionId: action.connectionId,
      remediationKey: action.remediationKey,
      resourceId: action.resourceId,
      error: result.error.message,
      ...(permError.isPermissionError
        ? {
            missingPermissions: permError.missingActions,
            permissionFixScript: permError.fixScript,
          }
        : {}),
    };
  }

  await db.remediationAction.update({
    where: { id: action.id },
    data: {
      status: 'rolled_back',
      rolledBackAt: new Date(),
    },
  });

  return {
    status: 'rolled_back' as const,
    connectionId: action.connectionId,
    remediationKey: action.remediationKey,
    resourceId: action.resourceId,
  };
}
