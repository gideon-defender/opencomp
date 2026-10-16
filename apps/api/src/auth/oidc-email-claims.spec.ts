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

    it('falls back to the ID-token email when userinfo omits email', async () => {
      const b64 = (o: unknown) =>
        Buffer.from(JSON.stringify(o)).toString('base64url');
      const accessToken = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({
        sub: 'gideon-sub-1',
        tid: 'org_1',
      })}.sig`;
      mockSuccessfulExchange();
      mockAuthorizationCodeGrant.mockResolvedValue({
        access_token: accessToken,
        refresh_token: 'refresh-1',
        claims: () => ({
          sub: 'gideon-sub-1',
          email: 'ada@example.com',
          email_verified: true,
        }),
      });
      // Realistic fallback fixture: IdPs that omit email from userinfo omit
      // its flag too — verification travels with the email in the ID token.
      mockFetchUserInfo.mockResolvedValue({
        sub: 'gideon-sub-1',
        name: 'Ada',
      });
      provisionedUser();

      const result = await service.handleCallback({ callbackUrl });

      expect(result.email).toBe('ada@example.com');
      expect(result.sessionToken).toBe('ses-token');
    });

    it('denies fallback to an unverified ID-token email by default', async () => {
      const b64 = (o: unknown) =>
        Buffer.from(JSON.stringify(o)).toString('base64url');
      const accessToken = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({
        sub: 'gideon-sub-1',
        tid: 'org_1',
      })}.sig`;
      mockSuccessfulExchange();
      mockAuthorizationCodeGrant.mockResolvedValue({
        access_token: accessToken,
        refresh_token: 'refresh-1',
        claims: () => ({
          sub: 'gideon-sub-1',
          email: 'ada@example.com',
          email_verified: false,
        }),
      });
      mockFetchUserInfo.mockResolvedValue({
        sub: 'gideon-sub-1',
        name: 'Ada',
      });

      await expect(service.handleCallback({ callbackUrl })).rejects.toThrow(
        'not verified',
      );
      expect(mockSessionCreate).not.toHaveBeenCalled();
    });

    it('trusts the userinfo flag when both sources disagree (userinfo verified wins)', async () => {
      const b64 = (o: unknown) =>
        Buffer.from(JSON.stringify(o)).toString('base64url');
      const accessToken = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({
        sub: 'gideon-sub-1',
        tid: 'org_1',
      })}.sig`;
      mockSuccessfulExchange();
      mockAuthorizationCodeGrant.mockResolvedValue({
        access_token: accessToken,
        refresh_token: 'refresh-1',
        claims: () => ({
          sub: 'gideon-sub-1',
          email: 'ada@example.com',
          email_verified: false,
        }),
      });
      mockFetchUserInfo.mockResolvedValue({
        sub: 'gideon-sub-1',
        email: 'ada@example.com',
        email_verified: true,
        name: 'Ada',
      });
      provisionedUser();

      const result = await service.handleCallback({ callbackUrl });

      expect(result.sessionToken).toBe('ses-token');
    });

    it('denies when userinfo is unverified even if the ID token is verified', async () => {
      const b64 = (o: unknown) =>
        Buffer.from(JSON.stringify(o)).toString('base64url');
      const accessToken = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({
        sub: 'gideon-sub-1',
        tid: 'org_1',
      })}.sig`;
      mockSuccessfulExchange();
      mockAuthorizationCodeGrant.mockResolvedValue({
        access_token: accessToken,
        refresh_token: 'refresh-1',
        claims: () => ({
          sub: 'gideon-sub-1',
          email: 'ada@example.com',
          email_verified: true,
        }),
      });
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
  });
});
