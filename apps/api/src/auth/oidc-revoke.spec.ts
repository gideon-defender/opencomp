import {
  createOidcService,
  ENV,
  mockOidc,
  mockSessionDelete,
  mockSessionFindUnique,
  mockTokenRevocation,
} from './oidc.service.fixtures';
import { OidcService } from './oidc.service';

// openid-client v6 is ESM-only and loaded via dynamic import() inside
// oidc-client — mock the loader statically instead.
jest.mock('./oidc-client', () => ({
  loadOidcClient: () => Promise.resolve(mockOidc),
}));

jest.mock('../redis/redis.client', () => ({
  redisClient: { set: jest.fn(), getdel: jest.fn() },
}));

jest.mock('@db', () => ({
  db: {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    organization: { findFirst: jest.fn() },
    session: {
      create: jest.fn(),
      findUnique: (...args: unknown[]) => mockSessionFindUnique(...args),
      delete: (...args: unknown[]) => mockSessionDelete(...args),
    },
  },
}));

describe('OidcService.revokeAndDeleteSession', () => {
  let service: OidcService;
  const OLD_ENV = { ...process.env };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, ...ENV };
    service = await createOidcService();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('revokes the refresh token then deletes the session', async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: 'ses_1',
      oidcRefreshToken: 'refresh-1',
    });
    mockSessionDelete.mockResolvedValue({ id: 'ses_1' });

    await service.revokeAndDeleteSession('ses-token');

    expect(mockTokenRevocation).toHaveBeenCalledWith(
      'mock-config',
      'refresh-1',
    );
    expect(mockSessionDelete).toHaveBeenCalledWith({
      where: { id: 'ses_1' },
    });
  });

  it('still deletes the session when revocation fails', async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: 'ses_1',
      oidcRefreshToken: 'refresh-1',
    });
    mockTokenRevocation.mockRejectedValue(new Error('revoke down'));
    mockSessionDelete.mockResolvedValue({ id: 'ses_1' });

    await service.revokeAndDeleteSession('ses-token');

    expect(mockSessionDelete).toHaveBeenCalledWith({
      where: { id: 'ses_1' },
    });
  });

  it('deletes the session even without a stored refresh token', async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: 'ses_1',
      oidcRefreshToken: null,
    });
    mockSessionDelete.mockResolvedValue({ id: 'ses_1' });

    await service.revokeAndDeleteSession('ses-token');

    expect(mockTokenRevocation).not.toHaveBeenCalled();
    expect(mockSessionDelete).toHaveBeenCalled();
  });

  it('no-ops for an unknown session token', async () => {
    mockSessionFindUnique.mockResolvedValue(null);

    await service.revokeAndDeleteSession('unknown');

    expect(mockTokenRevocation).not.toHaveBeenCalled();
    expect(mockSessionDelete).not.toHaveBeenCalled();
  });

  it('swallows a concurrent-delete race instead of failing logout', async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: 'ses_1',
      oidcRefreshToken: null,
    });
    mockSessionDelete.mockRejectedValue({ code: 'P2025' });

    await expect(
      service.revokeAndDeleteSession('ses-token'),
    ).resolves.toBeUndefined();
  });

  it('rethrows unexpected delete failures', async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: 'ses_1',
      oidcRefreshToken: null,
    });
    mockSessionDelete.mockRejectedValue(new Error('db down'));

    await expect(service.revokeAndDeleteSession('ses-token')).rejects.toThrow(
      'db down',
    );
  });
});
