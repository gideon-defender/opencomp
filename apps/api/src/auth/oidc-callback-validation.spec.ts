import {
  CALLBACK_URL,
  createOidcService,
  ENV,
  mockAuthorizationCodeGrant,
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
import { OIDC_STATE_KEY_PREFIX } from './oidc-callback';

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

  describe('tenant-claim rejection (fail closed before provisioning)', () => {
    const callbackUrl = CALLBACK_URL;
    const b64 = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');

    it('rejects conflicting tenant claims without provisioning a user', async () => {
      const accessToken = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({
        sub: 'gideon-sub-1',
        tid: 'org_a',
        tenant_id: 'org_b',
      })}.sig`;
      mockSuccessfulExchange();
      mockAuthorizationCodeGrant.mockResolvedValue({
        access_token: accessToken,
        refresh_token: 'refresh-1',
        claims: () => ({ sub: 'gideon-sub-1' }),
      });

      await expect(service.handleCallback({ callbackUrl })).rejects.toThrow(
        'conflicting tenant claims',
      );
      expect(mockUserFindFirst).not.toHaveBeenCalled();
      expect(mockSessionCreate).not.toHaveBeenCalled();
    });

    it('rejects a malformed tenant claim without provisioning a user', async () => {
      const accessToken = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({
        sub: 'gideon-sub-1',
        tid: 123,
      })}.sig`;
      mockSuccessfulExchange();
      mockAuthorizationCodeGrant.mockResolvedValue({
        access_token: accessToken,
        refresh_token: 'refresh-1',
        claims: () => ({ sub: 'gideon-sub-1' }),
      });

      await expect(service.handleCallback({ callbackUrl })).rejects.toThrow(
        'malformed tenant claim',
      );
      expect(mockUserFindFirst).not.toHaveBeenCalled();
      expect(mockSessionCreate).not.toHaveBeenCalled();
    });
  });

  describe('login-state storage', () => {
    const callbackUrl = CALLBACK_URL;

    it('reads a new-prefix state exactly once on the happy path', async () => {
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

      expect(result.sessionToken).toBe('ses-token');
      expect(mockRedisGetdel).toHaveBeenCalledTimes(1);
      expect(mockRedisGetdel).toHaveBeenCalledWith(
        `${OIDC_STATE_KEY_PREFIX}state-123`,
      );
    });
  });
});
