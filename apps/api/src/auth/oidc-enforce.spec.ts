import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OidcService } from './oidc.service';
import { EntitlementsDeniedError } from './oidc-entitlements';

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
jest.mock('./oidc-client', () => ({
  loadOidcClient: () => Promise.resolve(mockOidc),
}));

const mockRedisGetdel = jest.fn();
jest.mock('../redis/redis.client', () => ({
  redisClient: {
    set: jest.fn(),
    getdel: (...args: unknown[]) => mockRedisGetdel(...args),
    get: jest.fn(),
  },
}));

const mockUserFindFirst = jest.fn();
const mockUserFindMany = jest.fn();
// Expand-window fallbacks query tenant-blind candidates via findMany.
// Default to no candidates (clearAllMocks preserves implementations).
mockUserFindMany.mockResolvedValue([]);
// Expand-window fallbacks run a nulls-first raw lookup ($queryRaw).
// Default to no candidates, same as above.
const mockQueryRaw = jest.fn();
mockQueryRaw.mockResolvedValue([]);
const mockUserFindUnique = jest.fn();
const mockUserCreate = jest.fn();
const mockUserUpdate = jest.fn();
const mockMemberFindFirst = jest.fn();
const mockMemberUpdateMany = jest.fn();
const mockOrgFindUnique = jest.fn();
const mockOrgRoleFindMany = jest.fn();
const mockSessionCreate = jest.fn();
const mockTransaction = jest.fn();
const mockTxFindFirst = jest.fn();
const mockTxUpdate = jest.fn();
const mockTxCreate = jest.fn();
jest.mock('@db', () => ({
  normalizeEmail: jest.requireActual('@gideon-defender/email').normalizeEmail,
  db: {
    user: {
      findFirst: (...args: unknown[]) => mockUserFindFirst(...args),
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      create: (...args: unknown[]) => mockUserCreate(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    member: {
      findFirst: (...args: unknown[]) => mockMemberFindFirst(...args),
      updateMany: (...args: unknown[]) => mockMemberUpdateMany(...args),
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
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

const ENV = {
  OIDC_ISSUER_URL: 'http://localhost:8080',
  OIDC_CLIENT_ID: 'opencomp-dev',
  OIDC_REDIRECT_URI: 'http://localhost:3333/v1/auth/oidc/callback',
  OIDC_ENFORCEMENT_TENANTS: 'tenant-1',
};
const CALLBACK_URL = `${ENV.OIDC_REDIRECT_URI}?code=c&state=s`;

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', kid: 'k1' })}.${b64(payload)}.sig`;
}

describe('OidcService Phase 1 enforcement (pilot tenant)', () => {
  let service: OidcService;
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
    process.env = { ...OLD_ENV, ...ENV };
    delete process.env.OIDC_BOOTSTRAP_ENFORCED;
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
    mockUserFindUnique.mockResolvedValue(null);
    mockUserFindFirst.mockResolvedValue({
      id: 'usr_1',
      email: 'ada@example.com',
      gideonSub: null,
      banned: false,
      tenantId: 'tenant-1',
    });
    mockUserUpdate.mockResolvedValue({ id: 'usr_1' });
    mockOrgFindUnique.mockResolvedValue({ id: 'tenant-1' });
    mockOrgRoleFindMany.mockResolvedValue([]);
    mockMemberFindFirst.mockResolvedValue(null);
    mockMemberUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    mockTxFindFirst.mockResolvedValue(null);
    mockTxCreate.mockResolvedValue({ id: 'mem_new' });
    mockSessionCreate.mockResolvedValue({
      token: 'ses-token',
      expiresAt: new Date('2026-10-12T00:00:00Z'),
    });
    const module = await Test.createTestingModule({
      providers: [OidcService],
    }).compile();
    service = module.get(OidcService);
    service.resetCache();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('denies a role-less login with no session minted', async () => {
    mockExchange({ claims: { sub: 'sub-1' }, tid: 'tenant-1' });
    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toMatchObject({ reason: 'empty_entitlements' });
    expect(mockMemberUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'usr_1', organizationId: 'tenant-1' },
      data: { role: '', roleSource: 'sso', idpAccessRevoked: true },
    });
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('denies wrong-app entitlements with no session minted', async () => {
    mockExchange({
      claims: { sub: 'sub-1', entitlements: ['other-app-role'] },
      tid: 'tenant-1',
    });

    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toBeInstanceOf(EntitlementsDeniedError);
    expect(mockMemberUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it('reports a persistence failure instead of claiming a completed revocation', async () => {
    mockExchange({ claims: { sub: 'sub-1' }, tid: 'tenant-1' });
    mockMemberUpdateMany.mockRejectedValue(
      new Error('revocation write failed'),
    );
    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toThrow('revocation write failed');
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it('does not revoke cached membership when the tenant is unknown', async () => {
    mockExchange({
      claims: { sub: 'sub-1', entitlements: ['admin'] },
      tid: 'tenant-1',
    });
    mockOrgFindUnique.mockResolvedValue(null);
    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toMatchObject({ reason: 'unknown_tenant' });
    expect(mockMemberUpdateMany).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it('provisions the SSO member and mints a session on valid assignment', async () => {
    mockExchange({
      claims: { sub: 'sub-1', entitlements: ['admin'] },
      tid: 'tenant-1',
    });

    const result = await service.handleCallback({ callbackUrl: CALLBACK_URL });

    expect(mockTxCreate).toHaveBeenCalledWith({
      data: {
        userId: 'usr_1',
        organizationId: 'tenant-1',
        role: 'admin',
        roleSource: 'sso',
        idpAccessRevoked: false,
      },
    });
    expect(mockSessionCreate).toHaveBeenCalled();
    expect(result.sessionToken).toBe('ses-token');
  });

  it('overwrites a stale local owner with the IdP employee set', async () => {
    mockExchange({
      claims: { sub: 'sub-1', entitlements: ['employee'] },
      tid: 'tenant-1',
    });
    mockTxFindFirst.mockResolvedValue({ id: 'mem_1' });
    mockTxUpdate.mockResolvedValue({ id: 'mem_1' });

    await service.handleCallback({ callbackUrl: CALLBACK_URL });

    expect(mockTxUpdate).toHaveBeenCalledWith({
      where: { id: 'mem_1' },
      data: { role: 'employee', roleSource: 'sso', idpAccessRevoked: false },
    });
    expect(mockSessionCreate).toHaveBeenCalled();
  });

  it('keeps identity gates first: unverified email never reaches enforce', async () => {
    mockExchange({ claims: { sub: 'sub-1' }, tid: 'tenant-1' });
    mockFetchUserInfo.mockResolvedValue({
      sub: 'sub-1',
      email: 'ada@example.com',
      email_verified: false,
    });

    const error: unknown = await service
      .handleCallback({ callbackUrl: CALLBACK_URL })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error).not.toBeInstanceOf(EntitlementsDeniedError);
    expect(mockMemberUpdateMany).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it('fails closed with no session when role lookup fails', async () => {
    mockExchange({
      claims: { sub: 'sub-1', entitlements: ['admin'] },
      tid: 'tenant-1',
    });
    mockOrgRoleFindMany.mockRejectedValue(new Error('db down'));

    const error: unknown = await service
      .handleCallback({ callbackUrl: CALLBACK_URL })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(EntitlementsDeniedError);
    expect(mockMemberUpdateMany).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'handles a non-pilot tenant with all-tenant mode=%s',
    async (allTenants) => {
      process.env.OIDC_ENFORCEMENT_ALL_TENANTS = String(allTenants);
      mockExchange({ claims: { sub: 'sub-1' }, tid: 'tenant-9' });
      mockOrgFindUnique.mockResolvedValue({ id: 'tenant-9' });
      mockUserFindFirst.mockResolvedValue({
        id: 'usr_1',
        email: 'ada@example.com',
        gideonSub: null,
        banned: false,
        tenantId: 'tenant-9',
      });
      if (allTenants) {
        await expect(
          service.handleCallback({ callbackUrl: CALLBACK_URL }),
        ).rejects.toBeInstanceOf(EntitlementsDeniedError);
        expect(mockSessionCreate).not.toHaveBeenCalled();
        return;
      }
      const result = await service.handleCallback({
        callbackUrl: CALLBACK_URL,
      });
      expect(result.sessionToken).toBe('ses-token');
      expect(mockMemberUpdateMany).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
    },
  );
});
