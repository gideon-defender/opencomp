import {
  validatedAzureRollbackSteps,
  validateAzureRollbackSteps,
} from './azure-remediation-rollback-validators';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const STORAGE_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01`;
const VAULT_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.KeyVault/vaults/v?api-version=2023-07-01`;

function storagePatch() {
  return {
    method: 'PATCH' as const,
    url: STORAGE_URL,
    body: { properties: { supportsHttpsTrafficOnly: true } },
    purpose: 'fix',
  };
}

describe('validateAzureRollbackSteps', () => {
  it('accepts empty rollback (model-declared irreversible)', () => {
    expect(validateAzureRollbackSteps({ rollbackSteps: [] })).toEqual([]);
  });

  it('accepts a sound Storage rollback', () => {
    expect(
      validateAzureRollbackSteps({
        rollbackSteps: [
          {
            method: 'PATCH',
            url: STORAGE_URL,
            body: { properties: { supportsHttpsTrafficOnly: true } },
            purpose: 'undo',
          },
        ],
        fixSteps: [storagePatch()],
        previousState: { fix: { properties: {} } },
        expectedSubscriptionId: SUB,
        assetClass: 'Storage',
      }),
    ).toEqual([]);
  });

  it('refuses rollback outside the allowlist', () => {
    const errors = validateAzureRollbackSteps({
      rollbackSteps: [
        {
          method: 'PATCH',
          url: VAULT_URL,
          body: { properties: { enableSoftDelete: true } },
          purpose: 'undo',
        },
      ],
      fixSteps: [storagePatch()],
      previousState: { fix: {} },
      expectedSubscriptionId: SUB,
      assetClass: 'Storage',
    });
    expect(errors.join(' ')).toMatch(/allowlisted/);
  });

  it('refuses restores with no captured original', () => {
    const errors = validateAzureRollbackSteps({
      rollbackSteps: [
        {
          method: 'PATCH',
          url: STORAGE_URL,
          body: { properties: { supportsHttpsTrafficOnly: true } },
          purpose: 'undo',
        },
      ],
      fixSteps: [storagePatch()],
      expectedSubscriptionId: SUB,
      assetClass: 'Storage',
    });
    expect(errors.join(' ')).toMatch(/no captured original/);
  });

  it('refuses rollback targets the fix never touched', () => {
    const errors = validateAzureRollbackSteps({
      rollbackSteps: [
        {
          method: 'PATCH',
          url:
            `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
            `/providers/Microsoft.Storage/storageAccounts/other?api-version=2023-05-01`,
          body: { properties: { supportsHttpsTrafficOnly: false } },
          purpose: 'undo',
        },
      ],
      fixSteps: [storagePatch()],
      previousState: { fix: {} },
      expectedSubscriptionId: SUB,
      assetClass: 'Storage',
    });
    expect(errors.join(' ')).toMatch(/never fixed by this plan/);
  });

  it('refuses rollback without fix steps to prove overlap', () => {
    const errors = validateAzureRollbackSteps({
      rollbackSteps: [storagePatch()],
      previousState: { fix: {} },
      expectedSubscriptionId: SUB,
      assetClass: 'Storage',
    });
    expect(errors.join(' ')).toMatch(/without fix steps/);
  });

  it('refuses sibling-prefix overlap: sa2 is not sa', () => {
    const sibling = {
      method: 'PATCH' as const,
      url: STORAGE_URL.replace('/storageAccounts/sa?', '/storageAccounts/sa2?'),
      body: { properties: { supportsHttpsTrafficOnly: true } },
      purpose: 'undo',
    };
    const errors = validateAzureRollbackSteps({
      rollbackSteps: [sibling],
      fixSteps: [storagePatch()],
      previousState: { fix: {} },
      expectedSubscriptionId: SUB,
      assetClass: 'Storage',
    });
    expect(errors.join(' ')).toMatch(/never fixed by this plan/);
  });

  it('refuses parent-scope rollback the fix never wrote', () => {
    const ruleUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      `/providers/Microsoft.Network/networkSecurityGroups/nsg/securityRules/r?api-version=2023-11-01`;
    const parentUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      `/providers/Microsoft.Network/networkSecurityGroups/nsg?api-version=2023-11-01`;
    const ruleFix = {
      method: 'PUT' as const,
      url: ruleUrl,
      body: { properties: {} },
      purpose: 'fix',
    };
    const parentRollback = {
      method: 'PUT' as const,
      url: parentUrl,
      body: { properties: {} },
      purpose: 'undo',
    };
    const errors = validateAzureRollbackSteps({
      rollbackSteps: [parentRollback],
      fixSteps: [ruleFix],
      previousState: { fix: {} },
      expectedSubscriptionId: SUB,
      assetClass: 'Network',
    });
    expect(errors.join(' ')).toMatch(/never fixed by this plan/);
  });

  it('refuses DELETE rollback for a resource the fix only modified', () => {
    const errors = validateAzureRollbackSteps({
      rollbackSteps: [
        {
          method: 'DELETE' as const,
          url: STORAGE_URL,
          purpose: 'undo',
        },
      ],
      fixSteps: [storagePatch()],
      previousState: { fix: {} },
      expectedSubscriptionId: SUB,
      assetClass: 'Storage',
    });
    expect(errors.join(' ')).toMatch(/did not create/);
  });

  it('refuses DELETE rollback of a child the fix never created', () => {
    // A parent PUT proves the parent was replaced — not that the child
    // below it was created. Deleting the child destroys pre-existing state.
    const parentPut = {
      method: 'PUT' as const,
      url: STORAGE_URL,
      body: { properties: { supportsHttpsTrafficOnly: true } },
      purpose: 'fix',
    };
    const childUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      '/providers/Microsoft.Storage/storageAccounts/sa/blobServices/default/containers/c1?api-version=2023-05-01';
    const errors = validateAzureRollbackSteps({
      rollbackSteps: [
        { method: 'DELETE' as const, url: childUrl, purpose: 'undo' },
      ],
      fixSteps: [parentPut],
      previousState: { fix: {} },
      expectedSubscriptionId: SUB,
      assetClass: 'Storage',
    });
    expect(errors.join(' ')).toMatch(/did not create/);
  });

  it('allows DELETE rollback for a resource the fix created via PUT', () => {
    const putFix = {
      method: 'PUT' as const,
      url: STORAGE_URL,
      body: { properties: { supportsHttpsTrafficOnly: true } },
      purpose: 'fix',
    };
    expect(
      validateAzureRollbackSteps({
        rollbackSteps: [
          { method: 'DELETE' as const, url: STORAGE_URL, purpose: 'undo' },
        ],
        fixSteps: [putFix],
        previousState: { fix: {} },
        expectedSubscriptionId: SUB,
        assetClass: 'Storage',
      }),
    ).toEqual([]);
  });

  it('runs value guards on rollback bodies', () => {
    const errors = validateAzureRollbackSteps({
      rollbackSteps: [
        {
          method: 'PATCH',
          url: STORAGE_URL,
          body: { properties: { allowBlobPublicAccess: true } },
          purpose: 'undo',
        },
      ],
      fixSteps: [storagePatch()],
      previousState: { fix: {} },
      expectedSubscriptionId: SUB,
      assetClass: 'Storage',
    });
    expect(errors.join(' ')).toMatch(/widens access/);
  });

  it('pins firewall rollbacks to the finding resource group', () => {
    // SQL firewall-rule URLs ride the Data allowlist AND the firewall
    // scope guard, so they prove the resource-group pin end to end.
    const fwRule = (rg: string) => ({
      method: 'PUT' as const,
      url:
        `https://management.azure.com/subscriptions/${SUB}/resourceGroups/${rg}` +
        `/providers/Microsoft.Sql/servers/srv/firewallRules/allow?api-version=2023-08-01-preview`,
      body: { properties: {} },
      purpose: 'undo' as string,
    });
    const fix = { ...fwRule('rg'), purpose: 'fix' };
    expect(
      validateAzureRollbackSteps({
        rollbackSteps: [fwRule('other')],
        fixSteps: [fix],
        previousState: { fix: {} },
        expectedSubscriptionId: SUB,
        findingResourceGroup: 'rg',
        assetClass: 'Data',
      }).join(' '),
    ).toMatch(/outside the finding/);
    expect(
      validateAzureRollbackSteps({
        rollbackSteps: [fwRule('rg')],
        fixSteps: [fix],
        previousState: { fix: {} },
        expectedSubscriptionId: SUB,
        findingResourceGroup: 'rg',
        assetClass: 'Data',
      }),
    ).toEqual([]);
  });
});

describe('validatedAzureRollbackSteps', () => {
  it('passes valid rollback through untouched', () => {
    const rollback = [
      {
        method: 'PATCH' as const,
        url: STORAGE_URL,
        body: { properties: { supportsHttpsTrafficOnly: true } },
        purpose: 'undo',
      },
    ];
    expect(
      validatedAzureRollbackSteps({
        rollbackSteps: rollback,
        fixSteps: [storagePatch()],
        previousState: { fix: {} },
        expectedSubscriptionId: SUB,
        assetClass: 'Storage',
      }),
    ).toEqual({ steps: rollback });
  });

  it('drops invalid rollback with a reason and warns', () => {
    const logger = { warn: jest.fn() };
    const result = validatedAzureRollbackSteps({
      rollbackSteps: [
        {
          method: 'PATCH',
          url: VAULT_URL,
          body: { properties: {} },
          purpose: 'undo',
        },
      ],
      fixSteps: [storagePatch()],
      previousState: { fix: {} },
      expectedSubscriptionId: SUB,
      assetClass: 'Storage',
      logger,
    });
    expect(result.steps).toEqual([]);
    expect(result.droppedReason).toMatch(/allowlisted/);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
