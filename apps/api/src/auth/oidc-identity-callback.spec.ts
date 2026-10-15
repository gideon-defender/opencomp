import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
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

// Module-scope mocks referenced by the hoisted @db factory below.

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

  describe('handleCallback identity', () => {
    const callbackUrl = CALLBACK_URL;

    it('provisions a new user for an unknown verified email', async () => {
      mockSuccessfulExchange();
      mockUserFindFirst.mockResolvedValue(null);
      mockUserCreate.mockResolvedValue({ id: 'usr_new' });

      const result = await service.handleCallback({ callbackUrl });

      expect(mockUserCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'ada@example.com',
          emailVerified: true,
          gideonSub: 'gideon-sub-1',
          tenantId: 'org_1',
        }),
      });
      expect(result.userId).toBe('usr_new');
    });

    it('retries the link path on a concurrent-insert P2002', async () => {
      mockSuccessfulExchange();
      // Initial tenant-scoped miss, initial expand-window fallback miss, then
      // the P2002 recovery tenant-scoped re-read links the winner.
      mockUserFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'usr_raced',
        email: 'ada@example.com',
        gideonSub: null,
        banned: false,
        tenantId: 'org_1',
      });
      mockQueryRaw.mockResolvedValue([]);
      mockUserCreate.mockRejectedValue({ code: 'P2002' });
      mockUserUpdate.mockResolvedValue({ id: 'usr_raced' });

      const result = await service.handleCallback({ callbackUrl });

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'usr_raced', AND: { gideonSub: null } },
        data: expect.objectContaining({ gideonSub: 'gideon-sub-1' }),
      });
      expect(result.userId).toBe('usr_raced');
    });

    it('adopts the new email when the same sub presents a changed email', async () => {
      mockSuccessfulExchange();
      mockUserFindFirst.mockResolvedValue(null);
      mockUserCreate.mockRejectedValue({ code: 'P2002' });
      mockUserFindUnique.mockResolvedValue({
        id: 'usr_old',
        email: 'old@example.com',
        banned: false,
        gideonSub: 'gideon-sub-1',
        tenantId: 'org_1',
      });
      mockUserUpdate.mockResolvedValue({ id: 'usr_old' });

      const result = await service.handleCallback({ callbackUrl });

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'usr_old' },
        data: expect.objectContaining({ email: 'ada@example.com' }),
      });
      expect(result.userId).toBe('usr_old');
    });

    it('rejects banned users', async () => {
      mockSuccessfulExchange();
      mockUserFindFirst.mockResolvedValue({
        id: 'usr_1',
        email: 'ada@example.com',
        gideonSub: null,
        banned: true,
        tenantId: 'org_1',
      });

      await expect(service.handleCallback({ callbackUrl })).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockSessionCreate).not.toHaveBeenCalled();
    });

    it('rejects mismatched/expired state', async () => {
      mockRedisGetdel.mockResolvedValue(null);

      await expect(service.handleCallback({ callbackUrl })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockAuthorizationCodeGrant).not.toHaveBeenCalled();
    });

    it('rejects unverified email', async () => {
      mockRedisGetdel.mockResolvedValue({
        codeVerifier: 'verifier-123',
        nonce: 'nonce-123',
      });
      mockAuthorizationCodeGrant.mockResolvedValue({
        access_token: expect.any(String),
        claims: () => ({ sub: 'gideon-sub-1' }),
      });
      mockFetchUserInfo.mockResolvedValue({
        sub: 'gideon-sub-1',
        email: 'ada@example.com',
        email_verified: false,
      });

      await expect(service.handleCallback({ callbackUrl })).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockUserFindFirst).not.toHaveBeenCalled();
    });

    it('rejects a conflicting gideonSub link', async () => {
      mockSuccessfulExchange();
      mockUserFindFirst.mockResolvedValue({
        id: 'usr_1',
        email: 'ada@example.com',
        gideonSub: 'other-sub',
        banned: false,
        tenantId: 'org_1',
      });

      await expect(service.handleCallback({ callbackUrl })).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockSessionCreate).not.toHaveBeenCalled();
    });
  });
});
