import { GcpImpersonationService } from './gcp-impersonation.service';

const SA = 'opencomp-remediator@my-proj-123.iam.gserviceaccount.com';

describe('GcpImpersonationService', () => {
  const previousImpersonator = process.env.GCP_REMEDIATOR_IMPERSONATOR_SA;
  const previousCaller = process.env.GCP_IMPERSONATOR_ACCESS_TOKEN;
  const previousFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = previousFetch;
    if (previousImpersonator === undefined) {
      delete process.env.GCP_REMEDIATOR_IMPERSONATOR_SA;
    } else {
      process.env.GCP_REMEDIATOR_IMPERSONATOR_SA = previousImpersonator;
    }
    if (previousCaller === undefined) {
      delete process.env.GCP_IMPERSONATOR_ACCESS_TOKEN;
    } else {
      process.env.GCP_IMPERSONATOR_ACCESS_TOKEN = previousCaller;
    }
  });

  it('mints a token via iamcredentials with a capped lifetime', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'fix-token' }),
    });
    globalThis.fetch = fetchMock;
    const service = new GcpImpersonationService();
    const result = await service.mintRemediatorToken({
      saEmail: SA,
      callerToken: 'backend-token',
      lifetimeSeconds: 99999,
    });
    expect(result).toEqual({
      accessToken: 'fix-token',
      expiresInSeconds: 3600,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(':generateAccessToken'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer backend-token',
        }),
      }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body,
    );
    expect(body.lifetime).toBe('3600s');
  });

  it('throws a descriptive error when impersonation is denied', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'PERMISSION_DENIED',
    });
    const service = new GcpImpersonationService();
    await expect(
      service.mintRemediatorToken({ saEmail: SA, callerToken: 'bad-token' }),
    ).rejects.toThrow(`Impersonation failed for ${SA} (403)`);
  });

  it('throws when no token is returned', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const service = new GcpImpersonationService();
    await expect(
      service.mintRemediatorToken({ saEmail: SA, callerToken: 'backend' }),
    ).rejects.toThrow('no access token');
  });

  it('reads impersonator identity and caller token from env', () => {
    process.env.GCP_REMEDIATOR_IMPERSONATOR_SA =
      'backend@sys.iam.gserviceaccount.com';
    process.env.GCP_IMPERSONATOR_ACCESS_TOKEN = 'env-token';
    const service = new GcpImpersonationService();
    expect(service.getImpersonatorEmail()).toBe(
      'backend@sys.iam.gserviceaccount.com',
    );
    expect(service.resolveCallerToken()).toBe('env-token');
    expect(service.resolveCallerToken('explicit')).toBe('explicit');
  });

  it('fails closed when caller credentials are missing', () => {
    delete process.env.GCP_IMPERSONATOR_ACCESS_TOKEN;
    const service = new GcpImpersonationService();
    expect(() => service.resolveCallerToken()).toThrow('not configured');
  });
});
