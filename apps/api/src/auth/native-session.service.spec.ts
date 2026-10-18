process.env.SECRET_KEY =
  process.env.SECRET_KEY || 'test-secret-key-16-chars-min';

import { NativeSessionService } from './native-session.service';
import { getSessionCookieNames, signSessionToken } from './session-cookie';

const mockSessionFindUnique = jest.fn();
const mockQueryRaw = jest.fn();
const mockExecuteRaw = jest.fn();
jest.mock('@db', () => ({
  db: {
    session: {
      findUnique: (...args: unknown[]) => mockSessionFindUnique(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
  },
  Prisma: {
    sql: (strings: unknown, ...values: unknown[]) => ({ strings, values }),
  },
}));

const NOW = Date.now();
const LIVE_ROW = {
  id: 'ses_1',
  expiresAt: new Date(NOW + 60_000),
  activeOrganizationId: 'org_1',
  deviceAgent: false,
  user: { id: 'usr_1', email: 'user@acme.com', tenantId: 'org_1' },
};

describe('NativeSessionService', () => {
  let service: NativeSessionService;
  let plainCookieName = '';
  let secureCookieName = '';

  beforeEach(() => {
    service = new NativeSessionService();
    mockSessionFindUnique.mockReset();
    mockQueryRaw.mockReset();
    mockExecuteRaw.mockReset();
    // Default: legacy column already dropped — no per-request raw check.
    mockQueryRaw.mockResolvedValue([{ exists: false }]);
    // [secure-prefixed, plain] — mirrors better-auth's read order.
    const names = getSessionCookieNames();
    secureCookieName = names[0];
    plainCookieName = names[1];
  });

  it('resolves a raw token from the plain session cookie', async () => {
    mockSessionFindUnique.mockResolvedValue(LIVE_ROW);

    const result = await service.resolveFromHeaders({
      cookieHeader: `${plainCookieName}=tok_raw_123`,
    });

    expect(mockSessionFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: 'tok_raw_123' } }),
    );
    expect(result).toEqual({
      user: LIVE_ROW.user,
      session: {
        id: 'ses_1',
        activeOrganizationId: 'org_1',
        deviceAgent: false,
        expiresAt: LIVE_ROW.expiresAt,
      },
    });
  });

  it('strips the signature from a signed secure cookie value', async () => {
    mockSessionFindUnique.mockResolvedValue(LIVE_ROW);
    const signed = encodeURIComponent(signSessionToken('tok_raw_123'));

    const result = await service.resolveFromHeaders({
      cookieHeader: `${secureCookieName}=${signed}`,
    });

    expect(mockSessionFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: 'tok_raw_123' } }),
    );
    expect(result?.user.id).toBe('usr_1');
  });

  it('resolves a bearer session token', async () => {
    mockSessionFindUnique.mockResolvedValue(LIVE_ROW);

    const result = await service.resolveFromHeaders({
      authHeader: 'Bearer tok_raw_123',
    });

    expect(mockSessionFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: 'tok_raw_123' } }),
    );
    expect(result?.session.id).toBe('ses_1');
  });

  it('skips the DB lookup for JWT-shaped bearer tokens (Gideon path owns those)', async () => {
    const result = await service.resolveFromHeaders({
      authHeader: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2ln',
    });

    expect(mockSessionFindUnique).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns null for expired sessions', async () => {
    mockSessionFindUnique.mockResolvedValue({
      ...LIVE_ROW,
      expiresAt: new Date(NOW - 1_000),
    });

    const result = await service.resolveFromHeaders({
      cookieHeader: `${plainCookieName}=tok_old`,
    });

    expect(result).toBeNull();
  });

  it('returns null when no session row matches and when nothing is presented', async () => {
    mockSessionFindUnique.mockResolvedValue(null);

    await expect(
      service.resolveFromHeaders({
        cookieHeader: `${plainCookieName}=tok_missing`,
      }),
    ).resolves.toBeNull();
    await expect(service.resolveFromHeaders({})).resolves.toBeNull();
    expect(mockSessionFindUnique).toHaveBeenCalledTimes(1);
  });

  it('returns null (never throws) when the DB lookup fails', async () => {
    mockSessionFindUnique.mockRejectedValue(new Error('db down'));

    await expect(
      service.resolveFromHeaders({
        cookieHeader: `${plainCookieName}=tok_x`,
      }),
    ).resolves.toBeNull();
  });

  describe('onModuleInit legacy impersonation cleanup', () => {
    beforeEach(() => {
      mockQueryRaw.mockReset();
      mockExecuteRaw.mockReset();
    });

    it('deletes sessions with impersonatedBy when the column still exists', async () => {
      mockQueryRaw.mockResolvedValue([{ exists: true }]);
      mockExecuteRaw.mockResolvedValue(2);

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    });

    it('skips the delete when the column is already gone', async () => {
      mockQueryRaw.mockResolvedValue([{ exists: false }]);

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(mockExecuteRaw).not.toHaveBeenCalled();
    });

    it('never throws when the cleanup query fails', async () => {
      mockQueryRaw.mockRejectedValue(new Error('db down'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('retries the delete before giving up loudly', async () => {
      mockQueryRaw.mockResolvedValue([{ exists: true }]);
      mockExecuteRaw.mockRejectedValue(new Error('lock timeout'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(mockExecuteRaw).toHaveBeenCalledTimes(3);
    });

    it('stops quietly when the column drops mid-boot (promotion race)', async () => {
      mockQueryRaw.mockResolvedValue([{ exists: true }]);
      mockExecuteRaw.mockRejectedValue(
        new Error('column "impersonatedBy" does not exist'),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      // No retries: column-gone is the desired end state, not a failure.
      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('legacy impersonation request-time rejection', () => {
    it('rejects a session whose impersonatedBy marker is set', async () => {
      mockSessionFindUnique.mockResolvedValue(LIVE_ROW);
      mockQueryRaw
        .mockResolvedValueOnce([{ exists: true }])
        .mockResolvedValueOnce([{ impersonatedBy: 'adm_1' }]);

      const result = await service.resolveFromHeaders({
        cookieHeader: `${plainCookieName}=tok_impersonated`,
      });

      expect(result).toBeNull();
    });

    it('resolves a session with no impersonation marker', async () => {
      mockSessionFindUnique.mockResolvedValue(LIVE_ROW);
      mockQueryRaw
        .mockResolvedValueOnce([{ exists: true }])
        .mockResolvedValueOnce([{ impersonatedBy: null }]);

      const result = await service.resolveFromHeaders({
        cookieHeader: `${plainCookieName}=tok_clean`,
      });

      expect(result?.session.id).toBe('ses_1');
    });

    it('fails closed (rejects) when the marker check errors while the column is known to exist', async () => {
      mockSessionFindUnique.mockResolvedValue(LIVE_ROW);
      mockQueryRaw
        .mockResolvedValueOnce([{ exists: true }])
        .mockRejectedValueOnce(new Error('transient'));

      const result = await service.resolveFromHeaders({
        cookieHeader: `${plainCookieName}=tok_x`,
      });

      expect(result).toBeNull();
    });

    it('rejects when the column probe errors and the state is unknown', async () => {
      mockSessionFindUnique.mockResolvedValue(LIVE_ROW);
      mockQueryRaw.mockRejectedValueOnce(new Error('transient'));

      const result = await service.resolveFromHeaders({
        cookieHeader: `${plainCookieName}=tok_x`,
      });

      expect(result).toBeNull();
    });

    it.each([{ probeResult: [] }, { probeResult: [{}] }])(
      'does not cache an ambiguous probe result %j',
      async ({ probeResult }) => {
        mockSessionFindUnique.mockResolvedValue(LIVE_ROW);
        mockQueryRaw
          .mockResolvedValueOnce(probeResult)
          .mockResolvedValueOnce([{ exists: true }])
          .mockResolvedValueOnce([{ impersonatedBy: 'adm_1' }]);

        // An empty probe rejects the session without caching the unknown state.
        const first = await service.resolveFromHeaders({
          cookieHeader: `${plainCookieName}=tok_x`,
        });
        expect(first).toBeNull();

        // Next request re-probes, finds the column, sees the marker, rejects.
        const second = await service.resolveFromHeaders({
          cookieHeader: `${plainCookieName}=tok_x`,
        });
        expect(second).toBeNull();
        expect(mockQueryRaw).toHaveBeenCalledTimes(3);
      },
    );

    it('caches the column as dropped when the marker check hits a dropped-column race', async () => {
      mockSessionFindUnique.mockResolvedValue(LIVE_ROW);
      mockQueryRaw
        .mockResolvedValueOnce([{ exists: true }])
        .mockRejectedValueOnce(
          new Error('column "impersonatedBy" does not exist'),
        );

      const first = await service.resolveFromHeaders({
        cookieHeader: `${plainCookieName}=tok_x`,
      });
      expect(first?.session.id).toBe('ses_1');

      const second = await service.resolveFromHeaders({
        cookieHeader: `${plainCookieName}=tok_x`,
      });
      expect(second?.session.id).toBe('ses_1');
      // Probe ran once, marker check ran once, then the cached "dropped"
      // state skipped all raw checks on the second request.
      expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    });
  });
});
