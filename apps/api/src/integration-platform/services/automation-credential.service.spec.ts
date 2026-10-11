import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AutomationCredentialService } from './automation-credential.service';
import { OAuthCredentialsService } from './oauth-credentials.service';
import type { EncryptedData } from './credential-vault.service';

const blob = (tag: string): EncryptedData => ({
  encrypted: tag,
  iv: 'aXY=',
  tag: 'dGFn',
  salt: 'c2FsdA==',
});

const platformRow = (overrides = {}) => ({
  id: 'ipc_1',
  providerSlug: 'github',
  encryptedClientId: blob('id'),
  encryptedClientSecret: blob('secret'),
  customScopes: ['read:user'],
  customSettings: { appName: 'x' },
  isActive: true,
  ...overrides,
});

const orgRow = (overrides = {}) => ({
  id: 'ioa_1',
  providerSlug: 'github',
  organizationId: 'org_1',
  managementSource: 'automation',
  automationVersion: 'v1',
  isActive: true,
  ...overrides,
});

function setup() {
  const oauthAppRepository = {
    findByProviderAndOrg: jest.fn(),
    createIfAbsent: jest.fn(),
    updateAutomationRow: jest.fn(),
    findAutomationByProvider: jest.fn(),
    findAll: jest.fn(),
    upsert: jest.fn(),
  };
  const platformCredentialRepository = {
    findByProviderSlug: jest.fn(),
    findAll: jest.fn(),
  };
  const credentialVaultService = {
    encrypt: jest.fn(async (text: string) => blob(`enc:${text}`)),
    decrypt: jest.fn(async (data: EncryptedData) => `dec:${data.encrypted}`),
  };
  const service = new AutomationCredentialService(
    oauthAppRepository as never,
    platformCredentialRepository as never,
    credentialVaultService as never,
  );
  return {
    service,
    oauthAppRepository,
    platformCredentialRepository,
    credentialVaultService,
  };
}

describe('AutomationCredentialService', () => {
  describe('backfillOrgCredentials', () => {
    it('copies an active platform source with automation provenance', async () => {
      const t = setup();
      t.oauthAppRepository.findByProviderAndOrg.mockResolvedValue(null);
      t.platformCredentialRepository.findByProviderSlug.mockResolvedValue(
        platformRow(),
      );
      const created = orgRow();
      t.oauthAppRepository.createIfAbsent.mockResolvedValue({
        created: true,
        row: created,
      });

      const result = await t.service.backfillOrgCredentials({
        providerSlug: 'github',
        organizationId: 'org_1',
        automationVersion: 'v1',
      });

      expect(result).toMatchObject({ status: 'copied', rowId: 'ioa_1' });
      expect(t.oauthAppRepository.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({
          managementSource: 'automation',
          automationVersion: 'v1',
          customScopes: ['read:user'],
          customSettings: { appName: 'x' },
          isActive: true,
        }),
      );
    });

    it('leaves an existing row untouched', async () => {
      const t = setup();
      t.oauthAppRepository.findByProviderAndOrg.mockResolvedValue(orgRow());

      const result = await t.service.backfillOrgCredentials({
        providerSlug: 'github',
        organizationId: 'org_1',
        automationVersion: 'v2',
      });

      expect(result.status).toBe('already-present');
      expect(
        t.oauthAppRepository.createIfAbsent,
      ).not.toHaveBeenCalled();
    });

    it('treats a lost create race as already-present', async () => {
      const t = setup();
      t.oauthAppRepository.findByProviderAndOrg.mockResolvedValue(null);
      t.platformCredentialRepository.findByProviderSlug.mockResolvedValue(
        platformRow(),
      );
      // Concurrent customer write won between the read and the insert.
      t.oauthAppRepository.createIfAbsent.mockResolvedValue({
        created: false,
        row: orgRow({ managementSource: 'customer', automationVersion: null }),
      });

      const result = await t.service.backfillOrgCredentials({
        providerSlug: 'github',
        organizationId: 'org_1',
        automationVersion: 'v1',
      });

      expect(result.status).toBe('already-present');
    });

    it('reports a missing platform source without writing', async () => {
      const t = setup();
      t.oauthAppRepository.findByProviderAndOrg.mockResolvedValue(null);
      t.platformCredentialRepository.findByProviderSlug.mockResolvedValue(
        null,
      );

      const result = await t.service.backfillOrgCredentials({
        providerSlug: 'github',
        organizationId: 'org_1',
        automationVersion: 'v1',
      });

      expect(result.status).toBe('no-platform-source');
      expect(
        t.oauthAppRepository.createIfAbsent,
      ).not.toHaveBeenCalled();
    });

    it('never copies a disabled platform source', async () => {
      const t = setup();
      t.oauthAppRepository.findByProviderAndOrg.mockResolvedValue(null);
      t.platformCredentialRepository.findByProviderSlug.mockResolvedValue(
        platformRow({ isActive: false }),
      );

      const result = await t.service.backfillOrgCredentials({
        providerSlug: 'github',
        organizationId: 'org_1',
        automationVersion: 'v1',
      });

      expect(result.status).toBe('source-inactive');
      expect(
        t.oauthAppRepository.createIfAbsent,
      ).not.toHaveBeenCalled();
    });

    it('never copies an undecryptable platform source', async () => {
      const t = setup();
      t.oauthAppRepository.findByProviderAndOrg.mockResolvedValue(null);
      t.platformCredentialRepository.findByProviderSlug.mockResolvedValue(
        platformRow(),
      );
      t.credentialVaultService.decrypt.mockRejectedValue(
        new Error('bad tag'),
      );

      const result = await t.service.backfillOrgCredentials({
        providerSlug: 'github',
        organizationId: 'org_1',
        automationVersion: 'v1',
      });

      expect(result.status).toBe('source-undecryptable');
      expect(
        t.oauthAppRepository.createIfAbsent,
      ).not.toHaveBeenCalled();
    });
  });

  describe('rotateAutomationCredentials', () => {
    const rotateArgs = {
      providerSlug: 'github',
      organizationId: 'org_1',
      expectedVersion: 'v1',
      newVersion: 'v2',
      clientId: 'new-id',
      clientSecret: 'new-secret',
    };

    it('rotates a version-matching automation row', async () => {
      const t = setup();
      t.oauthAppRepository.findByProviderAndOrg
        .mockResolvedValueOnce(orgRow())
        .mockResolvedValue(orgRow({ automationVersion: 'v2' }));
      t.oauthAppRepository.updateAutomationRow.mockResolvedValue(1);

      const row = await t.service.rotateAutomationCredentials(rotateArgs);

      expect(row.automationVersion).toBe('v2');
      expect(t.oauthAppRepository.updateAutomationRow).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedVersion: 'v1',
          newVersion: 'v2',
        }),
      );
    });

    it('rejects a missing row', async () => {
      const t = setup();
      t.oauthAppRepository.findByProviderAndOrg.mockResolvedValue(null);

      await expect(
        t.service.rotateAutomationCredentials(rotateArgs),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a customer-owned row', async () => {
      const t = setup();
      t.oauthAppRepository.findByProviderAndOrg.mockResolvedValue(
        orgRow({ managementSource: 'customer', automationVersion: null }),
      );

      await expect(
        t.service.rotateAutomationCredentials(rotateArgs),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        t.oauthAppRepository.updateAutomationRow,
      ).not.toHaveBeenCalled();
    });

    it('rejects a stale version', async () => {
      const t = setup();
      t.oauthAppRepository.findByProviderAndOrg.mockResolvedValue(
        orgRow({ automationVersion: 'v0' }),
      );

      await expect(
        t.service.rotateAutomationCredentials(rotateArgs),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a lost update race as a conflict', async () => {
      const t = setup();
      t.oauthAppRepository.findByProviderAndOrg.mockResolvedValue(orgRow());
      // Version matched on read but the conditional update hit zero rows:
      // a concurrent takeover or rotation won the race.
      t.oauthAppRepository.updateAutomationRow.mockResolvedValue(0);

      await expect(
        t.service.rotateAutomationCredentials(rotateArgs),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('rotateProviderCredentials', () => {
    it('rotates matching rows and reports stale skips without throwing', async () => {
      const t = setup();
      t.oauthAppRepository.findAutomationByProvider.mockResolvedValue([
        orgRow({ organizationId: 'org_a', automationVersion: 'v1' }),
        orgRow({ organizationId: 'org_b', automationVersion: 'v0' }),
      ]);
      t.oauthAppRepository.findByProviderAndOrg.mockImplementation(
        async (slug: string, org: string) =>
          orgRow({
            organizationId: org,
            automationVersion: org === 'org_a' ? 'v1' : 'v0',
          }),
      );
      t.oauthAppRepository.updateAutomationRow.mockResolvedValue(1);

      const result = await t.service.rotateProviderCredentials({
        providerSlug: 'github',
        expectedVersion: 'v1',
        newVersion: 'v2',
        clientId: 'id',
        clientSecret: 'secret',
      });

      expect(result.updated).toEqual(['org_a']);
      expect(result.skipped).toEqual([
        { organizationId: 'org_b', reason: 'stale' },
      ]);
    });
  });

  describe('provisionOrgCredentials', () => {
    it('backfills every active platform provider once', async () => {
      const t = setup();
      t.platformCredentialRepository.findAll.mockResolvedValue([
        platformRow({ providerSlug: 'github' }),
        platformRow({ providerSlug: 'slack', isActive: false }),
      ]);
      t.oauthAppRepository.findByProviderAndOrg.mockResolvedValue(null);
      t.platformCredentialRepository.findByProviderSlug.mockImplementation(
        async (slug: string) =>
          slug === 'github' ? platformRow() : null,
      );
      t.oauthAppRepository.createIfAbsent.mockResolvedValue({
        created: true,
        row: orgRow(),
      });

      const { results } = await t.service.provisionOrgCredentials({
        organizationId: 'org_new',
        automationVersion: 'v1',
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        status: 'copied',
        organizationId: 'org_new',
      });
    });
  });
});

describe('OAuthCredentialsService.saveOrgCredentials provenance', () => {
  it('takes ownership back to customer and clears the version', async () => {
    const oauthAppRepository = { upsert: jest.fn() };
    const service = new OAuthCredentialsService(
      oauthAppRepository as never,
      {} as never,
      {
        encrypt: async (text: string) => blob(`enc:${text}`),
      } as never,
    );

    await service.saveOrgCredentials('github', 'org_1', 'id', 'secret');

    expect(oauthAppRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        managementSource: 'customer',
        automationVersion: null,
      }),
    );
  });
});
