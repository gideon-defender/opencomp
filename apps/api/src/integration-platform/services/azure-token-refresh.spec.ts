jest.mock('@db', () => ({ db: {} }));
import { CredentialVaultService } from './credential-vault.service';
import type { CredentialRepository } from '../repositories/credential.repository';
import type { ConnectionRepository } from '../repositories/connection.repository';
import { AZURE_DEFAULT_TOKEN_URL, azureTokenUrl } from '../utils/azure-oauth';

const tenant = '55639f13-71b7-432d-b4e7-4efda934446d';

describe('Azure connection tenant persistence', () => {
  const create = jest.fn().mockResolvedValue({ id: 'version_2' });
  const update = jest.fn().mockResolvedValue({});
  let service: CredentialVaultService;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new CredentialVaultService(
      {
        create,
        deleteOldVersions: jest.fn(),
        findLatestByConnection: jest.fn().mockResolvedValue(null),
      } as unknown as CredentialRepository,
      {
        update,
        acquireRefreshLease: jest.fn().mockResolvedValue(true),
        releaseRefreshLease: jest.fn(),
      } as unknown as ConnectionRepository,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('stores the configured directory with the issued tokens', async () => {
    jest.spyOn(service, 'encrypt').mockImplementation(async (value) => ({
      encrypted: value,
      iv: 'iv',
      tag: 'tag',
      salt: 'salt',
    }));
    jest.spyOn(service, 'getDecryptedCredentials').mockResolvedValue(null);
    await service.storeOAuthTokens(
      'conn',
      { access_token: 'access', refresh_token: 'refresh' },
      { azureTenantId: tenant },
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        encryptedPayload: expect.objectContaining({
          azure_tenant_id: expect.objectContaining({ encrypted: tenant }),
        }),
      }),
    );
  });

  it.each([tenant, 'organizations', undefined])(
    'refreshes using the saved directory %s and preserves it',
    async (pinned) => {
      jest.spyOn(service, 'getRefreshToken').mockResolvedValue('refresh');
      jest
        .spyOn(service, 'getDecryptedCredentials')
        .mockResolvedValue(
          pinned === undefined ? {} : { azure_tenant_id: pinned },
        );
      const store = jest.spyOn(service, 'storeOAuthTokens').mockResolvedValue();
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'renewed',
            refresh_token: 'rotated',
          }),
          { status: 200 },
        ),
      );
      expect(
        await service.refreshOAuthTokens('conn', {
          tokenUrl: AZURE_DEFAULT_TOKEN_URL,
          clientId: 'client',
          clientSecret: 'secret',
        }),
      ).toBe('renewed');
      expect(fetchMock).toHaveBeenCalledWith(
        pinned === undefined ? AZURE_DEFAULT_TOKEN_URL : azureTokenUrl(pinned),
        expect.any(Object),
      );
      expect(store).toHaveBeenCalledWith(
        'conn',
        expect.objectContaining({ refresh_token: 'rotated' }),
        pinned === undefined ? {} : { azureTenantId: pinned },
      );
    },
  );

  it('rejects corrupt tenant metadata before sending credentials', async () => {
    jest.spyOn(service, 'getRefreshToken').mockResolvedValue('refresh');
    jest
      .spyOn(service, 'getDecryptedCredentials')
      .mockResolvedValue({ azure_tenant_id: '../evil' });
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    await expect(
      service.refreshOAuthTokens('conn', {
        tokenUrl: AZURE_DEFAULT_TOKEN_URL,
        clientId: 'client',
        clientSecret: 'secret',
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
