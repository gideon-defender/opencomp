import {
  azurePlanBinding,
  azurePlanCacheKey,
  AzureRemediationPlanCache,
  isUsableAzurePlan,
} from './azure-remediation-plan-cache';
import type { AzureFixPlan } from './azure-ai-remediation.prompt';

const KEY = {
  organizationId: 'org_1',
  connectionId: 'conn_1',
  checkResultId: 'chk_1',
  remediationKey: 'k',
};

function usablePlan(): AzureFixPlan {
  return {
    canAutoFix: true,
    risk: 'low',
    description: 'fix',
    currentState: {},
    proposedState: {},
    readSteps: [],
    fixSteps: [
      {
        method: 'PATCH',
        url: 'https://management.azure.com/x',
        purpose: 'fix',
      },
    ],
    rollbackSteps: [],
    rollbackSupported: false,
    requiresAcknowledgment: false,
  };
}

describe('azurePlanCacheKey', () => {
  it('scopes keys by organization', () => {
    // Without the org in the key, one org's preview loads in another's
    // context on an ID collision.
    expect(azurePlanCacheKey(KEY)).toContain('org_1');
    expect(azurePlanCacheKey(KEY)).not.toBe(
      azurePlanCacheKey({ ...KEY, organizationId: 'org_2' }),
    );
  });

  it('binds hashes to the same scope as the key', () => {
    expect(azurePlanBinding(KEY)).toEqual(KEY);
  });
});

describe('isUsableAzurePlan', () => {
  it('rejects missing, dead, and empty plans', () => {
    expect(isUsableAzurePlan(undefined)).toBe(false);
    expect(isUsableAzurePlan({ ...usablePlan(), canAutoFix: false })).toBe(
      false,
    );
    expect(isUsableAzurePlan({ ...usablePlan(), fixSteps: [] })).toBe(false);
  });

  it('accepts an auto-fixable plan with steps', () => {
    expect(isUsableAzurePlan(usablePlan())).toBe(true);
  });
});

describe('AzureRemediationPlanCache', () => {
  it('returns fresh entries and misses unknown keys', () => {
    const cache = new AzureRemediationPlanCache();
    expect(cache.getFresh('missing')).toBeUndefined();
    cache.set('k', usablePlan());
    expect(cache.getFresh('k')?.plan.description).toBe('fix');
  });

  it('evicts stale entries past the TTL', () => {
    jest.useFakeTimers();
    try {
      const cache = new AzureRemediationPlanCache();
      cache.set('k', usablePlan());
      // TTL is 5 minutes: reads before it hit, reads after miss.
      jest.advanceTimersByTime(4 * 60 * 1000);
      expect(cache.getFresh('k')).toBeDefined();
      jest.advanceTimersByTime(60 * 1000);
      expect(cache.getFresh('k')).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('evicts oldest-first at capacity', () => {
    jest.useFakeTimers();
    try {
      const cache = new AzureRemediationPlanCache();
      for (let i = 0; i < 100; i++) {
        cache.set(`k-${i}`, usablePlan());
        jest.advanceTimersByTime(1);
      }
      cache.set('new', usablePlan());
      expect(cache.getFresh('k-0')).toBeUndefined();
      expect(cache.getFresh('new')).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('deletes entries on demand', () => {
    const cache = new AzureRemediationPlanCache();
    cache.set('k', usablePlan());
    cache.delete('k');
    expect(cache.getFresh('k')).toBeUndefined();
  });
});
