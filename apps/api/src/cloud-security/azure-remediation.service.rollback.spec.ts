import { AzureRemediationService } from './azure-remediation.service';
import {
  APP_ID,
  NSG_RESOURCE,
  STORAGE_RESOURCE,
  SUB,
  TENANT,
  boundStorageCredentials,
  credentialVaultService,
  mockDb,
  setupAzureService,
  stubAzureFetch,
  tokenFor,
} from './azure-remediation-service.fixtures';

describe('AzureRemediationService rollback', () => {
  let service: AzureRemediationService;

  beforeEach(() => {
    service = setupAzureService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rollback refuses unbound pairs instead of running on the user token', async () => {
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_1',
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      resourceType: 'azure-storage-account',
      resourceId: STORAGE_RESOURCE,
      appliedState: {
        rollbackSteps: [
          {
            method: 'PUT',
            url: `https://management.azure.com${STORAGE_RESOURCE}?api-version=2023-05-01`,
            purpose: 'undo',
          },
        ],
      },
      connection: { provider: { slug: 'azure' } },
    });
    mockDb.integrationConnection.findFirst.mockResolvedValue({
      id: 'conn_1',
      provider: { slug: 'azure' },
    });
    credentialVaultService.getDecryptedCredentials.mockResolvedValue({
      access_token: 'auditor-token',
      tenantId: TENANT,
    });

    await expect(
      service.rollbackRemediation({
        actionId: 'act_1',
        organizationId: 'org_1',
      }),
    ).rejects.toThrow(/No remediator SP bound/);
  });

  it('rollback refuses approval-gated classes even when bound', async () => {
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_1',
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      resourceType: 'azure-nsg',
      resourceId: NSG_RESOURCE,
      appliedState: {
        rollbackSteps: [
          {
            method: 'PUT',
            url: `https://management.azure.com${NSG_RESOURCE}?api-version=2023-11-01`,
            purpose: 'undo',
          },
        ],
      },
      connection: { provider: { slug: 'azure' } },
    });
    mockDb.integrationConnection.findFirst.mockResolvedValue({
      id: 'conn_1',
      provider: { slug: 'azure' },
    });
    credentialVaultService.getDecryptedCredentials.mockResolvedValue({
      access_token: 'auditor-token',
      tenantId: TENANT,
      azureRemediation: JSON.stringify({ [`Network:${SUB}`]: APP_ID }),
      azureRemediationSecrets: JSON.stringify({
        [`Network:${SUB}`]: 'secret-1',
      }),
    });

    await expect(
      service.rollbackRemediation({
        actionId: 'act_1',
        organizationId: 'org_1',
      }),
    ).rejects.toThrow(/human approval/);
  });

  it('rollback refuses stored steps outside the allowlist', async () => {
    const vaultUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      `/providers/Microsoft.KeyVault/vaults/v?api-version=2023-07-01`;
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_1',
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      resourceType: 'azure-storage-account',
      resourceId: STORAGE_RESOURCE,
      appliedState: {
        rollbackSteps: [
          {
            method: 'PATCH',
            url: vaultUrl,
            body: { properties: { enableSoftDelete: true } },
            purpose: 'undo',
          },
        ],
      },
      connection: { provider: { slug: 'azure' } },
    });
    mockDb.integrationConnection.findFirst.mockResolvedValue({
      id: 'conn_1',
      provider: { slug: 'azure' },
    });
    credentialVaultService.getDecryptedCredentials.mockResolvedValue(
      boundStorageCredentials(),
    );
    stubAzureFetch();

    await expect(
      service.rollbackRemediation({
        actionId: 'act_1',
        organizationId: 'org_1',
      }),
    ).rejects.toThrow(/Stored rollback failed validation/);
  });

  it('rollback executes a valid stored rollback on the SP token', async () => {
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_1',
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      resourceType: 'azure-storage-account',
      resourceId: STORAGE_RESOURCE,
      appliedState: {
        rollbackSteps: [
          {
            method: 'PATCH',
            url: `https://management.azure.com${STORAGE_RESOURCE}?api-version=2023-05-01`,
            body: { properties: { supportsHttpsTrafficOnly: true } },
            purpose: 'undo',
          },
        ],
      },
      connection: { provider: { slug: 'azure' } },
    });
    mockDb.integrationConnection.findFirst.mockResolvedValue({
      id: 'conn_1',
      provider: { slug: 'azure' },
    });
    credentialVaultService.getDecryptedCredentials.mockResolvedValue(
      boundStorageCredentials(),
    );
    stubAzureFetch();

    const result = await service.rollbackRemediation({
      actionId: 'act_1',
      organizationId: 'org_1',
    });

    expect(result.status).toBe('rolled_back');
    // The response carries the ARM resource path, matching the execute
    // and verify responses — not the finding row id.
    expect(result.resourceId).toBe(STORAGE_RESOURCE);
    const fetchMock = global.fetch as jest.Mock;
    const rollbackCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('storageAccounts/sa?'),
    ) as [string, RequestInit];
    expect(rollbackCall).toBeDefined();
    // The rollback write carries the SP token, never the auditor token.
    expect(
      (rollbackCall[1].headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${tokenFor(APP_ID, TENANT)}`);
    expect(mockDb.remediationAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'act_1' },
        data: expect.objectContaining({ status: 'rolled_back' }),
      }),
    );
  });

  it('rollback refuses stored steps with open values', async () => {
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_1',
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      resourceType: 'azure-storage-account',
      resourceId: STORAGE_RESOURCE,
      appliedState: {
        rollbackSteps: [
          {
            method: 'PATCH',
            url: `https://management.azure.com${STORAGE_RESOURCE}?api-version=2023-05-01`,
            body: { properties: { allowBlobPublicAccess: true } },
            purpose: 'undo',
          },
        ],
      },
      connection: { provider: { slug: 'azure' } },
    });
    mockDb.integrationConnection.findFirst.mockResolvedValue({
      id: 'conn_1',
      provider: { slug: 'azure' },
    });
    credentialVaultService.getDecryptedCredentials.mockResolvedValue(
      boundStorageCredentials(),
    );
    stubAzureFetch();

    await expect(
      service.rollbackRemediation({
        actionId: 'act_1',
        organizationId: 'org_1',
      }),
    ).rejects.toThrow(/Stored rollback failed validation/);
  });
});
