import {
  executeGcpPlanSteps,
  validateGcpPlanSteps,
} from './gcp-command-executor';

const STORAGE_PATCH = {
  method: 'PATCH' as const,
  url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
  body: { iamConfiguration: {} },
  purpose: 'fix',
};

describe('validateGcpPlanSteps allowlist enforcement', () => {
  it('passes allowlisted fix steps without enforcement (reads path)', () => {
    expect(validateGcpPlanSteps([STORAGE_PATCH])).toEqual([]);
  });

  it('accepts class-scoped writes when enforced', () => {
    expect(
      validateGcpPlanSteps([STORAGE_PATCH], {
        assetClass: 'Storage',
        enforceAllowlist: true,
      }),
    ).toEqual([]);
  });

  it('refuses cross-class writes when enforced', () => {
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'PATCH',
          url: 'https://compute.googleapis.com/compute/v1/projects/p/zones/z/instances/i',
          body: { a: 1 },
          purpose: 'fix',
        },
      ],
      { assetClass: 'Storage', enforceAllowlist: true },
    );
    expect(errors.join(' ')).toMatch(/not allowlisted for Storage/);
  });

  it('refuses never-allow permissions in step bodies', () => {
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'POST',
          url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:setIamPolicy',
          body: {
            policy: {},
            permission: 'resourcemanager.projects.setIamPolicy',
          },
          purpose: 'fix',
        },
      ],
      { assetClass: 'Security-Global', enforceAllowlist: true },
    );
    expect(errors.join(' ')).toMatch(/never allowed/);
  });

  it('allows prefix-scoped DELETE only on the rollback path', () => {
    const step = {
      method: 'DELETE' as const,
      url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls/f',
      purpose: 'rollback',
    };
    expect(
      validateGcpPlanSteps([step], {
        assetClass: 'Network',
        enforceAllowlist: true,
        isRollback: true,
      }),
    ).toEqual([]);
    expect(
      validateGcpPlanSteps([step], {
        assetClass: 'Network',
        enforceAllowlist: true,
      }),
    ).not.toEqual([]);
  });

  it('refuses rollback DELETEs outside the class API prefixes', () => {
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'DELETE',
          url: 'https://iam.googleapis.com/v1/projects/p/serviceAccounts/s',
          purpose: 'rollback',
        },
      ],
      { assetClass: 'Network', enforceAllowlist: true, isRollback: true },
    );
    expect(errors.join(' ')).toMatch(/not allowlisted for Network/);
  });

  it('refuses mismatched rollback length before executing anything', async () => {
    // The auto-rollback loop compensates by position, so a shorter or
    // longer rollback array would compensate the wrong steps.
    const result = await executeGcpPlanSteps({
      steps: [STORAGE_PATCH, STORAGE_PATCH],
      accessToken: 'token',
      autoRollbackSteps: [
        {
          method: 'DELETE',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
          purpose: 'rollback',
        },
      ],
    });
    expect(result.results).toEqual([]);
    expect(result.error?.message).toMatch(/Rollback mismatch/);
  });

  it('refuses non-allowlisted auto-rollback steps before executing anything', async () => {
    const result = await executeGcpPlanSteps({
      steps: [STORAGE_PATCH],
      accessToken: 'token',
      autoRollbackSteps: [
        {
          method: 'DELETE',
          url: 'https://iam.googleapis.com/v1/projects/p/serviceAccounts/s',
          purpose: 'rollback',
        },
      ],
      assetClass: 'Storage',
      enforceAllowlist: true,
    });
    expect(result.results).toEqual([]);
    expect(result.error?.message).toMatch(/not allowlisted for Storage/);
  });
});
