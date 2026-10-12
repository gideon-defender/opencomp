import { Test } from '@nestjs/testing';
import { GideonOidcService } from './gideon-oidc.service';
import { EntitlementsDeniedError } from './gideon-oidc-entitlements';

// Module-scope mocks referenced by the hoisted @db factory below.
const mockDiscovery = jest.fn();
const mockAuthorizationCodeGrant = jest.fn();
const mockFetchUserInfo = jest.fn();
const mockOidc = {
  discovery: (...args: unknown[]) => mockDiscovery(...args),
  buildAuthorizationUrl: jest.fn(),
  authorizationCodeGrant: (...args: unknown[]) =>
    mockAuthorizationCodeGrant(...args),
  fetchUserInfo: (...args: unknown[]) => mockFetchUserInfo(...args),
  tokenRevocation: jest.fn(),
  randomPKCECodeVerifier: () => 'verifier-123',
  calculatePKCECodeChallenge: () => Promise.resolve('challenge-123'),
  randomState: () => 'state-123',
  randomNonce: () => 'nonce-123',
  allowInsecureRequests: jest.fn(),
};
jest.mock('./gideon-oidc-client', () => ({
  loadOidcClient: () => Promise.resolve(mockOidc),
}));

const mockRedisGetdel = jest.fn();
const mockRedisSet = jest.fn();
jest.mock('../redis/redis.client', () => ({
  redisClient: {
    set: (...args: unknown[]) => mockRedisSet(...args),
    getdel: (...args: unknown[]) => mockRedisGetdel(...args),
    get: jest.fn(),
  },
}));

const mockUserFindFirst = jest.fn();
const mockUserUpdate = jest.fn();
const mockMemberFindFirst = jest.fn();
const mockOrgFindUnique = jest.fn();
const mockOrgRoleFindMany = jest.fn();
const mockSessionCreate = jest.fn();
const mockTransaction = jest.fn();
const mockTxFindFirst = jest.fn();
const mockTxUpdate = jest.fn();
const mockTxCreate = jest.fn();
jest.mock('@db', () => ({
  db: {
    user: {
      findFirst: (...args: unknown[]) => mockUserFindFirst(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    member: {
      findFirst: (...args: unknown[]) => mockMemberFindFirst(...args),
    },
    organization: {
      findUnique: (...args: unknown[]) => mockOrgFindUnique(...args),
    },
    organizationRole: {
      findMany: (...args: unknown[]) => mockOrgRoleFindMany(...args),
    },
    session: {
      create: (...args: unknown[]) => mockSessionCreate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

const ENV = {
  GIDEON_IDENTITY_URL: 'http://localhost:8080',
  GIDEON_OIDC_CLIENT_ID: 'opencomp-dev',
  GIDEON_OIDC_REDIRECT_URI: 'http://localhost:3333/v1/auth/gideon/callback',
  GIDEON_ENFORCEMENT_TENANTS: 'tenant-1',
};
const CALLBACK_URL = `${ENV.GIDEON_OIDC_REDIRECT_URI}?code=c&state=s`;

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', kid: 'k1' })}.${b64(payload)}.sig`;
}

describe('GideonOidcService bootstrap gate (unknown tenants)', () => {
  let service: GideonOidcService;
  const OLD_ENV = { ...process.env };

  function mockExchange({
    claims,
    tid,
  }: {
    claims: Record<string, unknown>;
    tid?: string;
  }) {
    mockRedisGetdel.mockResolvedValue({
      codeVerifier: 'verifier-123',
      nonce: 'nonce-123',
    });
    mockAuthorizationCodeGrant.mockResolvedValue({
      access_token: tid ? jwt({ sub: 'sub-1', tid }) : 'opaque-token',
      refresh_token: 'refresh-1',
      claims: () => claims,
    });
    mockFetchUserInfo.mockResolvedValue({
      sub: 'sub-1',
      email: 'ada@example.com',
      email_verified: true,
      name: 'Ada',
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = {
      ...OLD_ENV,
      ...ENV,
      GIDEON_BOOTSTRAP_ENFORCED: 'true',
    };
    mockDiscovery.mockResolvedValue('mock-config');
    mockTransaction.mockImplementation((fn: unknown) =>
      (fn as (tx: unknown) => unknown)({
        member: {
          findFirst: (...a: unknown[]) => mockTxFindFirst(...a),
          update: (...a: unknown[]) => mockTxUpdate(...a),
          create: (...a: unknown[]) => mockTxCreate(...a),
        },
      }),
    );
    mockUserFindFirst.mockResolvedValue({
      id: 'usr_1',
      email: 'ada@example.com',
      gideonSub: null,
      banned: false,
    });
    mockUserUpdate.mockResolvedValue({ id: 'usr_1' });
    mockOrgFindUnique.mockResolvedValue(null);
    mockOrgRoleFindMany.mockResolvedValue([]);
    mockMemberFindFirst.mockResolvedValue(null);
    mockTxFindFirst.mockResolvedValue(null);
    mockSessionCreate.mockResolvedValue({
      id: 'ses_1',
      token: 'ses-token',
      expiresAt: new Date('2026-10-12T00:00:00Z'),
    });
    const module = await Test.createTestingModule({
      providers: [GideonOidcService],
    }).compile();
    service = module.get(GideonOidcService);
    service.resetCache();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('admits an unknown tenant carrying a verified owner assignment', async () => {
    mockExchange({
      claims: { sub: 'sub-1', entitlements: ['owner'] },
      tid: 'tenant-new',
    });

    const result = await service.handleCallback({ callbackUrl: CALLBACK_URL });

    expect(result.sessionToken).toBe('ses-token');
    // No org row exists, so no member row can be written yet.
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockRedisSet).toHaveBeenCalledWith(
      'app:gideon-bootstrap:ses_1',
      { userId: 'usr_1', tenantId: 'tenant-new' },
      { ex: expect.any(Number) },
    );
  });

  it('denies an unknown tenant without an owner assignment', async () => {
    mockExchange({
      claims: { sub: 'sub-1', entitlements: ['employee'] },
      tid: 'tenant-new',
    });

    const error: unknown = await service
      .handleCallback({ callbackUrl: CALLBACK_URL })
      .catch((err: unknown) => err);

    if (!(error instanceof EntitlementsDeniedError)) {
      throw new Error('expected EntitlementsDeniedError');
    }
    expect(error.reason).toBe('no_owner_bootstrap');
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('stays in audit mode for unknown tenants when bootstrap is off', async () => {
    delete process.env.GIDEON_BOOTSTRAP_ENFORCED;
    mockExchange({ claims: { sub: 'sub-1' }, tid: 'tenant-new' });

    const result = await service.handleCallback({ callbackUrl: CALLBACK_URL });

    expect(result.sessionToken).toBe('ses-token');
  });

  it('fails closed (no deny, raw error) when the tenant lookup fails', async () => {
    mockOrgFindUnique.mockRejectedValue(new Error('db down'));
    mockExchange({ claims: { sub: 'sub-1' }, tid: 'tenant-new' });

    const error: unknown = await service
      .handleCallback({ callbackUrl: CALLBACK_URL })
      .catch((err: unknown) => err);

    // Infrastructure errors stay distinct from assignment denials.
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(EntitlementsDeniedError);
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when evaluation fails after a confirmed-unknown tenant', async () => {
    // First lookup (tenant check) confirms the tenant is unknown; the
    // second lookup (claim evaluation) fails. The raw error must propagate
    // as-is — never downgraded to a deny, and with no session minted.
    mockOrgFindUnique
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('db down'));
    mockExchange({ claims: { sub: 'sub-1' }, tid: 'tenant-new' });

    const error: unknown = await service
      .handleCallback({ callbackUrl: CALLBACK_URL })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(EntitlementsDeniedError);
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
  it('fails closed when only the first tenant lookup fails', async () => {
    mockOrgFindUnique.mockRejectedValueOnce(
      new Error('temporary lookup failure'),
    );
    mockExchange({ claims: { sub: 'sub-1' }, tid: 'tenant-new' });
    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toThrow('temporary lookup failure');
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it('preserves the existing session tenant after a denied callback', async () => {
    const existingUser = {
      id: 'usr_1',
      email: 'ada@example.com',
      gideonSub: 'sub-1',
      gideonTenantId: 'tenant-existing',
      banned: false,
    };
    mockUserFindFirst.mockResolvedValue(existingUser);
    mockUserUpdate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(existingUser, data);
        return Promise.resolve(existingUser);
      },
    );
    mockExchange({
      claims: { sub: 'sub-1', entitlements: ['employee'] },
      tid: 'tenant-new',
    });
    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toBeInstanceOf(EntitlementsDeniedError);
    expect(existingUser.gideonTenantId).toBe('tenant-existing');
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });
});
