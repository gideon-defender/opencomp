import { AzureRemediationService } from './azure-remediation.service';
import { CredentialVaultService } from '../integration-platform/services/credential-vault.service';
import { OAuthCredentialsService } from '../integration-platform/services/oauth-credentials.service';
import { AiRemediationService } from './ai-remediation.service';
import { AzureSecurityService } from './providers/azure-security.service';
import { db } from '@db';

jest.mock('@db', () => ({
  db: {
    integrationConnection: { findFirst: jest.fn() },
    integrationCheckResult: { findFirst: jest.fn() },
    remediationAction: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  },
  Prisma: {},
}));

const SUB = '12345678-1234-1234-1234-1234567890ab';
const APP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TENANT = '11111111-2222-3333-4444-555555555555';
const STORAGE_RESOURCE = `/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa`;
const NSG_RESOURCE = `/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.Network/networkSecurityGroups/nsg`;

function tokenFor(appid: string, tid: string): string {
  const encoded = Buffer.from(JSON.stringify({ appid, tid })).toString(
    'base64url',
  );
  return `header.${encoded}.signature`;
}

function okJson(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('AzureRemediationService identity routing (Phase A)', () => {
  const mockDb = db as unknown as {
    integrationConnection: { findFirst: jest.Mock };
    integrationCheckResult: { findFirst: jest.Mock };
    remediationAction: {
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  const credentialVaultService = {
    getDecryptedCredentials: jest.fn(),
    getValidAccessToken: jest.fn(),
  };
  const oauthCredentialsService = { getCredentials: jest.fn() };
  const aiRemediationService = {
    generateAzureFixPlan: jest.fn(),
    refineAzureFixPlan: jest.fn(),
  };
  const azureSecurityService = { getAccessToken: jest.fn() };

  let service: AzureRemediationService;

  function connectionWith(credentials: Record<string, unknown>) {
    mockDb.integrationConnection.findFirst.mockResolvedValue({
      id: 'conn_1',
      provider: { slug: 'azure' },
    });
    credentialVaultService.getDecryptedCredentials.mockResolvedValue(
      credentials,
    );
  }

  function checkResultFor(resourceType: string, resourceId: string) {
    mockDb.integrationCheckResult.findFirst.mockResolvedValue({
      id: 'chk_1',
      title: 'finding',
      description: 'desc',
      severity: 'high',
      resourceType,
      resourceId,
      remediation: 'fix it',
      evidence: {},
    });
  }

  /** SP token mint + write-grant preflight pass; ARM steps 200. */
  function stubAzureFetch() {
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
      return okJson({});
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AzureRemediationService(
      credentialVaultService as unknown as CredentialVaultService,
      oauthCredentialsService as unknown as OAuthCredentialsService,
      aiRemediationService as unknown as AiRemediationService,
      azureSecurityService as unknown as AzureSecurityService,
    );
    oauthCredentialsService.getCredentials.mockResolvedValue(null);
    mockDb.remediationAction.create.mockResolvedValue({ id: 'act_1' });
    mockDb.remediationAction.update.mockResolvedValue({});
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
    aiRemediationService.generateAzureFixPlan.mockResolvedValue({
      canAutoFix: true,
      risk: 'medium',
      description: 'd',
      currentState: {},
      proposedState: {},
      readSteps: [],
      fixSteps: [{ method: 'PUT', url: fixUrl, purpose: 'fix' }],
      rollbackSteps: [],
      rollbackSupported: false,
      requiresAcknowledgment: false,
    });

    const result = await service.executeRemediation({
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'k',
      userId: 'user_1',
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
});
