process.env.SECRET_KEY =
  process.env.SECRET_KEY || 'test-secret-key-16-chars-min';

// The no_role test imports EntitlementsDeniedError, which pulls in @db via
// the entitlements module. The controller's service is fully mocked, so the
// client is never touched — stub the import to avoid Prisma initialization.
jest.mock('@db', () => ({
  db: {},
}));

import { Test } from '@nestjs/testing';
import { GideonOidcController } from './gideon-oidc.controller';
import { EntitlementsDeniedError } from './gideon-oidc-entitlements';
import { GideonOidcService } from './gideon-oidc.service';
import { HybridAuthGuard } from './hybrid-auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import { signSessionToken } from './session-cookie';

const mockBuildLoginUrl = jest.fn();
const mockHandleCallback = jest.fn();
const mockPeekStoredRedirect = jest.fn();
const mockRevokeAndDeleteSession = jest.fn();

describe('GideonOidcController', () => {
  let controller: GideonOidcController;
  const OLD_ENV = { ...process.env };

  const buildRes = () => ({
    redirect: jest.fn(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  });

  const buildReq = ({
    cookie,
    authorization,
    proto,
    host = 'localhost:3333',
    url = '/v1/auth/gideon/callback?code=c&state=s',
  }: {
    cookie?: string;
    authorization?: string;
    proto?: string;
    host?: string;
    url?: string;
  }) => ({
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
      ...(proto ? { 'x-forwarded-proto': proto } : {}),
    },
    protocol: 'http',
    get: (name: string) => (name === 'host' ? host : undefined),
    originalUrl: url,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = {
      ...OLD_ENV,
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      BASE_URL: 'http://localhost:3333',
      NODE_ENV: 'test',
    };

    const module = await Test.createTestingModule({
      controllers: [GideonOidcController],
      providers: [
        {
          provide: GideonOidcService,
          useValue: {
            buildLoginUrl: (...args: unknown[]) => mockBuildLoginUrl(...args),
            handleCallback: (...args: unknown[]) => mockHandleCallback(...args),
            peekStoredRedirect: (...args: unknown[]) =>
              mockPeekStoredRedirect(...args),
            revokeAndDeleteSession: (...args: unknown[]) =>
              mockRevokeAndDeleteSession(...args),
          },
        },
      ],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(GideonOidcController);
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  describe('login', () => {
    it('302-redirects to the Gideon authorize URL', async () => {
      mockBuildLoginUrl.mockResolvedValue({ url: 'https://gid/authorize' });
      const res = buildRes();

      await controller.login({}, res as never);

      expect(mockBuildLoginUrl).toHaveBeenCalledWith({
        redirectTo: undefined,
        inviteCode: undefined,
      });
      expect(res.redirect).toHaveBeenCalledWith('https://gid/authorize');
    });

    it('redirects to the app with an error when OIDC is unavailable', async () => {
      mockBuildLoginUrl.mockRejectedValue(new Error('misconfigured'));
      const res = buildRes();

      await controller.login({}, res as never);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth?error=gideon_unavailable',
      );
    });

    it('drops protocol-relative redirect targets', async () => {
      mockBuildLoginUrl.mockResolvedValue({ url: 'https://gid/authorize' });
      const res = buildRes();

      await controller.login({ redirectTo: '//evil.com/phish' }, res as never);

      expect(mockBuildLoginUrl).toHaveBeenCalledWith({
        redirectTo: undefined,
        inviteCode: undefined,
      });
    });

    it('drops redirect targets containing backslashes', async () => {
      mockBuildLoginUrl.mockResolvedValue({ url: 'https://gid/authorize' });
      const res = buildRes();

      await controller.login({ redirectTo: '/\\evil.com' }, res as never);

      expect(mockBuildLoginUrl).toHaveBeenCalledWith({
        redirectTo: undefined,
        inviteCode: undefined,
      });
    });
  });

  describe('callback', () => {
    it('redirects denials back to the app without exchanging', async () => {
      const res = buildRes();

      await controller.callback(
        { error: 'access_denied' },
        buildReq({}) as never,
        res as never,
      );

      expect(mockHandleCallback).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth?error=gideon_access_denied',
      );
    });

    it('sets the session cookie and resumes invites', async () => {
      mockHandleCallback.mockResolvedValue({
        sessionToken: 'ses-token',
        expiresAt: new Date('2026-09-22T00:00:00Z'),
        inviteCode: 'inv_abc123',
      });
      const res = buildRes();

      await controller.callback(
        { code: 'c', state: 's' },
        buildReq({}) as never,
        res as never,
      );

      expect(res.cookie).toHaveBeenCalledWith(
        'local.session_token',
        signSessionToken('ses-token'),
        expect.objectContaining({ httpOnly: true }),
      );
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/invite/inv_abc123',
      );
    });

    it('redirects entitlement denials to the no-access messaging', async () => {
      mockHandleCallback.mockRejectedValue(
        new EntitlementsDeniedError({
          reason: 'empty_entitlements',
          email: 'ada@example.com',
          tenantId: 'tenant-1',
        }),
      );
      const res = buildRes();

      await controller.callback(
        { code: 'c', state: 's' },
        buildReq({}) as never,
        res as never,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth?error=no_role',
      );
    });

    it('routes entitlement denials back to the portal that started login', async () => {
      mockPeekStoredRedirect.mockResolvedValueOnce(
        'https://portal.gideondefender.com/auth?callback_port=1234',
      );
      mockHandleCallback.mockRejectedValue(
        new EntitlementsDeniedError({
          reason: 'empty_entitlements',
          email: 'ada@example.com',
          tenantId: 'tenant-1',
        }),
      );
      const res = buildRes();

      await controller.callback(
        { code: 'c', state: 's' },
        buildReq({}) as never,
        res as never,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        'https://portal.gideondefender.com/auth?error=no_role',
      );
    });

    it('redirects failures to the app login error', async () => {
      mockHandleCallback.mockRejectedValue(new Error('bad state'));
      const res = buildRes();

      await controller.callback(
        { code: 'c', state: 's' },
        buildReq({}) as never,
        res as never,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth?error=gideon_login_failed',
      );
    });

    it('falls back to the app root for hostile stored redirects', async () => {
      mockHandleCallback.mockResolvedValue({
        sessionToken: 'ses-token',
        expiresAt: new Date('2026-09-22T00:00:00Z'),
        redirectTo: '//evil.com/phish',
      });
      const res = buildRes();

      await controller.callback(
        { code: 'c', state: 's' },
        buildReq({}) as never,
        res as never,
      );

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/');
    });

    it('ignores malformed invite codes when building the target', async () => {
      mockHandleCallback.mockResolvedValue({
        sessionToken: 'ses-token',
        expiresAt: new Date('2026-09-22T00:00:00Z'),
        inviteCode: 'https://evil.com/x',
      });
      const res = buildRes();

      await controller.callback(
        { code: 'c', state: 's' },
        buildReq({}) as never,
        res as never,
      );

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/');
    });
  });

  describe('quoted app base URL (docker --env-file keeps quotes)', () => {
    it('strips quotes on the login failure redirect', async () => {
      process.env.NEXT_PUBLIC_APP_URL = '"http://localhost:3000"';
      mockBuildLoginUrl.mockRejectedValue(new Error('misconfigured'));
      const res = buildRes();

      await controller.login({}, res as never);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth?error=gideon_unavailable',
      );
    });

    it('strips quotes on the post-login redirect', async () => {
      process.env.NEXT_PUBLIC_APP_URL = '"http://localhost:3000"';
      delete process.env.BETTER_AUTH_URL;
      mockHandleCallback.mockResolvedValue({
        sessionToken: 'ses-token',
        expiresAt: new Date('2026-09-22T00:00:00Z'),
      });
      const res = buildRes();

      await controller.callback(
        { code: 'c', state: 's' },
        buildReq({}) as never,
        res as never,
      );

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/');
    });

    it('falls back to BETTER_AUTH_URL when the app URL is only quotes', async () => {
      process.env.NEXT_PUBLIC_APP_URL = '""';
      process.env.BETTER_AUTH_URL = "'http://localhost:3000'";
      mockBuildLoginUrl.mockRejectedValue(new Error('misconfigured'));
      const res = buildRes();

      await controller.login({}, res as never);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth?error=gideon_unavailable',
      );
    });
  });

  describe('logout', () => {
    it('revokes the secure-cookie session and clears both variants', async () => {
      process.env.BASE_URL = 'https://api.gideondefender.com';
      process.env.NODE_ENV = 'production';
      const res = buildRes();

      const result = await controller.logout(
        buildReq({
          cookie: '__Secure-better-auth.session_token=tok123',
        }) as never,
        res as never,
      );

      expect(mockRevokeAndDeleteSession).toHaveBeenCalledWith('tok123');
      expect(res.clearCookie).toHaveBeenCalledWith(
        '__Secure-better-auth.session_token',
        expect.anything(),
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'better-auth.session_token',
        expect.anything(),
      );
      expect(result).toEqual({ loggedOut: true });
    });

    it('strips the cookie signature before revoking', async () => {
      process.env.BASE_URL = 'https://api.gideondefender.com';
      process.env.NODE_ENV = 'production';
      const res = buildRes();
      const signed = signSessionToken('tok123');

      const result = await controller.logout(
        buildReq({
          cookie: `__Secure-better-auth.session_token=${encodeURIComponent(signed)}`,
        }) as never,
        res as never,
      );

      expect(mockRevokeAndDeleteSession).toHaveBeenCalledWith('tok123');
      expect(result).toEqual({ loggedOut: true });
    });

    it('clears cookies even with no session token', async () => {
      const res = buildRes();

      const result = await controller.logout(
        buildReq({}) as never,
        res as never,
      );

      expect(mockRevokeAndDeleteSession).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalled();
      expect(result).toEqual({ loggedOut: true });
    });

    it('is public so expired sessions still clear their cookie', () => {
      // Metadata lives on the method function itself; read it through the
      // prototype to avoid an unbound method reference.
      const logout = (
        GideonOidcController.prototype as unknown as Record<
          string,
          (...args: never[]) => unknown
        >
      ).logout;
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, logout)).toBe(true);
    });
  });
});
