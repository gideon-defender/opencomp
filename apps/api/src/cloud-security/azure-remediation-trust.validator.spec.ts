import {
  validateAzureRemediationTrust,
  type AzureTrustBinding,
} from './azure-remediation-trust.validator';
import type { Logger } from '@nestjs/common';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const APP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function binding(overrides?: Partial<AzureTrustBinding>): AzureTrustBinding {
  return {
    key: `Storage:${SUB}`,
    assetClass: 'Storage',
    subscriptionId: SUB,
    appId: APP_ID,
    secret: 'secret-1',
    ...overrides,
  };
}

function tokenFor(claims: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${encoded}.signature`;
}

const logger = { log: jest.fn(), warn: jest.fn() } as Pick<
  Logger,
  'log' | 'warn'
>;

describe('validateAzureRemediationTrust', () => {
  it('passes a least-privilege SP (mint + claims + fix-forward grant)', async () => {
    const result = await validateAzureRemediationTrust({
      tenantId: 'tenant-1',
      bindings: [binding()],
      deps: {
        mint: jest.fn(async () => ({
          accessToken: tokenFor({ appid: APP_ID, tid: 'tenant-1' }),
          expiresIn: 3600,
        })),
        readActions: jest.fn(async () => ({
          actions: ['Microsoft.Storage/storageAccounts/write'],
        })),
      },
      logger,
    });
    expect(result).toBeNull();
  });

  it('passes an empty binding list trivially', async () => {
    const result = await validateAzureRemediationTrust({
      tenantId: 'tenant-1',
      bindings: [],
      logger,
    });
    expect(result).toBeNull();
  });

  it('refuses a binding with no secret', async () => {
    const result = await validateAzureRemediationTrust({
      tenantId: 'tenant-1',
      bindings: [binding({ secret: undefined })],
      logger,
    });
    expect(result).toMatch(/missing client secret/);
  });

  it('refuses a token minted for a different application or tenant', async () => {
    const wrongApp = await validateAzureRemediationTrust({
      tenantId: 'tenant-1',
      bindings: [binding()],
      deps: {
        mint: jest.fn(async () => ({
          accessToken: tokenFor({ appid: 'other-app', tid: 'tenant-1' }),
          expiresIn: 3600,
        })),
      },
      logger,
    });
    expect(wrongApp).toMatch(/different application/);

    const wrongTenant = await validateAzureRemediationTrust({
      tenantId: 'tenant-1',
      bindings: [binding()],
      deps: {
        mint: jest.fn(async () => ({
          accessToken: tokenFor({ appid: APP_ID, tid: 'tenant-2' }),
          expiresIn: 3600,
        })),
      },
      logger,
    });
    expect(wrongTenant).toMatch(/different tenant/);
  });

  it('refuses wildcard and never-allow grants', async () => {
    const mint = jest.fn(async () => ({
      accessToken: tokenFor({ appid: APP_ID, tid: 'tenant-1' }),
      expiresIn: 3600,
    }));
    const wildcard = await validateAzureRemediationTrust({
      tenantId: 'tenant-1',
      bindings: [binding()],
      deps: {
        mint,
        readActions: jest.fn(async () => ({ actions: ['*'] })),
      },
      logger,
    });
    expect(wildcard).toMatch(/wildcard grant/);

    const forbidden = await validateAzureRemediationTrust({
      tenantId: 'tenant-1',
      bindings: [binding()],
      deps: {
        mint,
        readActions: jest.fn(async () => ({
          actions: [
            'Microsoft.Storage/storageAccounts/write',
            'Microsoft.Authorization/roleAssignments/write',
          ],
        })),
      },
      logger,
    });
    expect(forbidden).toMatch(/never-allow grant/);
  });

  it('refuses an SP with no fix-forward grants for the class', async () => {
    const result = await validateAzureRemediationTrust({
      tenantId: 'tenant-1',
      bindings: [binding()],
      deps: {
        mint: jest.fn(async () => ({
          accessToken: tokenFor({ appid: APP_ID, tid: 'tenant-1' }),
          expiresIn: 3600,
        })),
        readActions: jest.fn(async () => ({
          actions: ['Microsoft.Resources/subscriptions/read'],
        })),
      },
      logger,
    });
    expect(result).toMatch(/no fix-forward grants/);
  });

  it('passes inconclusive 403 reads with a logged warning (least-privilege SPs cannot read authZ)', async () => {
    const warn = jest.fn();
    const result = await validateAzureRemediationTrust({
      tenantId: 'tenant-1',
      bindings: [binding()],
      deps: {
        mint: jest.fn(async () => ({
          accessToken: tokenFor({ appid: APP_ID, tid: 'tenant-1' }),
          expiresIn: 3600,
        })),
        readActions: jest.fn(async () => ({ denied: true as const })),
      },
      logger: { log: jest.fn(), warn },
    });
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('propagates mint failures instead of certifying (inconclusive never passes)', async () => {
    await expect(
      validateAzureRemediationTrust({
        tenantId: 'tenant-1',
        bindings: [binding()],
        deps: {
          mint: jest.fn(async () => {
            throw new Error('socket hangup');
          }),
        },
        logger,
      }),
    ).rejects.toThrow(/socket hangup/);
  });
});
