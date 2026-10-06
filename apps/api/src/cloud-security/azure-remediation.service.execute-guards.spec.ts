import { AzureRemediationService } from './azure-remediation.service';
import {
  APP_ID,
  NSG_RESOURCE,
  STORAGE_RESOURCE,
  SUB,
  TENANT,
  aiRemediationService,
  boundStorageCredentials,
  checkResultFor,
  connectionWith,
  executeParams,
  hashFor,
  setupAzureService,
  stubAzureFetch,
} from './azure-remediation-service.fixtures';

describe('AzureRemediationService execute guards', () => {
  let service: AzureRemediationService;

  beforeEach(() => {
    service = setupAzureService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('execute refuses unbound pairs instead of running on the user token', async () => {
    connectionWith({ access_token: 'auditor-token', tenantId: TENANT });
    checkResultFor('azure-storage-account', STORAGE_RESOURCE);

    await expect(
      service.executeRemediation({
        connectionId: 'conn_1',
        organizationId: 'org_1',
        checkResultId: 'chk_1',
        remediationKey: 'k',
        userId: 'user_1',
      }),
    ).rejects.toThrow(/No remediator SP bound/);
    expect(aiRemediationService.generateAzureFixPlan).not.toHaveBeenCalled();
  });

  it('execute refuses approval-gated classes even when bound', async () => {
    connectionWith({
      access_token: 'auditor-token',
      tenantId: TENANT,
      azureRemediation: JSON.stringify({ [`Network:${SUB}`]: APP_ID }),
      azureRemediationSecrets: JSON.stringify({
        [`Network:${SUB}`]: 'secret-1',
      }),
    });
    checkResultFor('azure-nsg', NSG_RESOURCE);

    await expect(
      service.executeRemediation({
        connectionId: 'conn_1',
        organizationId: 'org_1',
        checkResultId: 'chk_1',
        remediationKey: 'k',
        userId: 'user_1',
      }),
    ).rejects.toThrow(/human approval/);
  });

  it('execute requires an acknowledgment', async () => {
    connectionWith(boundStorageCredentials());
    checkResultFor('azure-storage-account', STORAGE_RESOURCE);
    stubAzureFetch();
    const fixUrl = `https://management.azure.com${STORAGE_RESOURCE}?api-version=2023-05-01`;
    const fixSteps = [
      {
        method: 'PATCH',
        url: fixUrl,
        body: { properties: { supportsHttpsTrafficOnly: true } },
        purpose: 'fix',
      },
    ];
    aiRemediationService.generateAzureFixPlan.mockResolvedValue({
      canAutoFix: true,
      risk: 'medium',
      description: 'd',
      currentState: {},
      proposedState: {},
      readSteps: [],
      fixSteps,
      rollbackSteps: [],
      rollbackSupported: false,
      requiresAcknowledgment: false,
    });

    await expect(
      service.executeRemediation(
        executeParams({ expectedPlanHash: hashFor(fixSteps) }),
      ),
    ).rejects.toThrow(/Acknowledgment is required/);
  });

  it('execute requires the previewed plan hash', async () => {
    connectionWith(boundStorageCredentials());
    checkResultFor('azure-storage-account', STORAGE_RESOURCE);
    stubAzureFetch();
    const fixUrl = `https://management.azure.com${STORAGE_RESOURCE}?api-version=2023-05-01`;
    aiRemediationService.generateAzureFixPlan.mockResolvedValue({
      canAutoFix: true,
      risk: 'medium',
      description: 'd',
      currentState: {},
      proposedState: {},
      readSteps: [],
      fixSteps: [
        {
          method: 'PATCH',
          url: fixUrl,
          body: { properties: { supportsHttpsTrafficOnly: true } },
          purpose: 'fix',
        },
      ],
      rollbackSteps: [],
      rollbackSupported: false,
      requiresAcknowledgment: false,
    });

    await expect(
      service.executeRemediation(
        executeParams({ acknowledgment: 'acknowledged' }),
      ),
    ).rejects.toThrow(/previewed plan hash/);
  });

  it('execute refuses when the plan changed since preview', async () => {
    connectionWith(boundStorageCredentials());
    checkResultFor('azure-storage-account', STORAGE_RESOURCE);
    stubAzureFetch();
    const fixUrl = `https://management.azure.com${STORAGE_RESOURCE}?api-version=2023-05-01`;
    aiRemediationService.generateAzureFixPlan.mockResolvedValue({
      canAutoFix: true,
      risk: 'medium',
      description: 'd',
      currentState: {},
      proposedState: {},
      readSteps: [],
      fixSteps: [
        {
          method: 'PATCH',
          url: fixUrl,
          body: { properties: { supportsHttpsTrafficOnly: true } },
          purpose: 'fix',
        },
      ],
      rollbackSteps: [],
      rollbackSupported: false,
      requiresAcknowledgment: false,
    });

    await expect(
      service.executeRemediation(
        executeParams({
          acknowledgment: 'acknowledged',
          expectedPlanHash: 'azure-deadbeef',
        }),
      ),
    ).rejects.toThrow(/changed since you acknowledged it/);
  });

  it('execute refuses a non-allowlisted regenerated plan', async () => {
    connectionWith(boundStorageCredentials());
    checkResultFor('azure-storage-account', STORAGE_RESOURCE);
    stubAzureFetch();
    const vaultUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      `/providers/Microsoft.KeyVault/vaults/v?api-version=2023-07-01`;
    const fixSteps = [
      {
        method: 'PATCH',
        url: vaultUrl,
        body: { properties: { enableSoftDelete: true } },
        purpose: 'vault fix',
      },
    ];
    aiRemediationService.generateAzureFixPlan.mockResolvedValue({
      canAutoFix: true,
      risk: 'medium',
      description: 'd',
      currentState: {},
      proposedState: {},
      readSteps: [],
      fixSteps,
      rollbackSteps: [],
      rollbackSupported: false,
      requiresAcknowledgment: false,
    });

    await expect(
      service.executeRemediation(
        executeParams({
          acknowledgment: 'acknowledged',
          expectedPlanHash: hashFor(fixSteps),
        }),
      ),
    ).rejects.toThrow(/Fix plan validation failed/);
  });
});
