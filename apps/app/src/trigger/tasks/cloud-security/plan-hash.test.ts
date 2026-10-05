import { describe, expect, it } from 'vitest';

import { expectedPlanHashParam } from './plan-hash';

describe('expectedPlanHashParam', () => {
  it('forwards the previewed plan hash', () => {
    expect(expectedPlanHashParam({ planHash: 'gcp-abc123' })).toEqual({
      expectedPlanHash: 'gcp-abc123',
    });
  });

  it('omits the param when the preview carries no hash (Azure needs none)', () => {
    expect(expectedPlanHashParam({})).toEqual({});
    expect(expectedPlanHashParam(undefined)).toEqual({});
    expect(expectedPlanHashParam(null)).toEqual({});
  });
});
