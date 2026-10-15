import {
  CALLBACK_URL,
  createOidcService,
  ENV,
  mockAuthorizationCodeGrant,
  mockFetchUserInfo,
  mockMemberFindFirst,
  mockOidc,
  mockOrgFindFirst,
  mockOrgFindUnique,
  mockRedisGetdel,
  mockRedisSet,
  mockSessionCreate,
  mockSuccessfulExchange,
  mockUserCreate,
  mockUserFindFirst,
  mockUserFindMany,
  mockQueryRaw,
  mockUserFindUnique,
  mockUserUpdate,
} from './oidc.service.fixtures';
import { OidcService } from './oidc.service';

// openid-client v6 is ESM-only and loaded via dynamic import() inside
// oidc-client — mock the loader statically instead.
jest.mock('./oidc-client', () => ({
  loadOidcClient: () => Promise.resolve(mockOidc),
}));

const mockAuditOidcEntitlements = jest.fn();
jest.mock('./oidc-entitlements', () => ({
  ...jest.requireActual<typeof import('./oidc-entitlements')>(
    './oidc-entitlements',
  ),
  auditOidcEntitlements: (...args: unknown[]) =>
    mockAuditOidcEntitlements(...args),
}));
jest.mock('./oidc-gates', () => ({
  // Phase 1 additions: default to audit mode so these legacy tests keep
  // their pass-through semantics (dedicated enforce specs cover the rest).
  isEnforcementEnabledFor: () => false,
  isBootstrapEnforced: () => false,
}));

jest.mock('../redis/redis.client', () => ({
  redisClient: {
    set: (...args: unknown[]) => mockRedisSet(...args),
    getdel: (...args: unknown[]) => mockRedisGetdel(...args),
  },
}));

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
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    member: {
      findFirst: (...args: unknown[]) => mockMemberFindFirst(...args),
    },
    organization: {
      findFirst: (...args: unknown[]) => mockOrgFindFirst(...args),
      findUnique: (...args: unknown[]) => mockOrgFindUnique(...args),
    },
    session: {
      create: (...args: unknown[]) => mockSessionCreate(...args),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

describe('OidcService', () => {
  let service: OidcService;
  const OLD_ENV = { ...process.env };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuditOidcEntitlements.mockResolvedValue({
      presented: [],
      matched: [],
      unmatched: [],
      wouldDeny: false,
    });
    process.env = { ...OLD_ENV, ...ENV };
    service = await createOidcService();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  describe('handleCallback', () => {
    const callbackUrl = CALLBACK_URL;

    it('links gideonSub on an existing user and mints a session', async () => {
      mockSuccessfulExchange();
      mockUserFindFirst.mockResolvedValue({
        id: 'usr_1',
        email: 'ada@example.com',
        gideonSub: null,
        banned: false,
        tenantId: 'org_1',
      });
      mockUserUpdate.mockResolvedValue({ id: 'usr_1' });

      const result = await service.handleCallback({ callbackUrl });

      expect(mockFetchUserInfo).toHaveBeenCalledWith(
        'mock-config',
        expect.any(String),
        'gideon-sub-1',
      );
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'usr_1', AND: { gideonSub: null } },
        data: expect.objectContaining({ gideonSub: 'gideon-sub-1' }),
      });
      expect(mockSessionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'usr_1',
          activeOrganizationId: 'org_1',
          gideonRefreshToken: 'refresh-1',
        }),
      });
      expect(result.sessionToken).toBe('ses-token');
      expect(result.redirectTo).toBe('/risks');
    });

    it('runs the Phase 0 entitlements audit with the login identity', async () => {
      mockSuccessfulExchange();
      mockUserFindFirst.mockResolvedValue({
        id: 'usr_1',
        email: 'ada@example.com',
        gideonSub: null,
        banned: false,
        tenantId: 'org_1',
      });
      mockUserUpdate.mockResolvedValue({ id: 'usr_1' });

      await service.handleCallback({ callbackUrl });

      expect(mockAuditOidcEntitlements).toHaveBeenCalledWith(
        expect.objectContaining({
          claims: { sub: 'gideon-sub-1' },
          userId: 'usr_1',
          email: 'ada@example.com',
        }),
      );
    });

    it('still mints a session when the audit would deny (audit never blocks login)', async () => {
      mockSuccessfulExchange();
      mockUserFindFirst.mockResolvedValue({
        id: 'usr_1',
        email: 'ada@example.com',
        gideonSub: null,
        banned: false,
        tenantId: 'org_1',
      });
      mockUserUpdate.mockResolvedValue({ id: 'usr_1' });
      mockAuditOidcEntitlements.mockResolvedValue({
        presented: [],
        matched: [],
        unmatched: [],
        wouldDeny: true,
        reason: 'empty_entitlements',
      });

      const result = await service.handleCallback({ callbackUrl });

      expect(result.sessionToken).toBe('ses-token');
      expect(mockSessionCreate).toHaveBeenCalled();
    });

    it('stamps the login tenant on the user row', async () => {
      const b64 = (o: unknown) =>
        Buffer.from(JSON.stringify(o)).toString('base64url');
      const accessToken = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({
        sub: 'gideon-sub-1',
        tid: 'tenant-9',
      })}.sig`;
      mockSuccessfulExchange();
      mockAuthorizationCodeGrant.mockResolvedValue({
        access_token: accessToken,
        refresh_token: 'refresh-1',
        claims: () => ({ sub: 'gideon-sub-1' }),
      });
      mockUserFindFirst.mockResolvedValue({
        id: 'usr_1',
        email: 'ada@example.com',
        gideonSub: null,
        banned: false,
        tenantId: 'tenant-9',
      });
      mockUserUpdate.mockResolvedValue({ id: 'usr_1' });

      await service.handleCallback({ callbackUrl });

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'usr_1', AND: { gideonSub: null } },
        data: expect.objectContaining({ gideonTenantId: 'tenant-9' }),
      });
    });

    it('points the minted session at the tenant org (tid == org id)', async () => {
      const b64 = (o: unknown) =>
        Buffer.from(JSON.stringify(o)).toString('base64url');
      const accessToken = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({
        sub: 'gideon-sub-1',
        tid: 'tenant-9',
      })}.sig`;
      mockSuccessfulExchange();
      mockAuthorizationCodeGrant.mockResolvedValue({
        access_token: accessToken,
        refresh_token: 'refresh-1',
        claims: () => ({ sub: 'gideon-sub-1' }),
      });
      mockUserFindFirst.mockResolvedValue({
        id: 'usr_1',
        email: 'ada@example.com',
        gideonSub: null,
        banned: false,
        tenantId: 'tenant-9',
      });
      mockUserUpdate.mockResolvedValue({ id: 'usr_1' });
      // The tenant IS the org: org id equals the tid and the user belongs
      // to it — the session's active org follows the tenant.
      mockOrgFindUnique.mockResolvedValue({ id: 'tenant-9' });
      mockMemberFindFirst.mockResolvedValue({ id: 'mem_1' });

      await service.handleCallback({ callbackUrl });

      expect(mockSessionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          activeOrganizationId: 'tenant-9',
        }),
      });
    });
  });
});
