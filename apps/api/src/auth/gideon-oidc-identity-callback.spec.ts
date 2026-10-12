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
  mockUserFindUnique,
  mockUserUpdate,
} from './gideon-oidc.service.fixtures';
import { GideonOidcService } from './gideon-oidc.service';

// Module-scope mocks referenced by the hoisted @db factory below.

// openid-client v6 is ESM-only and loaded via dynamic import() inside
// gideon-oidc-client — mock the loader statically instead.
jest.mock('./gideon-oidc-client', () => ({
  loadOidcClient: () => Promise.resolve(mockOidc),
}));

const mockAuditOidcEntitlements = jest.fn();
jest.mock('./gideon-oidc-entitlements', () => ({
  ...jest.requireActual<typeof import('./gideon-oidc-entitlements')>(
    './gideon-oidc-entitlements',
  ),
  auditOidcEntitlements: (...args: unknown[]) =>
    mockAuditOidcEntitlements(...args),
}));
jest.mock('./gideon-oidc-gates', () => ({
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
  db: {
    user: {
      findFirst: (...args: unknown[]) => mockUserFindFirst(...args),
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      create: (...args: unknown[]) => mockUserCreate(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
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

describe('GideonOidcService', () => {
  let service: GideonOidcService;
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
        }),
      });
      expect(result.userId).toBe('usr_new');
    });

    it('retries the link path on a concurrent-insert P2002', async () => {
      mockSuccessfulExchange();
      mockUserFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'usr_raced',
        email: 'ada@example.com',
        gideonSub: null,
        banned: false,
      });
      mockUserCreate.mockRejectedValue({ code: 'P2002' });
      mockUserUpdate.mockResolvedValue({ id: 'usr_raced' });

      const result = await service.handleCallback({ callbackUrl });

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'usr_raced' },
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
        access_token: 'access-1',
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
      });

      await expect(service.handleCallback({ callbackUrl })).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockSessionCreate).not.toHaveBeenCalled();
    });
  });
});
