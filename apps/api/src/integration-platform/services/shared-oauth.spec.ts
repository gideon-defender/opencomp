import { Test } from '@nestjs/testing';
import { OAuthCredentialsService } from './oauth-credentials.service';
import { OAuthAppRepository } from '../repositories/oauth-app.repository';
import { PlatformCredentialRepository } from '../repositories/platform-credential.repository';
import {
  CredentialVaultService,
  type EncryptedData,
} from './credential-vault.service';
import { resolveAzureOAuthConfig } from '../utils/azure-oauth';

const providers = [
  'gcp',
  'azure',
  'github-app',
  'github',
  'aikido',
  'google-workspace',
  'rippling',
  'vercel',
];

const mockOrgRead = jest.fn();
const mockOrgActiveRead = jest.fn();
const mockSharedRead = jest.fn();
jest.mock('@db', () => ({
  db: {
    integrationOAuthApp: {
      findUnique: (...args: unknown[]) => mockOrgRead(...args),
      findFirst: (...args: unknown[]) => mockOrgActiveRead(...args),
    },
    integrationPlatformCredential: {
      findFirst: (...args: unknown[]) => mockSharedRead(...args),
    },
  },
}));
jest.mock('@gideon-defender/integration-platform', () => ({
  getManifest: (slug: string) => ({
    auth: {
      type: 'oauth2',
      config: {
        scopes: ['openid', 'offline_access'],
        additionalOAuthSettings:
          slug === 'rippling'
            ? [{ id: 'appName', required: true }]
            : slug === 'vercel'
              ? [{ id: 'appSlug', required: true }]
              : [],
        authorizeUrl:
          'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
        tokenUrl:
          'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
        pkce: false,
        clientAuthMethod: 'body',
        supportsRefreshToken: true,
      },
    },
  }),
}));

const blob = (value: string): EncryptedData => ({
  encrypted: value,
  iv: '',
  tag: '',
  salt: '',
});
const shared = {
  isActive: true,
  encryptedClientId: blob('shared-client'),
  encryptedClientSecret: blob('shared-secret'),
  customScopes: [],
  customSettings: {
    githubAppSlug: 'gideon-dev',
    appName: 'gideon',
    appSlug: 'gideon-dev',
  },
};

describe('shared Gideon OAuth apps', () => {
  let service: OAuthCredentialsService;
  const decrypt = jest.fn();
  beforeEach(async () => {
    jest.clearAllMocks();
    mockOrgRead.mockResolvedValue(null);
    mockOrgActiveRead.mockResolvedValue(null);
    mockSharedRead.mockResolvedValue(shared);
    decrypt
      .mockReset()
      .mockImplementation(async (value: EncryptedData) => value.encrypted);
    const module = await Test.createTestingModule({
      providers: [
        OAuthCredentialsService,
        OAuthAppRepository,
        PlatformCredentialRepository,
        { provide: CredentialVaultService, useValue: { decrypt } },
      ],
    }).compile();
    service = module.get(OAuthCredentialsService);
  });

  it.each(providers)(
    'uses the same %s app for separate organizations without copying credentials',
    async (providerSlug) => {
      for (const organizationId of ['org_1', 'org_2']) {
        expect(
          await service.getCredentials(providerSlug, organizationId),
        ).toMatchObject({
          clientId: 'shared-client',
          clientSecret: 'shared-secret',
          source: 'platform',
          scopes: ['openid', 'offline_access'],
        });
        expect(
          await service.checkAvailability(providerSlug, organizationId),
        ).toMatchObject({
          available: true,
          hasPlatformCredentials: true,
          hasOrgCredentials: false,
        });
        expect(mockOrgRead).toHaveBeenCalledWith({
          where: {
            providerSlug_organizationId: {
              providerSlug,
              organizationId,
            },
          },
        });
      }
      expect(mockSharedRead).toHaveBeenCalledWith({
        where: { providerSlug, isActive: true },
      });
    },
  );

  it('uses multitenant Azure routing rather than the shared app owner directory', async () => {
    mockSharedRead.mockResolvedValue({
      ...shared,
      customSettings: {
        tenantId: '55639f13-71b7-432d-b4e7-4efda934446d',
        otherSetting: 'preserved',
      },
    });
    const credentials = await service.getCredentials('azure', 'org_2');
    expect(credentials?.customSettings).toEqual({ otherSetting: 'preserved' });
    const resolved = resolveAzureOAuthConfig({
      providerSlug: 'azure',
      config: {
        authorizeUrl: '',
        tokenUrl: '',
        scopes: [],
        pkce: false,
        clientAuthMethod: 'body',
        supportsRefreshToken: true,
      },
      customSettings: credentials?.customSettings,
    });
    expect(resolved.authorizeUrl).toContain('/organizations/');
    expect(resolved.tokenUrl).toContain('/organizations/');
  });

  it.each(providers)(
    'keeps a customer-owned %s override scoped to its organization',
    async (providerSlug) => {
      const own = {
        ...shared,
        providerSlug,
        organizationId: 'org_1',
        encryptedClientId: blob('own-client'),
        encryptedClientSecret: blob('own-secret'),
      };
      mockOrgRead.mockImplementation(async ({ where }) =>
        where.providerSlug_organizationId.organizationId === 'org_1'
          ? own
          : null,
      );
      mockOrgActiveRead.mockResolvedValue(own);
      expect(await service.getCredentials(providerSlug, 'org_1')).toMatchObject(
        { clientId: 'own-client', source: 'organization' },
      );
      expect(mockSharedRead).not.toHaveBeenCalled();
      expect(await service.getCredentials(providerSlug, 'org_2')).toMatchObject(
        { clientId: 'shared-client', source: 'platform' },
      );
    },
  );

  it.each(
    providers.flatMap((providerSlug) =>
      ['disabled', 'undecryptable'].map((scenario) => ({
        providerSlug,
        scenario,
      })),
    ),
  )(
    'does not change $providerSlug client identity for a $scenario org override',
    async ({ providerSlug, scenario }) => {
      mockOrgRead.mockResolvedValue({
        ...shared,
        isActive: scenario !== 'disabled',
      });
      mockOrgActiveRead.mockResolvedValue(shared);
      if (scenario === 'undecryptable')
        decrypt.mockRejectedValue(new Error('invalid ciphertext'));
      expect(await service.getCredentials(providerSlug, 'org_1')).toBeNull();
      expect(mockSharedRead).not.toHaveBeenCalled();
    },
  );

  it.each(
    providers.flatMap((providerSlug) =>
      ['missing', 'disabled', 'undecryptable', 'malformed'].map((scenario) => ({
        providerSlug,
        scenario,
      })),
    ),
  )(
    'fails closed for a $scenario shared $providerSlug app',
    async ({ providerSlug, scenario }) => {
      if (scenario === 'missing') mockSharedRead.mockResolvedValue(null);
      if (scenario === 'disabled')
        mockSharedRead.mockResolvedValue({ ...shared, isActive: false });
      if (scenario === 'undecryptable')
        decrypt.mockRejectedValue(new Error('invalid ciphertext'));
      if (scenario === 'malformed')
        mockSharedRead.mockResolvedValue({
          ...shared,
          encryptedClientSecret: null,
        });
      expect(await service.getCredentials(providerSlug, 'org_1')).toBeNull();
      expect(
        await service.checkAvailability(providerSlug, 'org_1'),
      ).toMatchObject({
        available: false,
        hasPlatformCredentials: false,
      });
    },
  );

  it('preserves scopes belonging to the shared app', async () => {
    mockSharedRead.mockResolvedValue({
      ...shared,
      customScopes: ['cloud-scope'],
    });
    expect(await service.getCredentials('gcp', 'org_1')).toMatchObject({
      scopes: ['cloud-scope'],
    });
  });

  it('rejects a shared GitHub App without its installation identity', async () => {
    mockSharedRead.mockResolvedValue({ ...shared, customSettings: {} });
    expect(await service.getCredentials('github-app', 'org_1')).toBeNull();
    expect(
      await service.checkAvailability('github-app', 'org_1'),
    ).toMatchObject({ available: false });
  });

  it.each([
    ['rippling', 'appName'],
    ['vercel', 'appSlug'],
  ])(
    'rejects shared %s credentials without a valid %s setting',
    async (providerSlug, setting) => {
      for (const value of [undefined, '', '   ', 123]) {
        mockSharedRead.mockResolvedValue({
          ...shared,
          customSettings: { [setting]: value },
        });
        expect(await service.getCredentials(providerSlug, 'org_1')).toBeNull();
        expect(
          await service.checkAvailability(providerSlug, 'org_1'),
        ).toMatchObject({ available: false });
      }
    },
  );

  it.each(['rippling', 'vercel'])(
    'retains the shared %s installation settings',
    async (providerSlug) => {
      expect(await service.getCredentials(providerSlug, 'org_1')).toMatchObject(
        { customSettings: shared.customSettings },
      );
    },
  );

  it('never uses the shared store for other providers', async () => {
    expect(await service.getCredentials('slack', 'org_1')).toBeNull();
    expect(await service.checkAvailability('slack', 'org_1')).toMatchObject({
      available: false,
      hasPlatformCredentials: false,
    });
    expect(mockSharedRead).not.toHaveBeenCalled();
  });
});
