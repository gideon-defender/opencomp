import {
  HR_SYNC_IDENTITY_SKIP_REASON,
  shouldSkipHrSync,
} from './hr-sync-identity';

describe('HR sync identity skip logging', () => {
  it('counts and logs a user once if encountered in both import and offboarding passes', () => {
    const results = {
      skipped: 0,
      details: [] as { email: string; status: string; reason?: string }[],
    };
    const logger = { log: jest.fn() };
    const context = {
      identity: null,
      organizationId: 'org_1',
      providerName: 'provider',
      results,
      logger,
    };
    expect(
      shouldSkipHrSync({ ...context, email: 'Employee@example.com' }),
    ).toBe(true);
    expect(
      shouldSkipHrSync({ ...context, email: 'employee@example.com' }),
    ).toBe(true);
    expect(results.skipped).toBe(1);
    expect(results.details).toEqual([
      {
        email: 'employee@example.com',
        status: 'skipped',
        reason: HR_SYNC_IDENTITY_SKIP_REASON,
      },
    ]);
    expect(logger.log).toHaveBeenCalledTimes(1);
  });
});
