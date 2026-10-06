import { validateAzureGuardedPlanSteps } from './azure-plan-step-validation';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const STORAGE_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01`;
const VAULT_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.KeyVault/vaults/v?api-version=2023-07-01`;

function storagePatch(body: Record<string, unknown> = {}) {
  return {
    method: 'PATCH' as const,
    url: STORAGE_URL,
    body: { properties: { supportsHttpsTrafficOnly: true, ...body } },
    purpose: 'fix',
  };
}

describe('validateAzureGuardedPlanSteps', () => {
  it('passes an allowlisted Storage write in scope', () => {
    expect(
      validateAzureGuardedPlanSteps([storagePatch()], {
        assetClass: 'Storage',
        enforceAllowlist: true,
        expectedSubscriptionId: SUB,
      }),
    ).toEqual([]);
  });

  it('surfaces base denylist errors', () => {
    const errors = validateAzureGuardedPlanSteps(
      [{ method: 'GET', url: 'http://evil.example.com/x', purpose: 'r' }],
      { assetClass: 'Storage', enforceAllowlist: true },
    );
    expect(errors.join(' ')).toMatch(/HTTPS/);
  });

  it('fails closed when enforcement lacks an asset class', () => {
    expect(
      validateAzureGuardedPlanSteps([storagePatch()], {
        enforceAllowlist: true,
      }).join(' '),
    ).toMatch(/needs an asset class/);
  });

  it('fails closed when enforcement lacks a subscription scope', () => {
    // The allowlist strips the scope head before matching, so shape alone
    // cannot bind a step to the finding's subscription.
    expect(
      validateAzureGuardedPlanSteps([storagePatch()], {
        assetClass: 'Storage',
        enforceAllowlist: true,
      }).join(' '),
    ).toMatch(/needs a subscription scope/);
  });

  it('refuses writes outside the finding subscription', () => {
    const other = STORAGE_URL.replace(
      SUB,
      '99999999-9999-9999-9999-999999999999',
    );
    const errors = validateAzureGuardedPlanSteps(
      [{ ...storagePatch(), url: other }],
      {
        assetClass: 'Storage',
        enforceAllowlist: true,
        expectedSubscriptionId: SUB,
      },
    );
    expect(errors.join(' ')).toMatch(/outside the finding's subscription/);
  });

  it('refuses writes with no subscription scope', () => {
    const errors = validateAzureGuardedPlanSteps(
      [
        {
          method: 'PATCH',
          url: 'https://management.azure.com/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01',
          body: { properties: {} },
          purpose: 'fix',
        },
      ],
      {
        assetClass: 'Storage',
        enforceAllowlist: true,
        expectedSubscriptionId: SUB,
      },
    );
    expect(errors.join(' ')).toMatch(/no subscription scope/);
  });

  it('refuses non-allowlisted fix calls', () => {
    const errors = validateAzureGuardedPlanSteps(
      [
        {
          method: 'PATCH',
          url: VAULT_URL,
          body: { properties: { enableSoftDelete: true } },
          purpose: 'vault fix',
        },
      ],
      {
        assetClass: 'Storage',
        enforceAllowlist: true,
        expectedSubscriptionId: SUB,
      },
    );
    expect(errors.join(' ')).toMatch(/not an allowlisted Storage fix call/);
  });

  it('refuses bodyless writes', () => {
    const errors = validateAzureGuardedPlanSteps(
      [{ method: 'PUT', url: STORAGE_URL, purpose: 'fix' }],
      {
        assetClass: 'Storage',
        enforceAllowlist: true,
        expectedSubscriptionId: SUB,
      },
    );
    expect(errors.join(' ')).toMatch(/need a body/);
  });

  it('refuses DELETE outside rollback and scopes rollback DELETE', () => {
    const nsgDelete = {
      method: 'DELETE' as const,
      url:
        `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
        `/providers/Microsoft.Network/networkSecurityGroups/nsg/securityRules/r?api-version=2023-11-01`,
      purpose: 'drop rule',
    };
    expect(
      validateAzureGuardedPlanSteps([nsgDelete], {
        assetClass: 'Network',
        enforceAllowlist: true,
        expectedSubscriptionId: SUB,
      }).join(' '),
    ).toMatch(/only allowed during rollback/);
    expect(
      validateAzureGuardedPlanSteps([nsgDelete], {
        assetClass: 'Network',
        enforceAllowlist: true,
        isRollback: true,
        expectedSubscriptionId: SUB,
      }),
    ).toEqual([]);
    expect(
      validateAzureGuardedPlanSteps([{ ...nsgDelete, url: STORAGE_URL }], {
        assetClass: 'Network',
        enforceAllowlist: true,
        isRollback: true,
        expectedSubscriptionId: SUB,
      }).join(' '),
    ).toMatch(/outside the Network fix-forward surface/);
  });

  it('refuses bodies carrying built-in privileged role IDs', () => {
    const errors = validateAzureGuardedPlanSteps(
      [
        {
          method: 'PUT',
          url:
            `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
            `/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01`,
          body: {
            properties: {
              roleDefinitionId:
                '/providers/Microsoft.Authorization/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635',
            },
          },
          purpose: 'fix',
        },
      ],
      {
        assetClass: 'Storage',
        enforceAllowlist: true,
        expectedSubscriptionId: SUB,
      },
    );
    expect(errors.join(' ')).toMatch(/never-allow grant/);
  });

  it('reads must be GET and skip the allowlist', () => {
    const graphRead = {
      method: 'GET' as const,
      url: 'https://graph.microsoft.com/v1.0/users/x',
      purpose: 'read',
    };
    expect(
      validateAzureGuardedPlanSteps([graphRead], {
        assetClass: 'Storage',
        enforceAllowlist: true,
        isRead: true,
      }),
    ).toEqual([]);
    expect(
      validateAzureGuardedPlanSteps(
        [{ ...graphRead, method: 'PATCH' as const }],
        {
          assetClass: 'Storage',
          enforceAllowlist: true,
          isRead: true,
        },
      ).join(' '),
    ).toMatch(/read steps must use GET/);
  });

  it('pins reads to the finding subscription', () => {
    const otherSubRead = {
      method: 'GET' as const,
      url:
        `https://management.azure.com/subscriptions/99999999-9999-9999-9999-999999999999` +
        `/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01`,
      purpose: 'read',
    };
    expect(
      validateAzureGuardedPlanSteps([otherSubRead], {
        assetClass: 'Storage',
        enforceAllowlist: true,
        isRead: true,
        expectedSubscriptionId: SUB,
      }).join(' '),
    ).toMatch(/outside the finding's subscription/);
    // An encoded scope key resolves on the wire, so it must pin too —
    // never sail through as a scopeless read.
    const encodedSubRead = {
      ...otherSubRead,
      url: otherSubRead.url.replace('subscriptions', '%73ubscriptions'),
    };
    expect(
      validateAzureGuardedPlanSteps([encodedSubRead], {
        assetClass: 'Storage',
        enforceAllowlist: true,
        isRead: true,
        expectedSubscriptionId: SUB,
      }).join(' '),
    ).toMatch(/outside the finding's subscription/);
  });

  it('refuses every never-allow grant shape, not just Owner', () => {
    const grantBody = (roleDefinitionId: string) => ({
      method: 'PUT' as const,
      url: STORAGE_URL,
      body: { properties: { roleDefinitionId } },
      purpose: 'fix',
    });
    const opts = {
      assetClass: 'Storage' as const,
      enforceAllowlist: true,
      expectedSubscriptionId: SUB,
    };
    // Contributor and User Access Administrator grant the same power.
    for (const id of [
      'b24988ac-6180-42a0-ab88-20f7382dd24c',
      '18d7d88d-d35e-4fb5-a5c3-7773c20a72d9',
    ]) {
      expect(
        validateAzureGuardedPlanSteps([grantBody(id)], opts).join(' '),
      ).toMatch(/never-allow grant/);
    }
    // An embedded role-assignment write smuggled in the body.
    expect(
      validateAzureGuardedPlanSteps(
        [
          {
            method: 'PUT' as const,
            url: STORAGE_URL,
            body: {
              properties: {
                ref: '/providers/Microsoft.Authorization/roleAssignments/x',
              },
            },
            purpose: 'fix',
          },
        ],
        opts,
      ).join(' '),
    ).toMatch(/never-allow grant/);
  });
});
