import { AzureRemediationService } from './azure-remediation.service';
import { CredentialVaultService } from '../integration-platform/services/credential-vault.service';
import { OAuthCredentialsService } from '../integration-platform/services/oauth-credentials.service';
import { AiRemediationService } from './ai-remediation.service';
import { AzureSecurityService } from './providers/azure-security.service';
import { hashAzurePlanSteps } from './azure-remediation-plan.utils';
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

export const SUB = '12345678-1234-1234-1234-1234567890ab';
export const APP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
export const TENANT = '11111111-2222-3333-4444-555555555555';
export const STORAGE_RESOURCE = `/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa`;
export const NSG_RESOURCE = `/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.Network/networkSecurityGroups/nsg`;

export function tokenFor(appid: string, tid: string): string {
  const encoded = Buffer.from(JSON.stringify({ appid, tid })).toString(
    'base64url',
  );
  return `header.${encoded}.signature`;
}

export function okJson(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

export const mockDb = db as unknown as {
  integrationConnection: { findFirst: jest.Mock };
  integrationCheckResult: { findFirst: jest.Mock };
  remediationAction: {
    create: jest.Mock;
    update: jest.Mock;
    findFirst: jest.Mock;
  };
};

export const credentialVaultService = {
  getDecryptedCredentials: jest.fn(),
  getValidAccessToken: jest.fn(),
};
export const oauthCredentialsService = { getCredentials: jest.fn() };
export const aiRemediationService = {
  generateAzureFixPlan: jest.fn(),
  refineAzureFixPlan: jest.fn(),
};
export const azureSecurityService = { getAccessToken: jest.fn() };

export function connectionWith(credentials: Record<string, unknown>) {
  mockDb.integrationConnection.findFirst.mockResolvedValue({
    id: 'conn_1',
    provider: { slug: 'azure' },
  });
  credentialVaultService.getDecryptedCredentials.mockResolvedValue(credentials);
}

export function checkResultFor(resourceType: string, resourceId: string) {
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
export function stubAzureFetch() {
  jest.spyOn(global, 'fetch').mockImplementation((url: string) => {
    const target = String(url);
    if (target.includes('oauth2/v2.0/token')) {
      return Promise.resolve(
        okJson({
          access_token: tokenFor(APP_ID, TENANT),
          expires_in: 3600,
        }),
      );
    }
    if (target.includes('Microsoft.Authorization/permissions')) {
      return Promise.resolve(
        okJson({
          value: [{ actions: ['Microsoft.Storage/storageAccounts/write'] }],
        }),
      );
    }
    return Promise.resolve(okJson({}));
  });
}

export function boundStorageCredentials() {
  return {
    access_token: 'auditor-token',
    tenantId: TENANT,
    azureRemediation: JSON.stringify({ [`Storage:${SUB}`]: APP_ID }),
    azureRemediationSecrets: JSON.stringify({
      [`Storage:${SUB}`]: 'secret-1',
    }),
  };
}

export function hashFor(
  fixSteps: Array<{ method: string; url: string; body?: unknown }>,
  rollbackSteps: Array<{ method: string; url: string; body?: unknown }> = [],
): string {
  return hashAzurePlanSteps(fixSteps, rollbackSteps, {
    organizationId: 'org_1',
    connectionId: 'conn_1',
    checkResultId: 'chk_1',
    remediationKey: 'k',
  });
}

export function executeParams(extra: Record<string, unknown> = {}) {
  return {
    connectionId: 'conn_1',
    organizationId: 'org_1',
    checkResultId: 'chk_1',
    remediationKey: 'k',
    userId: 'user_1',
    ...extra,
  };
}

/** Fresh service with default credential/action stubs (mirrors beforeEach). */
export function setupAzureService(): AzureRemediationService {
  jest.clearAllMocks();
  oauthCredentialsService.getCredentials.mockResolvedValue(null);
  mockDb.remediationAction.create.mockResolvedValue({ id: 'act_1' });
  mockDb.remediationAction.update.mockResolvedValue({});
  return new AzureRemediationService(
    credentialVaultService as unknown as CredentialVaultService,
    oauthCredentialsService as unknown as OAuthCredentialsService,
    aiRemediationService as unknown as AiRemediationService,
    azureSecurityService as unknown as AzureSecurityService,
  );
}
