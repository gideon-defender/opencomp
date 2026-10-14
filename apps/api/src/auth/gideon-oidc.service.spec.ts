import { UnauthorizedException } from '@nestjs/common';
import {
  createOidcService,
  ENV,
  mockBuildAuthorizationUrl,
  mockDiscovery,
  mockMemberFindFirst,
  mockOidc,
  mockOrgFindFirst,
  mockOrgFindUnique,
  mockRedisGetdel,
  mockRedisSet,
  mockSessionCreate,
  mockUserCreate,
  mockUserFindFirst,
  mockUserFindMany,
  mockQueryRaw,
  mockUserFindUnique,
  mockUserUpdate,
} from './gideon-oidc.service.fixtures';
import {
  GideonOidcService,
  extractGideonTenantId,
} from './gideon-oidc.service';

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

  describe('isConfigured', () => {
    it('true when all OIDC env vars are set', () => {
      expect(service.isConfigured()).toBe(true);
    });

    it('true without a client secret (public Gideon app)', () => {
      delete process.env.GIDEON_OIDC_CLIENT_SECRET;
      expect(service.isConfigured()).toBe(true);
    });

    it('false when the client id is missing', () => {
      delete process.env.GIDEON_OIDC_CLIENT_ID;
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('getOidcConfig', () => {
    it('allows insecure discovery for loopback issuers', async () => {
      await service.getOidcConfig();
      expect(mockDiscovery).toHaveBeenCalledWith(
        expect.any(URL),
        ENV.GIDEON_OIDC_CLIENT_ID,
        ENV.GIDEON_OIDC_CLIENT_SECRET,
        undefined,
        expect.objectContaining({ execute: expect.any(Array) }),
      );
    });

    it('requires HTTPS discovery for non-loopback issuers', async () => {
      process.env.GIDEON_IDENTITY_URL = 'https://auth.example.com';
      await service.getOidcConfig();
      expect(mockDiscovery).toHaveBeenCalledWith(
        expect.any(URL),
        ENV.GIDEON_OIDC_CLIENT_ID,
        ENV.GIDEON_OIDC_CLIENT_SECRET,
        undefined,
        undefined,
      );
    });

    it('discovers as a public client when no secret is set', async () => {
      delete process.env.GIDEON_OIDC_CLIENT_SECRET;
      service.resetCache();
      await service.getOidcConfig();
      // undefined metadata → openid-client v6 `none` client auth (PKCE-bound).
      expect(mockDiscovery).toHaveBeenCalledWith(
        expect.any(URL),
        ENV.GIDEON_OIDC_CLIENT_ID,
        undefined,
        undefined,
        expect.objectContaining({ execute: expect.any(Array) }),
      );
    });

    it('fails closed for non-loopback http issuers', async () => {
      process.env.GIDEON_IDENTITY_URL = 'http://auth.internal:8080';
      await expect(service.getOidcConfig()).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('buildLoginUrl', () => {
    it('stores PKCE state in Redis and returns the Gideon authorize URL', async () => {
      const result = await service.buildLoginUrl({
        redirectTo: '/risks',
        inviteCode: 'inv_1',
      });

      expect(result.url).toContain('/v1/oidc/authorize');
      expect(result.state).toBe('state-123');
      expect(result.nonce).toBe('nonce-123');
      expect(result.codeVerifier).toBe('verifier-123');
      expect(mockRedisSet).toHaveBeenCalledWith(
        'app:gideon-oidc:state-123',
        {
          codeVerifier: 'verifier-123',
          nonce: 'nonce-123',
          redirectTo: '/risks',
          inviteCode: 'inv_1',
        },
        { ex: 600 },
      );
      expect(mockBuildAuthorizationUrl).toHaveBeenCalledWith('mock-config', {
        redirect_uri: ENV.GIDEON_OIDC_REDIRECT_URI,
        scope: 'openid profile email',
        code_challenge: 'challenge-123',
        code_challenge_method: 'S256',
        state: 'state-123',
        nonce: 'nonce-123',
      });
    });

    it('throws when OIDC is not configured', async () => {
      delete process.env.GIDEON_OIDC_CLIENT_ID;
      await expect(service.buildLoginUrl()).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('builds a login URL without a client secret (public client)', async () => {
      delete process.env.GIDEON_OIDC_CLIENT_SECRET;
      const result = await service.buildLoginUrl({ redirectTo: '/risks' });
      expect(result.url).toContain('code_challenge=');
      expect(mockDiscovery).toHaveBeenCalledWith(
        expect.any(URL),
        ENV.GIDEON_OIDC_CLIENT_ID,
        undefined,
        undefined,
        expect.anything(),
      );
    });
  });

  describe('extractGideonTenantId', () => {
    const jwt = (payload: Record<string, unknown>) => {
      const b64 = (o: unknown) =>
        Buffer.from(JSON.stringify(o)).toString('base64url');
      return `${b64({ alg: 'RS256', kid: 'k1' })}.${b64(payload)}.sig`;
    };

    it('extracts tid from a JWT access token', () => {
      expect(extractGideonTenantId(jwt({ sub: 'u', tid: 'tenant-1' }))).toBe(
        'tenant-1',
      );
    });

    it('accepts alternate tenant claim shapes', () => {
      expect(
        extractGideonTenantId(jwt({ sub: 'u', tenant_id: 'tenant-2' })),
      ).toBe('tenant-2');
      expect(
        extractGideonTenantId(jwt({ sub: 'u', organizationId: 'tenant-3' })),
      ).toBe('tenant-3');
    });

    it('returns undefined for opaque or missing tokens', () => {
      expect(extractGideonTenantId('opaque-token')).toBeUndefined();
      expect(extractGideonTenantId(undefined)).toBeUndefined();
      expect(extractGideonTenantId(jwt({ sub: 'u' }))).toBeUndefined();
    });
  });
});
