import type { PlanHashBinding } from './remediation-stable-json';
import type { AzureFixPlan } from './azure-ai-remediation.prompt';

const PLAN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const PLAN_CACHE_MAX = 100;

export interface AzurePlanCacheKey {
  organizationId: string;
  connectionId: string;
  checkResultId: string;
  remediationKey: string;
}

/**
 * Cache key for a previewed plan. Scoped by organization: the cache is
 * shared across orgs, so a key without the org lets one org's preview
 * load in another's context on an ID collision.
 */
export function azurePlanCacheKey(params: AzurePlanCacheKey): string {
  return `${params.organizationId}:${params.connectionId}:${params.checkResultId}:${params.remediationKey}`;
}

/**
 * Finding scope a plan hash binds to: without it, a hash previewed for
 * one finding authorizes a run for another with identical steps.
 */
export function azurePlanBinding(params: AzurePlanCacheKey): PlanHashBinding {
  return {
    organizationId: params.organizationId,
    connectionId: params.connectionId,
    checkResultId: params.checkResultId,
    remediationKey: params.remediationKey,
  };
}

/**
 * A plan is only worth caching/reusing if it can actually be auto-applied.
 * Caching an empty or non-auto-fixable plan makes "Retry" a guaranteed
 * no-op: execute would reload the same dead plan and fail identically.
 */
export function isUsableAzurePlan(plan: AzureFixPlan | undefined): boolean {
  return Boolean(plan?.canAutoFix && plan.fixSteps && plan.fixSteps.length > 0);
}

interface CachedAzurePlan {
  plan: AzureFixPlan;
  timestamp: number;
}

/** In-memory preview-plan cache with TTL expiry and oldest-first eviction. */
export class AzureRemediationPlanCache {
  private readonly plans = new Map<string, CachedAzurePlan>();

  /** Fresh entry, or undefined when missing or stale (stale reads evict). */
  getFresh(key: string): CachedAzurePlan | undefined {
    const entry = this.plans.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp >= PLAN_CACHE_TTL) {
      this.plans.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, plan: AzureFixPlan): void {
    this.evictStalePlans();
    this.plans.set(key, { plan, timestamp: Date.now() });
  }

  delete(key: string): void {
    this.plans.delete(key);
  }

  private evictStalePlans(): void {
    const now = Date.now();
    for (const [key, entry] of this.plans) {
      if (now - entry.timestamp >= PLAN_CACHE_TTL) this.plans.delete(key);
    }
    while (this.plans.size >= PLAN_CACHE_MAX) {
      const firstKey: unknown = this.plans.keys().next().value;
      if (typeof firstKey === 'string' && firstKey) {
        this.plans.delete(firstKey);
      } else {
        break;
      }
    }
  }
}
