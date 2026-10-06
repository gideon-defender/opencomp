import { AzureRemediationService } from './azure-remediation.service';
import {
  APP_ID,
  STORAGE_RESOURCE,
  SUB,
  TENANT,
  aiRemediationService,
  boundStorageCredentials,
  checkResultFor,
  connectionWith,
  executeParams,
  hashFor,
  mockDb,
  okJson,
  setupAzureService,
  stubAzureFetch,
  tokenFor,
} from './azure-remediation-service.fixtures';

describe('AzureRemediationService execute flow', () => {
  let service: AzureRemediationService;

  beforeEach(() => {
    service = setupAzureService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('execute runs fix steps with the SP token and records the executor identity', async () => {
    connectionWith({
      access_token: 'auditor-token',
      tenantId: TENANT,
      azureRemediation: JSON.stringify({ [`Storage:${SUB}`]: APP_ID }),
      azureRemediationSecrets: JSON.stringify({
        [`Storage:${SUB}`]: 'secret-1',
      }),
    });
    checkResultFor('azure-storage-account', STORAGE_RESOURCE);
    stubAzureFetch();
    const fixUrl = `https://management.azure.com${STORAGE_RESOURCE}?api-version=2023-05-01`;
    const stubPlan = {
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
    aiRemediationService.generateAzureFixPlan.mockResolvedValue(stubPlan);
    const planHash = hashFor(stubPlan.fixSteps);

    const result = await service.executeRemediation({
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'k',
      userId: 'user_1',
      acknowledgment: 'acknowledged',
      expectedPlanHash: planHash,
    });

    expect(result.actionId).toBe('act_1');
    const fetchMock = global.fetch as jest.Mock;
    const fixCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('storageAccounts/sa?'),
    ) as [string, RequestInit];
    expect(fixCall).toBeDefined();
    // The fix write carries the SP token, never the auditor token.
    expect((fixCall[1].headers as Record<string, string>).Authorization).toBe(
      `Bearer ${tokenFor(APP_ID, TENANT)}`,
    );
    const updateCall = mockDb.remediationAction.update.mock.calls[0][0];
    expect(updateCall.data.appliedState.executedAs).toEqual({
      spAppId: APP_ID.toLowerCase(),
      assetClass: 'Storage',
      key: `Storage:${SUB}`,
    });
  });

  it('execute skips a self-heal retry whose targets drifted', async () => {
    aiRemediationService.generateAzureFixPlan.mockReset();
    aiRemediationService.refineAzureFixPlan.mockReset();
    connectionWith(boundStorageCredentials());
    checkResultFor('azure-storage-account', STORAGE_RESOURCE);
    const fixUrl = `https://management.azure.com${STORAGE_RESOURCE}?api-version=2023-05-01`;
    const readUrl = fixUrl;
    // Fix fails fast with a non-permission 400 (no executor backoff);
    // everything else succeeds.
    jest.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.includes('oauth2/v2.0/token')) {
        return okJson({
          access_token: tokenFor(APP_ID, TENANT),
          expires_in: 3600,
        });
      }
      if (target.includes('Microsoft.Authorization/permissions')) {
        return okJson({
          value: [{ actions: ['Microsoft.Storage/storageAccounts/write'] }],
        });
      }
      if (target.includes('storageAccounts/sa?')) {
        return okJson(
          { error: { message: 'InvalidParameter: bad value' } },
          400,
        );
      }
      return okJson({});
    });
    const fixSteps = [
      {
        method: 'PATCH',
        url: fixUrl,
        body: { properties: { supportsHttpsTrafficOnly: true } },
        purpose: 'fix',
      },
    ];
    const stubPlan = {
      canAutoFix: true,
      risk: 'medium',
      description: 'd',
      currentState: {},
      proposedState: {},
      readSteps: [{ method: 'GET', url: readUrl, purpose: 'read' }],
      fixSteps,
      rollbackSteps: [],
      rollbackSupported: false,
      requiresAcknowledgment: false,
    };
    aiRemediationService.generateAzureFixPlan.mockResolvedValue(stubPlan);
    // Post-read refinement keeps the acknowledged targets.
    aiRemediationService.refineAzureFixPlan.mockResolvedValueOnce(stubPlan);
    // Self-heal retry drifts to a different storage account.
    const driftedUrl = fixUrl.replace(
      'storageAccounts/sa?',
      'storageAccounts/other?',
    );
    aiRemediationService.refineAzureFixPlan.mockResolvedValueOnce({
      ...stubPlan,
      fixSteps: [{ ...fixSteps[0], url: driftedUrl }],
    });

    const result = (await service.executeRemediation(
      executeParams({
        acknowledgment: 'acknowledged',
        expectedPlanHash: hashFor(fixSteps),
      }),
    )) as Record<string, unknown>;

    // The retry never ran: the original failure is reported instead.
    expect(result.status).toBe('failed');
    expect(String(result.error)).toMatch(/InvalidParameter/);
    const fetchMock = global.fetch as jest.Mock;
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('storageAccounts/other'),
      ),
    ).toBe(false);
  });

  it('execute refuses refined verify reads that smuggle writes', async () => {
    aiRemediationService.generateAzureFixPlan.mockReset();
    aiRemediationService.refineAzureFixPlan.mockReset();
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
    const stubPlan = {
      canAutoFix: true,
      risk: 'medium',
      description: 'd',
      currentState: {},
      proposedState: {},
      readSteps: [{ method: 'GET', url: fixUrl, purpose: 'read' }],
      fixSteps,
      rollbackSteps: [],
      rollbackSupported: false,
      requiresAcknowledgment: false,
    };
    aiRemediationService.generateAzureFixPlan.mockResolvedValue(stubPlan);
    // Refinement keeps the fix but swaps the verify reads for a write.
    const evilReadUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      `/providers/Microsoft.Storage/storageAccounts/evil?api-version=2023-05-01`;
    aiRemediationService.refineAzureFixPlan.mockResolvedValue({
      ...stubPlan,
      readSteps: [{ method: 'PATCH', url: evilReadUrl, purpose: 'read' }],
    });

    await expect(
      service.executeRemediation(
        executeParams({
          acknowledgment: 'acknowledged',
          expectedPlanHash: hashFor(fixSteps),
        }),
      ),
    ).rejects.toThrow(/Invalid verify steps/);
    // The smuggled write never reached the wire.
    const fetchMock = global.fetch as jest.Mock;
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/evil')),
    ).toBe(false);
  });
});
