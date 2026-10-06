import type { Logger } from '@nestjs/common';
import {
  normalizeAzureUrlForAllowlist,
  type AzureRemediationAssetClass,
} from '@gideon-defender/integration-platform';
import type { AzureApiStep } from './azure-ai-remediation.prompt';
import { validateAzureGuardedPlanSteps } from './azure-plan-step-validation';

export interface AzureRollbackValidationArgs {
  rollbackSteps?: AzureApiStep[];
  fixSteps?: AzureApiStep[];
  previousState?: Record<string, unknown>;
  expectedSubscriptionId?: string;
  findingResourceGroup?: string;
  assetClass?: AzureRemediationAssetClass;
}

/**
 * Rollback-step validation (Azure Phase B).
 *
 * Allowlist-first: every rollback write must sit inside the class's
 * fix-forward surface for the finding's subscription, with DELETE
 * prefix-scoped. Shape second: PATCH/PUT rollbacks need a body and
 * captured prior state (a rollback with no recorded original is a guess,
 * not a restore), and every rollback target must equal a fixed resource
 * or sit strictly below one (segment-boundary match — a sibling whose
 * name extends the fixed one, or a parent scope the fix never wrote, is
 * not overlap). DELETE additionally needs a PUT fix target at the same
 * path: deleting a resource the fix only modified — or a child below a
 * resource the fix replaced — destroys it instead of restoring it.
 * Returns refusal strings; empty means the
 * rollback is sound. Empty input yields no findings (a model-declared
 * irreversible plan carries no safety net by design).
 */
export function validateAzureRollbackSteps(
  args: AzureRollbackValidationArgs = {},
): string[] {
  const rollbackSteps = args.rollbackSteps ?? [];
  if (rollbackSteps.length === 0) return [];
  const errors: string[] = [];

  errors.push(
    ...validateAzureGuardedPlanSteps(rollbackSteps, {
      ...(args.assetClass ? { assetClass: args.assetClass } : {}),
      enforceAllowlist: true,
      isRollback: true,
      ...(args.expectedSubscriptionId
        ? { expectedSubscriptionId: args.expectedSubscriptionId }
        : {}),
      // Rollbacks pin the resource group exactly like fix steps: without
      // this, a firewall-rule rollback to another resource group passes
      // allowlist + subscription + overlap and executes.
      ...(args.findingResourceGroup
        ? { findingResourceGroup: args.findingResourceGroup }
        : {}),
    }),
  );

  const stateCaptured =
    !!args.previousState && Object.keys(args.previousState).length > 0;
  for (let i = 0; i < rollbackSteps.length; i++) {
    const step = rollbackSteps[i];
    if (!step) continue;
    if ((step.method === 'PUT' || step.method === 'PATCH') && !stateCaptured) {
      errors.push(
        `Rollback step ${i}: restores state with no captured original — refusing a guessed restore`,
      );
    }
  }

  const fixEntries = (args.fixSteps ?? [])
    .map((step) => {
      const path = normalizeAzureUrlForAllowlist(step.url);
      return path ? { path, method: step.method } : undefined;
    })
    .filter(
      (entry): entry is { path: string; method: AzureApiStep['method'] } =>
        !!entry,
    );
  if (fixEntries.length === 0) {
    errors.push('Rollback steps without fix steps cannot prove overlap');
    return errors;
  }
  for (let i = 0; i < rollbackSteps.length; i++) {
    const step = rollbackSteps[i];
    if (!step) continue;
    const rollbackPath = normalizeAzureUrlForAllowlist(step.url);
    if (!rollbackPath) continue;
    // Segment-boundary match only: a bare prefix lets a sibling whose
    // name extends the fixed one (nsg10 under nsg1) read as overlap, and
    // the reverse direction lets a rollback aim at a parent scope the fix
    // never wrote. A rollback restores what the fix wrote — the same
    // resource or something strictly below it.
    const overlapping = fixEntries.filter(
      (fix) =>
        rollbackPath === fix.path || rollbackPath.startsWith(`${fix.path}/`),
    );
    if (overlapping.length === 0) {
      errors.push(
        `Rollback step ${i}: target was never fixed by this plan — refusing an unscoped restore`,
      );
      continue;
    }
    // DELETE inverts creation, not modification — and only of the same
    // resource: a PUT fix target carries a DELETE inverse for its own
    // path, never for a child below it. A parent PUT never proves the
    // child was created, so deleting a pre-existing child destroys
    // instead of restoring.
    if (step.method === 'DELETE') {
      const deletesCreatedResource = overlapping.some(
        (fix) => fix.method === 'PUT' && fix.path === rollbackPath,
      );
      if (!deletesCreatedResource) {
        errors.push(
          `Rollback step ${i}: DELETE removes a resource the fix did not create at this path — refusing to delete instead of restore`,
        );
      }
    }
  }
  return errors;
}

/**
 * Drop invalid rollbacks with a surfaced reason instead of running a
 * broken safety net. Valid input passes through untouched.
 */
export function validatedAzureRollbackSteps(args: {
  rollbackSteps: AzureApiStep[];
  fixSteps?: AzureApiStep[];
  previousState?: Record<string, unknown>;
  expectedSubscriptionId?: string;
  findingResourceGroup?: string;
  assetClass?: AzureRemediationAssetClass;
  logger?: Pick<Logger, 'warn'>;
}): { steps: AzureApiStep[]; droppedReason?: string } {
  const errors = validateAzureRollbackSteps({
    rollbackSteps: args.rollbackSteps,
    ...(args.fixSteps ? { fixSteps: args.fixSteps } : {}),
    ...(args.previousState ? { previousState: args.previousState } : {}),
    ...(args.expectedSubscriptionId
      ? { expectedSubscriptionId: args.expectedSubscriptionId }
      : {}),
    ...(args.findingResourceGroup
      ? { findingResourceGroup: args.findingResourceGroup }
      : {}),
    ...(args.assetClass ? { assetClass: args.assetClass } : {}),
  });
  if (errors.length === 0) return { steps: args.rollbackSteps };
  args.logger?.warn(
    `Dropping ${args.rollbackSteps.length} Azure rollback steps: ${errors.join('; ')}`,
  );
  return { steps: [], droppedReason: errors.join('; ') };
}
