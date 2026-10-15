process.env.SECRET_KEY =
  process.env.SECRET_KEY || 'test-secret-key-16-chars-min';

import { Test } from '@nestjs/testing';
import { OidcController } from './oidc.controller';
import { OidcService } from './oidc.service';
import { HybridAuthGuard } from './hybrid-auth.guard';

const mockBuildLoginUrl = jest.fn();
const mockHandleCallback = jest.fn();
const mockPeekStoredRedirect = jest.fn();
const mockRevokeAndDeleteSession = jest.fn();

/**
 * Redirect-target behavior: relative app paths plus absolute URLs on
 * trusted origins (the portal's way home). Kept separate from the main
 * controller spec so neither file breaches the 300-line limit.
 */
describe('OidcController redirect targets', () => {
  let controller: OidcController;
  const OLD_ENV = { ...process.env };

  const buildRes = () => ({
    redirect: jest.fn(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  });

  const buildReq = ({
    proto,
    host = 'api.gideondefender.com',
    url = '/v1/auth/oidc/callback?code=c&state=s',
  }: {
    proto?: string;
    host?: string;
    url?: string;
  } = {}) => ({
    headers: {
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
      AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:3002',
    };

    const module = await Test.createTestingModule({
      controllers: [OidcController],
      providers: [
        {
          provide: OidcService,
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
    controller = module.get(OidcController);
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  describe('login', () => {
    it('passes an absolute trusted-origin target through to the service', async () => {
      mockBuildLoginUrl.mockResolvedValue({ url: 'https://gid/authorize' });
      const res = buildRes();

      await controller.login(
        { redirectTo: 'http://localhost:3002/dashboard' },
        res as never,
      );

      expect(mockBuildLoginUrl).toHaveBeenCalledWith({
        redirectTo: 'http://localhost:3002/dashboard',
        inviteCode: undefined,
      });
    });

    it('drops absolute targets on untrusted origins', async () => {
      mockBuildLoginUrl.mockResolvedValue({ url: 'https://gid/authorize' });
      const res = buildRes();

      await controller.login(
        { redirectTo: 'https://evil.example.com/phish' },
        res as never,
      );

      expect(mockBuildLoginUrl).toHaveBeenCalledWith({
        redirectTo: undefined,
        inviteCode: undefined,
      });
    });

    it('drops javascript: targets', async () => {
      mockBuildLoginUrl.mockResolvedValue({ url: 'https://gid/authorize' });
      const res = buildRes();

      await controller.login(
        { redirectTo: 'javascript:alert(1)' },
        res as never,
      );

      expect(mockBuildLoginUrl).toHaveBeenCalledWith({
        redirectTo: undefined,
        inviteCode: undefined,
      });
    });

    it('drops targets with embedded credentials', async () => {
      mockBuildLoginUrl.mockResolvedValue({ url: 'https://gid/authorize' });
      const res = buildRes();

      await controller.login(
        { redirectTo: 'http://user:pass@localhost:3002/' },
        res as never,
      );

      expect(mockBuildLoginUrl).toHaveBeenCalledWith({
        redirectTo: undefined,
        inviteCode: undefined,
      });
    });

    it('drops targets with control characters', async () => {
      mockBuildLoginUrl.mockResolvedValue({ url: 'https://gid/authorize' });
      const res = buildRes();

      await controller.login(
        { redirectTo: '/dashboard\r\nSet-Cookie: x=1' },
        res as never,
      );

      expect(mockBuildLoginUrl).toHaveBeenCalledWith({
        redirectTo: undefined,
        inviteCode: undefined,
      });
    });

    it('keeps relative app paths working', async () => {
      mockBuildLoginUrl.mockResolvedValue({ url: 'https://gid/authorize' });
      const res = buildRes();

      await controller.login({ redirectTo: '/risks' }, res as never);

      expect(mockBuildLoginUrl).toHaveBeenCalledWith({
        redirectTo: '/risks',
        inviteCode: undefined,
      });
    });
  });

  describe('callback', () => {
    it('returns to the absolute trusted target on success', async () => {
      mockHandleCallback.mockResolvedValue({
        sessionToken: 'ses-token',
        expiresAt: new Date('2026-09-22T00:00:00Z'),
        redirectTo: 'http://localhost:3002/dashboard',
      });
      const res = buildRes();

      await controller.callback(
        { code: 'c', state: 's' },
        buildReq() as never,
        res as never,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3002/dashboard',
      );
    });

    it('prefers the invite link over a stored portal target', async () => {
      mockHandleCallback.mockResolvedValue({
        sessionToken: 'ses-token',
        expiresAt: new Date('2026-09-22T00:00:00Z'),
        redirectTo: 'http://localhost:3002/dashboard',
        inviteCode: 'inv_abc123',
      });
      const res = buildRes();

      await controller.callback(
        { code: 'c', state: 's' },
        buildReq() as never,
        res as never,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/invite/inv_abc123',
      );
    });

    it('sends portal failures back to the portal login', async () => {
      mockHandleCallback.mockRejectedValue(new Error('bad state'));
      mockPeekStoredRedirect.mockResolvedValue(
        'http://localhost:3002/dashboard',
      );
      const res = buildRes();

      await controller.callback(
        { code: 'c', state: 's' },
        buildReq() as never,
        res as never,
      );

      expect(mockPeekStoredRedirect).toHaveBeenCalledWith('s');
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3002/auth?error=oidc_login_failed',
      );
    });

    it('peeks the stored target before exchanging (state is single-use)', async () => {
      mockHandleCallback.mockRejectedValue(new Error('exchange failed'));
      mockPeekStoredRedirect.mockResolvedValue(
        'http://localhost:3002/dashboard',
      );
      const res = buildRes();

      await controller.callback(
        { code: 'c', state: 's' },
        buildReq() as never,
        res as never,
      );

      // The exchange consumes the state via getdel, so a peek after the
      // failure would always miss. Peek must come first.
      const peekOrder = mockPeekStoredRedirect.mock.invocationCallOrder[0];
      const exchangeOrder = mockHandleCallback.mock.invocationCallOrder[0];
      expect(peekOrder).toBeLessThan(exchangeOrder);
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3002/auth?error=oidc_login_failed',
      );
    });

    it('sends denials back to the portal login', async () => {
      mockPeekStoredRedirect.mockResolvedValue(
        'http://localhost:3002/dashboard',
      );
      const res = buildRes();

      await controller.callback(
        { error: 'access_denied', state: 's' },
        buildReq() as never,
        res as never,
      );

      expect(mockHandleCallback).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3002/auth?error=oidc_access_denied',
      );
    });

    it('falls back to the app when no stored target exists', async () => {
      mockHandleCallback.mockRejectedValue(new Error('bad state'));
      mockPeekStoredRedirect.mockResolvedValue(undefined);
      const res = buildRes();

      await controller.callback(
        { code: 'c', state: 's' },
        buildReq() as never,
        res as never,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth?error=oidc_login_failed',
      );
    });
  });
});
