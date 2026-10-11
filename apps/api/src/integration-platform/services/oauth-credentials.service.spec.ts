import { Test } from '@nestjs/testing';
import { OAuthAppRepository } from '../repositories/oauth-app.repository';
import {
  CredentialVaultService,
  type EncryptedData,
} from './credential-vault.service';
import { OAuthCredentialsService } from './oauth-credentials.service';

const mockFindFirst = jest.fn();
const mockPlatformRead = jest.fn();
jest.mock('@db', () => ({
  db: {
    integrationOAuthApp: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
    integrationPlatformCredential: {
      findFirst: (...args: unknown[]) => mockPlatformRead(...args),
    },
  },
}));
jest.mock('@gideon-defender/integration-platform', () => ({
  getManifest: () => ({
    auth: { type: 'oauth2', config: { scopes: ['read:user'] } },
  }),
}));

const encrypted = (value: string): EncryptedData => ({
  encrypted: value,
  iv: '',
  tag: '',
  salt: '',
});
const row = ({
  organizationId,
  isActive = true,
}: {
  organizationId: string;
  isActive?: boolean;
}) => ({
  providerSlug: 'github',
  organizationId,
  isActive,
  encryptedClientId: encrypted('client'),
  encryptedClientSecret: encrypted('secret'),
  customScopes: [],
  customSettings: {},
});
type Row = ReturnType<typeof row>;

describe('OAuthCredentialsService organization isolation', () => {
  let service: OAuthCredentialsService;
  let rows: Row[];
  const decrypt = jest.fn();
  beforeEach(async () => {
    jest.clearAllMocks();
    rows = [];
    decrypt
      .mockReset()
      .mockImplementation(async (value: EncryptedData) => value.encrypted);
    mockFindFirst.mockImplementation(
      async ({
        where,
      }: {
        where: {
          providerSlug: string;
          organizationId: string;
          isActive: boolean;
        };
      }) =>
        rows.find(
          (candidate) =>
            candidate.providerSlug === where.providerSlug &&
            candidate.organizationId === where.organizationId &&
            candidate.isActive === where.isActive,
        ) ?? null,
    );
    const module = await Test.createTestingModule({
      providers: [
        OAuthCredentialsService,
        OAuthAppRepository,
        { provide: CredentialVaultService, useValue: { decrypt } },
      ],
    }).compile();
    service = module.get(OAuthCredentialsService);
  });

  it.each(['missing', 'disabled', 'other organization'])(
    'rejects %s credentials without platform fallback',
    async (scenario) => {
      if (scenario === 'disabled')
        rows.push(row({ organizationId: 'org_1', isActive: false }));
      if (scenario === 'other organization')
        rows.push(row({ organizationId: 'org_2' }));
      expect(await service.getCredentials('github', 'org_1')).toBeNull();
      expect(await service.checkAvailability('github', 'org_1')).toMatchObject({
        available: false,
        hasOrgCredentials: false,
        hasPlatformCredentials: false,
      });
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: {
          providerSlug: 'github',
          organizationId: 'org_1',
          isActive: true,
        },
      });
      expect(decrypt).not.toHaveBeenCalled();
      expect(mockPlatformRead).not.toHaveBeenCalled();
    },
  );

  it('uses only active credentials belonging to the requested organization', async () => {
    rows.push(
      row({ organizationId: 'org_2' }),
      row({ organizationId: 'org_1' }),
    );
    expect(await service.getCredentials('github', 'org_1')).toMatchObject({
      clientId: 'client',
      clientSecret: 'secret',
      scopes: ['read:user'],
      source: 'organization',
    });
    expect(await service.checkAvailability('github', 'org_1')).toMatchObject({
      available: true,
      hasOrgCredentials: true,
      hasPlatformCredentials: false,
    });
    expect(mockPlatformRead).not.toHaveBeenCalled();
  });

  it('fails closed when organization credentials cannot be decrypted', async () => {
    rows.push(row({ organizationId: 'org_1' }));
    decrypt.mockRejectedValue(new Error('invalid ciphertext'));
    expect(await service.getCredentials('github', 'org_1')).toBeNull();
    expect(mockPlatformRead).not.toHaveBeenCalled();
  });
});
