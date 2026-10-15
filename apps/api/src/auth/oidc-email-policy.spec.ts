import {
  CALLBACK_URL,
  createOidcService,
  ENV,
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
    delete process.env.OIDC_REQUIRE_EMAIL_VERIFIED;
    delete process.env.GIDEON_REQUIRE_EMAIL_VERIFIED;
    service = await createOidcService();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  describe('claims policy (generic-oidc-readiness §5.4)', () => {
    const callbackUrl = CALLBACK_URL;

    function provisionedUser() {
      mockUserFindFirst.mockResolvedValue({
        id: 'usr_1',
        email: 'ada@example.com',
        oidcSub: null,
        banned: false,
        tenantId: 'org_1',
      });
      mockUserUpdate.mockResolvedValue({ id: 'usr_1' });
    }

    it('denies an unverified email by default', async () => {
      mockSuccessfulExchange();
      mockFetchUserInfo.mockResolvedValue({
        sub: 'gideon-sub-1',
        email: 'ada@example.com',
        email_verified: false,
        name: 'Ada',
      });

      await expect(service.handleCallback({ callbackUrl })).rejects.toThrow(
        'not verified',
      );
      expect(mockSessionCreate).not.toHaveBeenCalled();
    });

    it('rejects explicit unverified email even with the opt-out enabled', async () => {
      process.env.OIDC_REQUIRE_EMAIL_VERIFIED = 'false';
      mockSuccessfulExchange();
      mockFetchUserInfo.mockResolvedValue({
        sub: 'gideon-sub-1',
        email: 'ada@example.com',
        email_verified: false,
        name: 'Ada',
      });
      provisionedUser();

      await expect(service.handleCallback({ callbackUrl })).rejects.toThrow(
        'not verified',
      );
      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockSessionCreate).not.toHaveBeenCalled();
    });

    it.each([
      null,
      {
        id: 'victim',
        email: 'ada@example.com',
        tenantId: 'org_1',
        oidcSub: null,
      },
    ])(
      'blocks an unverified email from linking tenant or expand-window accounts (%j)',
      async (existing) => {
        process.env.OIDC_REQUIRE_EMAIL_VERIFIED = 'false';
        mockSuccessfulExchange();
        mockFetchUserInfo.mockResolvedValue({
          sub: 'gideon-sub-1',
          email: 'ada@example.com',
        });
        mockUserFindFirst.mockResolvedValue(existing);
        mockQueryRaw.mockResolvedValue([
          {
            id: 'victim',
            email: 'ada@example.com',
            tenantId: null,
            oidcSub: null,
          },
        ]);

        await expect(service.handleCallback({ callbackUrl })).rejects.toThrow(
          'Verified email required',
        );
        expect(mockUserFindFirst).not.toHaveBeenCalled();
        expect(mockQueryRaw).not.toHaveBeenCalled();
        expect(mockUserCreate).not.toHaveBeenCalled();
        expect(mockUserUpdate).not.toHaveBeenCalled();
        expect(mockSessionCreate).not.toHaveBeenCalled();
      },
    );

    it('allows a linked subject without adopting an unverified changed email', async () => {
      process.env.OIDC_REQUIRE_EMAIL_VERIFIED = 'false';
      mockSuccessfulExchange();
      mockFetchUserInfo.mockResolvedValue({
        sub: 'gideon-sub-1',
        email: 'changed@example.com',
      });
      mockUserFindUnique.mockResolvedValue({
        id: 'usr_1',
        email: 'ada@example.com',
        tenantId: 'org_1',
        oidcSub: 'gideon-sub-1',
        banned: false,
      });
      mockUserUpdate.mockResolvedValue({
        id: 'usr_1',
        email: 'ada@example.com',
      });

      const result = await service.handleCallback({ callbackUrl });

      expect(result.sessionToken).toBe('ses-token');
      expect(mockUserFindFirst).not.toHaveBeenCalled();
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
        data: { lastLogin: expect.any(Date), oidcTenantId: 'org_1' },
      });
    });
  });
});
