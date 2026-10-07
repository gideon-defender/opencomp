import { validateAzureGuardedPlanSteps } from './azure-plan-step-validation';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const STORAGE_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01`;

function storagePatch(body: Record<string, unknown> = {}) {
  return {
    method: 'PATCH' as const,
    url: STORAGE_URL,
    body: { properties: { supportsHttpsTrafficOnly: true, ...body } },
    purpose: 'fix',
  };
}

describe('validateAzureGuardedPlanSteps scope pinning', () => {
  it('pins writes to the finding resource group for every class', () => {
    const otherRgUrl = STORAGE_URL.replace(
      '/resourceGroups/rg/',
      '/resourceGroups/other/',
    );
    const opts = {
      assetClass: 'Storage' as const,
      enforceAllowlist: true,
      expectedSubscriptionId: SUB,
      findingResourceGroup: 'rg',
    };
    // Same provider path in another group of the same subscription refuses.
    expect(
      validateAzureGuardedPlanSteps(
        [{ ...storagePatch(), url: otherRgUrl }],
        opts,
      ).join(' '),
    ).toMatch(/outside the finding's resource group/);
    // A subscription-level write with no group scope refuses instead of
    // passing silently.
    expect(
      validateAzureGuardedPlanSteps(
        [
          {
            method: 'PATCH' as const,
            url: `https://management.azure.com/subscriptions/${SUB}/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01`,
            body: { properties: {} },
            purpose: 'fix',
          },
        ],
        opts,
      ).join(' '),
    ).toMatch(/no resource-group scope/);
    // The finding's own group passes.
    expect(validateAzureGuardedPlanSteps([storagePatch()], opts)).toEqual([]);
  });

  it('refuses subscription-scoped ARM reads but keeps Graph reads', () => {
    const tenantRead = {
      method: 'GET' as const,
      url: 'https://management.azure.com/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01',
      purpose: 'read',
    };
    const opts = {
      assetClass: 'Storage' as const,
      enforceAllowlist: true,
      isRead: true,
      expectedSubscriptionId: SUB,
    };
    expect(validateAzureGuardedPlanSteps([tenantRead], opts).join(' ')).toMatch(
      /no subscription scope/,
    );
    // Graph fan-out stays allowed under the pin.
    expect(
      validateAzureGuardedPlanSteps(
        [
          {
            method: 'GET' as const,
            url: 'https://graph.microsoft.com/v1.0/users/x',
            purpose: 'read',
          },
        ],
        opts,
      ),
    ).toEqual([]);
  });

  it('validates the effective URL with merged queryParams', () => {
    const splitStep = {
      method: 'PATCH' as const,
      url:
        `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
        `/providers/Microsoft.Storage/storageAccounts/sa`,
      queryParams: { 'api-version': '2023-05-01' },
      body: { properties: { supportsHttpsTrafficOnly: true } },
      purpose: 'fix',
    };
    expect(
      validateAzureGuardedPlanSteps([splitStep], {
        assetClass: 'Storage',
        enforceAllowlist: true,
        expectedSubscriptionId: SUB,
      }),
    ).toEqual([]);
  });
});
