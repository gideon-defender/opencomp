import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  CALLBACK_URL,
  createOidcService,
  ENV,
  mockAuthorizationCodeGrant,
  mockFetchUserInfo,
  mockOidc,
  mockOrgFindFirst,
  mockRedisGet,
  mockRedisGetdel,
  mockSessionCreate,
  mockSuccessfulExchange,
  mockUserCreate,
  mockUserFindFirst,
  mockUserFindMany,
  mockQueryRaw,
  mockUserUpdate,
} from './oidc.service.fixtures';
import { OidcService } from './oidc.service';
import {
  LEGACY_OIDC_STATE_KEY_PREFIX,
  OIDC_STATE_KEY_PREFIX,
} from './oidc-callback';

// openid-client v6 is ESM-only and loaded via dynamic import() inside
// oidc-client — mock the loader statically instead.
jest.mock('./oidc-client', () => ({
  loadOidcClient: () => Promise.resolve(mockOidc),
}));

jest.mock('../redis/redis.client', () => ({
  redisClient: {
    set: jest.fn(),
    get: (...args: unknown[]) => mockRedisGet(...args),
    getdel: (...args: unknown[]) => mockRedisGetdel(...args),
  },
}));

jest.mock('@db', () => ({
  normalizeEmail: jest.requireActual('@gideon-defender/email').normalizeEmail,
  db: {
    user: {
      findFirst: (...args: unknown[]) => mockUserFindFirst(...args),
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
      findUnique: jest.fn(),
      create: (...args: unknown[]) => mockUserCreate(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    member: {
      findFirst: async () => ({ id: 'mem_1' }),
    },
    organization: {
      findFirst: (...args: unknown[]) => mockOrgFindFirst(...args),
      findUnique: async () => ({ id: 'org_1' }),
    },
    session: {
      create: (...args: unknown[]) => mockSessionCreate(...args),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

describe('OidcService.handleCallback negatives', () => {
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

  it('rejects a callback URL with no state param', async () => {
    await expect(
      service.handleCallback({
        callbackUrl: `${ENV.OIDC_REDIRECT_URI}?code=auth-code`,
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(mockRedisGetdel).not.toHaveBeenCalled();
  });

  it('rejects an expired or unknown login state', async () => {
    mockRedisGetdel.mockResolvedValue(null);

    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toThrow('Invalid or expired login state');
    expect(mockAuthorizationCodeGrant).not.toHaveBeenCalled();
  });

  it('resolves state written under the legacy prefix (pre-deploy login)', async () => {
    mockSuccessfulExchange();
    mockUserFindFirst.mockResolvedValue({
      id: 'u_1',
      banned: false,
      gideonSub: null,
      tenantId: 'org_1',
    });
    mockUserUpdate.mockResolvedValue({ id: 'u_1' });
    // First read (new prefix) misses; second read (legacy prefix) hits via
    // the default set by mockSuccessfulExchange.
    mockRedisGetdel.mockResolvedValueOnce(null);

    const result = await service.handleCallback({ callbackUrl: CALLBACK_URL });

    expect(mockRedisGetdel).toHaveBeenNthCalledWith(
      1,
      `${OIDC_STATE_KEY_PREFIX}state-123`,
    );
    expect(mockRedisGetdel).toHaveBeenNthCalledWith(
      2,
      `${LEGACY_OIDC_STATE_KEY_PREFIX}state-123`,
    );
    expect(result.sessionToken).toBe('ses-token');
  });

  it('surfaces a failed code exchange instead of minting a session', async () => {
    mockRedisGetdel.mockResolvedValue({
      codeVerifier: 'verifier-123',
      nonce: 'nonce-123',
    });
    mockAuthorizationCodeGrant.mockRejectedValue(
      new Error('invalid_grant: PKCE verification failed'),
    );

    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toThrow('PKCE verification failed');
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it('rejects an incomplete token response without an access token', async () => {
    mockRedisGetdel.mockResolvedValue({
      codeVerifier: 'verifier-123',
      nonce: 'nonce-123',
    });
    mockAuthorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: 'gideon-sub-1' }),
    });

    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toThrow('Incomplete token response');
    expect(mockFetchUserInfo).not.toHaveBeenCalled();
  });

  it('rejects an incomplete token response without a subject', async () => {
    mockRedisGetdel.mockResolvedValue({
      codeVerifier: 'verifier-123',
      nonce: 'nonce-123',
    });
    mockAuthorizationCodeGrant.mockResolvedValue({
      access_token: 'access-1',
      claims: () => ({}),
    });

    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toThrow('Incomplete token response');
  });

  it('rejects an account with no email address', async () => {
    mockRedisGetdel.mockResolvedValue({
      codeVerifier: 'verifier-123',
      nonce: 'nonce-123',
    });
    mockAuthorizationCodeGrant.mockResolvedValue({
      access_token: 'access-1',
      claims: () => ({ sub: 'gideon-sub-1' }),
    });
    mockFetchUserInfo.mockResolvedValue({
      sub: 'gideon-sub-1',
      email_verified: true,
    });

    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockUserFindFirst).not.toHaveBeenCalled();
  });

  it('rejects a non-string email claim', async () => {
    mockRedisGetdel.mockResolvedValue({
      codeVerifier: 'verifier-123',
      nonce: 'nonce-123',
    });
    mockAuthorizationCodeGrant.mockResolvedValue({
      access_token: 'access-1',
      claims: () => ({ sub: 'gideon-sub-1' }),
    });
    mockFetchUserInfo.mockResolvedValue({
      sub: 'gideon-sub-1',
      email: 42,
      email_verified: true,
    });

    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toThrow('no email address');
  });
});

describe('OidcService.peekStoredRedirect', () => {
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

  it('returns the stored return target without consuming state', async () => {
    mockRedisGet.mockResolvedValue({ redirectTo: '/risks' });

    await expect(service.peekStoredRedirect('state-123')).resolves.toBe(
      '/risks',
    );
    expect(mockRedisGetdel).not.toHaveBeenCalled();
  });

  it('returns undefined for unknown state', async () => {
    mockRedisGet.mockResolvedValue(null);

    await expect(service.peekStoredRedirect('nope')).resolves.toBeUndefined();
  });

  it('peek falls back to the legacy key for pre-deploy logins', async () => {
    mockRedisGet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ redirectTo: '/portal-home' });

    await expect(service.peekStoredRedirect('state-123')).resolves.toBe(
      '/portal-home',
    );
    expect(mockRedisGet).toHaveBeenNthCalledWith(
      1,
      `${OIDC_STATE_KEY_PREFIX}state-123`,
    );
    expect(mockRedisGet).toHaveBeenNthCalledWith(
      2,
      `${LEGACY_OIDC_STATE_KEY_PREFIX}state-123`,
    );
  });

  it('returns undefined when Redis is unavailable', async () => {
    mockRedisGet.mockRejectedValue(new Error('redis down'));

    await expect(
      service.peekStoredRedirect('state-123'),
    ).resolves.toBeUndefined();
  });

  it('does not break the real exchange (state stays single-use)', async () => {
    mockRedisGet.mockResolvedValue({ redirectTo: '/risks' });
    mockSuccessfulExchange();
    mockUserFindFirst.mockResolvedValue({
      id: 'u_1',
      banned: false,
      gideonSub: null,
      tenantId: 'org_1',
    });
    mockUserUpdate.mockResolvedValue({ id: 'u_1' });

    const result = await service.handleCallback({ callbackUrl: CALLBACK_URL });

    expect(result.redirectTo).toBe('/risks');
    expect(mockRedisGetdel).toHaveBeenCalled();
  });
});
