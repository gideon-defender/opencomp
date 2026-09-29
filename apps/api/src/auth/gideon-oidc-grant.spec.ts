import { UnauthorizedException } from '@nestjs/common';
import {
  CALLBACK_URL,
  createOidcService,
  ENV,
  mockAuthorizationCodeGrant,
  mockFetchUserInfo,
  mockOidc,
  mockOrgFindFirst,
  mockRedisGetdel,
  mockRedisSet,
  mockSessionCreate,
  mockSuccessfulExchange,
  mockUserCreate,
  mockUserFindFirst,
  mockUserFindUnique,
  mockUserUpdate,
} from './gideon-oidc.service.fixtures';
import { GideonOidcService } from './gideon-oidc.service';

// openid-client v6 is ESM-only and loaded via dynamic import() inside
// gideon-oidc-client — mock the loader statically instead.
jest.mock('./gideon-oidc-client', () => ({
  loadOidcClient: () => Promise.resolve(mockOidc),
}));

jest.mock('../redis/redis.client', () => ({
  redisClient: {
    set: (...args: unknown[]) => mockRedisSet(...args),
    getdel: (...args: unknown[]) => mockRedisGetdel(...args),
  },
}));

jest.mock('@db', () => ({
  db: {
    user: {
      findFirst: (...args: unknown[]) => mockUserFindFirst(...args),
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      create: (...args: unknown[]) => mockUserCreate(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    organization: {
      findFirst: (...args: unknown[]) => mockOrgFindFirst(...args),
    },
    session: {
      create: (...args: unknown[]) => mockSessionCreate(...args),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

describe('GideonOidcService authorizationCodeGrant verification', () => {
  let service: GideonOidcService;
  const OLD_ENV = { ...process.env };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, ...ENV };
    service = await createOidcService();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  function mockLinkedUser() {
    mockUserFindFirst.mockResolvedValue({
      id: 'usr_1',
      email: 'ada@example.com',
      gideonSub: null,
      banned: false,
    });
    mockUserUpdate.mockResolvedValue({ id: 'usr_1' });
  }

  it('passes the PKCE verifier, state, nonce, and redirect URI to the grant', async () => {
    mockSuccessfulExchange();
    mockLinkedUser();

    await service.handleCallback({ callbackUrl: CALLBACK_URL });

    // These args are the entire CSRF/replay protection of the flow. The
    // real checks live inside openid-client, so pin the wiring here.
    expect(mockAuthorizationCodeGrant).toHaveBeenCalledWith(
      'mock-config',
      new URL(CALLBACK_URL),
      {
        pkceCodeVerifier: 'verifier-123',
        expectedState: 'state-123',
        expectedNonce: 'nonce-123',
        idTokenExpected: true,
      },
      { redirect_uri: ENV.GIDEON_OIDC_REDIRECT_URI },
    );
  });

  it('uses the verifier and nonce stored for this state, not fresh ones', async () => {
    mockRedisGetdel.mockResolvedValue({
      codeVerifier: 'verifier-for-this-login',
      nonce: 'nonce-for-this-login',
      redirectTo: '/risks',
    });
    mockAuthorizationCodeGrant.mockResolvedValue({
      access_token: 'access-1',
      claims: () => ({ sub: 'gideon-sub-1' }),
    });
    mockFetchUserInfo.mockResolvedValue({
      sub: 'gideon-sub-1',
      email: 'ada@example.com',
      email_verified: true,
    });
    mockLinkedUser();

    await service.handleCallback({ callbackUrl: CALLBACK_URL });

    expect(mockAuthorizationCodeGrant).toHaveBeenCalledWith(
      'mock-config',
      expect.any(URL),
      expect.objectContaining({
        pkceCodeVerifier: 'verifier-for-this-login',
        expectedNonce: 'nonce-for-this-login',
      }),
      expect.anything(),
    );
  });

  it('fails closed when the library rejects the nonce/state check', async () => {
    mockRedisGetdel.mockResolvedValue({
      codeVerifier: 'verifier-123',
      nonce: 'nonce-123',
    });
    mockAuthorizationCodeGrant.mockRejectedValue(
      new Error('nonce mismatch, expected nonce-123'),
    );

    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toThrow('nonce mismatch');
    expect(mockUserFindFirst).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it('rejects a callback URL with no state before any exchange', async () => {
    await expect(
      service.handleCallback({
        callbackUrl: `${ENV.GIDEON_OIDC_REDIRECT_URI}?code=auth-code`,
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(mockAuthorizationCodeGrant).not.toHaveBeenCalled();
  });
});
