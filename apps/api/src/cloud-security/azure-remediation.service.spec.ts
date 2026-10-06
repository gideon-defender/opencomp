import { AzureRemediationService } from './azure-remediation.service';
import {
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

describe('AzureRemediationService preview (Phase B)', () => {
  let service: AzureRemediationService;

  beforeEach(() => {
    service = setupAzureService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('preview returns guided-only for approval-gated classes without calling AI', async () => {
    connectionWith({ access_token: 'auditor-token', tenantId: TENANT });
    checkResultFor('azure-nsg', NSG_RESOURCE);

    const result = await service.previewRemediation({
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'k',
    });

    expect(result.guidedOnly).toBe(true);
    expect(aiRemediationService.generateAzureFixPlan).not.toHaveBeenCalled();
  });

  it('preview returns guided-only when the finding has no subscription scope', async () => {
    connectionWith({ access_token: 'auditor-token', tenantId: TENANT });
    checkResultFor('azure-storage-account', '');

    const result = await service.previewRemediation({
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'k',
    });

    expect(result.guidedOnly).toBe(true);
    expect(aiRemediationService.generateAzureFixPlan).not.toHaveBeenCalled();
  });

  it('preview refuses non-allowlisted fix steps as guided-only without caching', async () => {
    connectionWith(boundStorageCredentials());
    checkResultFor('azure-storage-account', STORAGE_RESOURCE);
    const vaultUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      `/providers/Microsoft.KeyVault/vaults/v?api-version=2023-07-01`;
    aiRemediationService.generateAzureFixPlan.mockResolvedValueOnce({
      canAutoFix: true,
      risk: 'medium',
      description: 'd',
      currentState: {},
      proposedState: {},
      readSteps: [],
      fixSteps: [
        {
          method: 'PATCH',
          url: vaultUrl,
          body: { properties: { enableSoftDelete: true } },
          purpose: 'vault fix',
        },
      ],
      rollbackSteps: [],
      rollbackSupported: false,
      requiresAcknowledgment: false,
    });

    const preview = await service.previewRemediation({
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'k',
    });
    expect(preview.guidedOnly).toBe(true);

    // The refused plan was not cached: execute regenerates and runs the
    // allowlisted plan instead of reloading the refused one.
    stubAzureFetch();
    const fixUrl = `https://management.azure.com${STORAGE_RESOURCE}?api-version=2023-05-01`;
    const allowlisted = {
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
    };
    aiRemediationService.generateAzureFixPlan.mockResolvedValueOnce(
      allowlisted,
    );
    const result = await service.executeRemediation(
      executeParams({
        acknowledgment: 'acknowledged',
        expectedPlanHash: hashFor(allowlisted.fixSteps),
      }),
    );
    expect(result.actionId).toBe('act_1');
  });

  it('preview guides when refinement drifts off the allowlist', async () => {
    connectionWith(boundStorageCredentials());
    checkResultFor('azure-storage-account', STORAGE_RESOURCE);
    stubAzureFetch();
    const readUrl = `https://management.azure.com${STORAGE_RESOURCE}?api-version=2023-05-01`;
    const fixUrl = readUrl;
    aiRemediationService.generateAzureFixPlan.mockResolvedValue({
      canAutoFix: true,
      risk: 'medium',
      description: 'd',
      currentState: {},
      proposedState: {},
      readSteps: [{ method: 'GET', url: readUrl, purpose: 'read' }],
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
    // Refinement rewrites the fix onto a vault URL the allowlist refuses.
    aiRemediationService.refineAzureFixPlan.mockResolvedValue({
      canAutoFix: true,
      risk: 'medium',
      description: 'd',
      currentState: {},
      proposedState: {},
      readSteps: [],
      fixSteps: [
        {
          method: 'PATCH',
          url:
            `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
            `/providers/Microsoft.KeyVault/vaults/v?api-version=2023-07-01`,
          body: { properties: { enableSoftDelete: true } },
          purpose: 'vault fix',
        },
      ],
      rollbackSteps: [],
      rollbackSupported: false,
      requiresAcknowledgment: false,
    });

    const preview = await service.previewRemediation({
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'k',
    });
    expect(aiRemediationService.refineAzureFixPlan).toHaveBeenCalledTimes(1);
    expect(preview.guidedOnly).toBe(true);
  });

  it('preview skips refused reads instead of grounding on them', async () => {
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
      readSteps: [
        {
          method: 'GET',
          url: 'https://management.azure.com/subscriptions/99999999-9999-9999-9999-999999999999/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01',
          purpose: 'cross-sub read',
        },
      ],
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

    const preview = await service.previewRemediation({
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'k',
    });
    // The cross-subscription read never ran, so refinement never grounded —
    // but the allowlisted fix still previews.
    expect(aiRemediationService.refineAzureFixPlan).not.toHaveBeenCalled();
    expect(preview.guidedOnly).not.toBe(true);
    expect((preview as { planHash?: string }).planHash).toMatch(/^azure-/);
  });

  it('preview refuses open storage values as guided-only', async () => {
    // Hermetic AI mocks: the file shares mock instances across tests and
    // clearAllMocks keeps implementations, so reset before re-stubbing.
    aiRemediationService.generateAzureFixPlan.mockReset();
    aiRemediationService.refineAzureFixPlan.mockReset();
    connectionWith(boundStorageCredentials());
    checkResultFor('azure-storage-account', STORAGE_RESOURCE);
    stubAzureFetch();
    // Allowlisted URL, forbidden value: the plan must not auto-execute.
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
          url: `https://management.azure.com${STORAGE_RESOURCE}?api-version=2023-05-01`,
          body: { properties: { allowBlobPublicAccess: true } },
          purpose: 'fix',
        },
      ],
      rollbackSteps: [],
      rollbackSupported: false,
      requiresAcknowledgment: false,
    });

    const preview = await service.previewRemediation({
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'k',
    });
    expect(preview.guidedOnly).toBe(true);
  });
});
