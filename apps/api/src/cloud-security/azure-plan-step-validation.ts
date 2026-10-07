import {
  azureRollbackDeletePrefixAllowed,
  isAzureAllowlistedFixStep,
  type AzureRemediationAssetClass,
} from '@gideon-defender/integration-platform';
import type { AzureApiStep } from './azure-ai-remediation.prompt';
import { validateAzurePlanSteps } from './azure-command-executor';
import { validateAzureWriteStepParams } from './azure-remediation-param-guardrails';
import {
  buildEffectiveAzureStepUrl,
  extractAzureResourceGroup,
  extractAzureStepSubscriptionId,
} from './azure-remediation-step-url';

/** Built-in role IDs that must never appear in a fix-step body. GUID
 * matching (not name matching) avoids `owner`-substring false positives
 * on harmless properties. */
const AZURE_NEVER_ALLOW_ROLE_IDS = new Set([
  '8e3af657-a8ff-443c-a75c-2fe8c4bcb635', // Owner
  'b24988ac-6180-42a0-ab88-20f7382dd24c', // Contributor
  '18d7d88d-d35e-4fb5-a5c3-7773c20a72d9', // User Access Administrator
]);

export interface AzureGuardedValidationOptions {
  assetClass?: AzureRemediationAssetClass;
  enforceAllowlist?: boolean;
  isRollback?: boolean;
  isRead?: boolean;
  expectedSubscriptionId?: string;
  findingResourceGroup?: string;
}

/**
 * Allowlist-first plan-step validation (Azure Phase B).
 *
 * Layers over the executor's denylist (`validateAzurePlanSteps`, which
 * stays as runtime defense-in-depth): with `enforceAllowlist`, every
 * write must hit the class's fix-forward URL allowlist for the finding's
 * subscription, carry a body, survive the never-allow body scan, and pass
 * the dual-use parameter guardrails. Reads must be GET. Anything else
 * fails closed. Returns refusal strings; empty means the steps may run.
 */
export function validateAzureGuardedPlanSteps(
  steps: AzureApiStep[],
  opts: AzureGuardedValidationOptions = {},
): string[] {
  const errors: string[] = [];
  const effective = steps.map((step) => ({
    ...step,
    url: buildEffectiveAzureStepUrl(step),
  }));

  // Base hygiene (HTTPS, hosts, role-assignment/definition writes,
  // subscription deletes) runs on the effective URLs.
  errors.push(...validateAzurePlanSteps(effective));

  for (let i = 0; i < effective.length; i++) {
    const step = effective[i];
    if (!step) continue;

    if (opts.isRead) {
      if (step.method !== 'GET') {
        errors.push(`Step ${i + 1}: read steps must use GET`);
      }
      if (opts.expectedSubscriptionId) {
        const readSub = extractAzureStepSubscriptionId(step.url);
        if (
          readSub &&
          readSub.toLowerCase() !== opts.expectedSubscriptionId.toLowerCase()
        ) {
          errors.push(
            `Step ${i + 1}: read targets subscription "${readSub}" outside the finding's subscription`,
          );
        }
        if (!readSub && isAzureManagementRead(step.url)) {
          // A management-plane read with no subscription scope skips the
          // pin above: tenant-level enumeration must not run on the user
          // token. Graph reads stay allowed (documented fan-out for
          // discovery); only ARM reads need a subscription.
          errors.push(
            `Step ${i + 1}: read has no subscription scope for the finding's subscription`,
          );
        }
      }
      continue;
    }

    if (!opts.enforceAllowlist) continue;
    if (!opts.assetClass) {
      errors.push(`Step ${i + 1}: allowlist enforcement needs an asset class`);
      continue;
    }

    // The allowlist strips the `/subscriptions/{id}` scope head before it
    // matches, so without a subscription pin a step for any subscription
    // reads identical to a step for the finding's subscription. Refuse
    // unscoped enforcement instead of validating against shape alone.
    if (!opts.expectedSubscriptionId) {
      errors.push(
        `Step ${i + 1}: allowlist enforcement needs a subscription scope`,
      );
      continue;
    }

    {
      const stepSub = extractAzureStepSubscriptionId(step.url);
      if (!stepSub) {
        errors.push(
          `Step ${i + 1}: write has no subscription scope for the finding's subscription`,
        );
        continue;
      }
      if (stepSub.toLowerCase() !== opts.expectedSubscriptionId.toLowerCase()) {
        errors.push(
          `Step ${i + 1}: write targets subscription "${stepSub}" outside the finding's subscription`,
        );
        continue;
      }
    }

    if (opts.findingResourceGroup) {
      // The allowlist strips the resource group before it matches, so a
      // step in another group of the same subscription looks identical to
      // a step in the finding's group. Pin the group for every class, not
      // just firewall rules — without this, a plan "fixes" a same-named
      // resource in the wrong group.
      const stepRg = extractAzureResourceGroup(step.url);
      if (!stepRg) {
        errors.push(
          `Step ${i + 1}: write has no resource-group scope for the finding's resource group`,
        );
        continue;
      }
      if (stepRg.toLowerCase() !== opts.findingResourceGroup.toLowerCase()) {
        errors.push(
          `Step ${i + 1}: write targets resource group "${stepRg}" outside the finding's resource group`,
        );
        continue;
      }
    }

    if (step.method === 'DELETE') {
      if (!opts.isRollback) {
        errors.push(`Step ${i + 1}: DELETE only allowed during rollback`);
        continue;
      }
      if (
        !azureRollbackDeletePrefixAllowed({
          assetClass: opts.assetClass,
          url: step.url,
        })
      ) {
        errors.push(
          `Step ${i + 1}: rollback DELETE outside the ${opts.assetClass} fix-forward surface`,
        );
      }
      continue;
    }

    if (
      !isAzureAllowlistedFixStep({
        assetClass: opts.assetClass,
        method: step.method,
        url: step.url,
      })
    ) {
      errors.push(
        `Step ${i + 1}: ${step.method} is not an allowlisted ${opts.assetClass} fix call for this URL`,
      );
      continue;
    }

    if (
      (step.method === 'PUT' ||
        step.method === 'PATCH' ||
        step.method === 'POST') &&
      (!step.body || Object.keys(step.body).length === 0)
    ) {
      errors.push(`Step ${i + 1}: ${step.method} writes need a body`);
      continue;
    }

    if (step.body && azureBodyCarriesNeverAllowGrant(step.body)) {
      errors.push(
        `Step ${i + 1}: body carries a never-allow grant (built-in privileged role or role-assignment write)`,
      );
      continue;
    }

    errors.push(
      ...validateAzureWriteStepParams(
        { method: step.method, url: step.url, body: step.body },
        {
          index: i + 1,
          ...(opts.isRollback ? { isRollback: true as const } : {}),
          ...(opts.expectedSubscriptionId
            ? {
                findingScope: {
                  subscriptionId: opts.expectedSubscriptionId,
                  ...(opts.findingResourceGroup
                    ? { resourceGroup: opts.findingResourceGroup }
                    : {}),
                },
              }
            : {}),
        },
      ),
    );
  }
  return errors;
}

/**
 * Narrow an untyped JSON value (e.g. a stored Prisma Json field) to plan
 * steps, or return undefined when it is not one. Anything unexpected
 * reads as absent — overlap and validation then fail closed instead of
 * running attacker-shaped data.
 */
const AZURE_STEP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export function narrowToAzureApiSteps(
  value: unknown,
): AzureApiStep[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: AzureApiStep[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.method !== 'string' ||
      !AZURE_STEP_METHODS.has(record.method)
    ) {
      return undefined;
    }
    if (typeof record.url !== 'string' || !record.url) return undefined;
    const body =
      record.body !== null &&
      typeof record.body === 'object' &&
      !Array.isArray(record.body)
        ? (record.body as Record<string, unknown>)
        : undefined;
    let queryParams: Record<string, string> | undefined;
    if (
      record.queryParams !== null &&
      typeof record.queryParams === 'object' &&
      !Array.isArray(record.queryParams)
    ) {
      const params: Record<string, string> = {};
      for (const [key, param] of Object.entries(
        record.queryParams as Record<string, unknown>,
      )) {
        if (typeof param !== 'string') return undefined;
        params[key] = param;
      }
      queryParams = params;
    }
    out.push({
      method: record.method as AzureApiStep['method'],
      url: record.url,
      ...(body ? { body } : {}),
      ...(queryParams ? { queryParams } : {}),
      purpose: typeof record.purpose === 'string' ? record.purpose : '',
    });
  }
  return out;
}

/** True when a step URL addresses the ARM management plane: unparseable
 * URLs read as management-plane (fail closed — the allowlist rejects them
 * next) while Graph and other hosts stay reads the pin does not cover. */
function isAzureManagementRead(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return hostname === '' || hostname === 'management.azure.com';
}

/** True when a step body smuggles a privileged grant past the URL checks:
 * a built-in never-allow role ID (e.g. Owner baked into a roleAssignment
 * PUT body) or an embedded role-assignment write. */
function azureBodyCarriesNeverAllowGrant(body: unknown): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(body).toLowerCase();
  } catch {
    return true;
  }
  if (serialized.includes('microsoft.authorization/roleassignments')) {
    return true;
  }
  for (const roleId of AZURE_NEVER_ALLOW_ROLE_IDS) {
    if (serialized.includes(roleId)) return true;
  }
  return false;
}
