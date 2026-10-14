import { UnauthorizedException } from '@nestjs/common';
import {
  CALLBACK_URL,
  createOidcService,
  ENV,
  mockAuthorizationCodeGrant,
  mockOidc,
  mockRedisGetdel,
  mockSessionCreate,
  mockSuccessfulExchange,
  mockUserFindUnique,
  mockUserUpdate,
  mockUserCreate,
  mockOrgFindFirst,
} from './gideon-oidc.service.fixtures';

jest.mock('./gideon-oidc-client', () => ({
  loadOidcClient: () => Promise.resolve(mockOidc),
}));
jest.mock('../redis/redis.client', () => ({
  redisClient: { getdel: (...args: unknown[]) => mockRedisGetdel(...args) },
}));
const mockAudit = jest.fn();
jest.mock('./gideon-oidc-entitlements', () => ({
  ...jest.requireActual<typeof import('./gideon-oidc-entitlements')>(
    './gideon-oidc-entitlements',
  ),
  auditOidcEntitlements: (...args: unknown[]) => mockAudit(...args),
}));
jest.mock('@db', () => ({
  normalizeEmail: jest.requireActual('@gideon-defender/email').normalizeEmail,
  db: {
    user: {
      findFirst: async () => null,
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
      create: (...args: unknown[]) => mockUserCreate(...args),
    },
    organization: {
      findFirst: (...args: unknown[]) => mockOrgFindFirst(...args),
    },
    session: { create: (...args: unknown[]) => mockSessionCreate(...args) },
  },
}));

describe('OIDC invalid tenant claims with all-tenant enforcement', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      ...ENV,
      GIDEON_ENFORCEMENT_ALL_TENANTS: 'true',
    };
    delete process.env.GIDEON_BOOTSTRAP_ENFORCED;
    mockSuccessfulExchange();
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_existing',
      email: 'ada@example.com',
      gideonSub: 'gideon-sub-1',
      tenantId: 'tenant_a',
      banned: false,
    });
    mockUserUpdate.mockResolvedValue({ id: 'usr_existing' });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it.each([
    { tid: 'tenant_a', tenant_id: 'tenant_b' },
    { tid: 'tenant_a', tenantId: 42 },
    { tid: 'tenant_a', organizationId: '   ' },
  ])('denies %j before any identity/session write', async (tenantClaims) => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    mockAuthorizationCodeGrant.mockResolvedValue({
      access_token: `${encode({ alg: 'RS256', kid: 'k1' })}.${encode({
        sub: 'gideon-sub-1',
        ...tenantClaims,
      })}.sig`,
      claims: () => ({ sub: 'gideon-sub-1', entitlements: [] }),
    });
    const service = await createOidcService();
    await expect(
      service.handleCallback({ callbackUrl: CALLBACK_URL }),
    ).rejects.toThrow(UnauthorizedException);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockUserCreate).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });
});
