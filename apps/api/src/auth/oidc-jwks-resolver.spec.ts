import { OidcJwksResolver } from './oidc-jwks-resolver';

describe('OidcJwksResolver', () => {
  const fetchMock = jest.fn();
  const realFetch = globalThis.fetch;
  const OLD_ENV = { ...process.env };
  let resolver: OidcJwksResolver;

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock;
    process.env = { ...OLD_ENV };
    delete process.env.OIDC_JWKS_CACHE_TTL_SECS;
    delete process.env.GIDEON_JWKS_CACHE_TTL_SECS;
    delete process.env.AUTH__JWKS_CACHE_TTL_SECS;
    resolver = new OidcJwksResolver();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = OLD_ENV;
    globalThis.fetch = realFetch;
  });

  function discoveryDoc(body: unknown) {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    });
  }

  it('returns null when identity is missing', async () => {
    await expect(resolver.resolve(null)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses jwks_uri from discovery', async () => {
    discoveryDoc({
      issuer: 'https://auth.example.com',
      jwks_uri: 'https://auth.example.com/oauth/keys',
    });

    await expect(resolver.resolve('https://auth.example.com')).resolves.toBe(
      'https://auth.example.com/oauth/keys',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/.well-known/openid-configuration',
      expect.anything(),
    );
  });

  it('strips trailing slashes before building discovery URL', async () => {
    discoveryDoc({
      issuer: 'https://auth.example.com',
      jwks_uri: 'https://auth.example.com/oauth/keys',
    });

    await expect(resolver.resolve('https://auth.example.com///')).resolves.toBe(
      'https://auth.example.com/oauth/keys',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/.well-known/openid-configuration',
      expect.anything(),
    );
  });

  it('falls back to legacy path when discovery is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('down'));

    await expect(resolver.resolve('https://auth.example.com')).resolves.toBe(
      'https://auth.example.com/.well-known/jwks.json',
    );
  });

  it('falls back to legacy path when discovery is for another issuer', async () => {
    discoveryDoc({
      issuer: 'https://evil.example.com',
      jwks_uri: 'https://evil.example.com/keys',
    });

    await expect(resolver.resolve('https://auth.example.com')).resolves.toBe(
      'https://auth.example.com/.well-known/jwks.json',
    );
  });

  it('returns null without fetch for plain-HTTP non-loopback issuers', async () => {
    await expect(
      resolver.resolve('http://auth.example.com'),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves a discovered URL on refresh failure and retries after the TTL', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(0);
    const base = 'https://auth.example.com';
    discoveryDoc({ issuer: base, jwks_uri: `${base}/oauth/keys` });
    await expect(resolver.resolve(base)).resolves.toBe(`${base}/oauth/keys`);

    now.mockReturnValue(300_000);
    fetchMock.mockRejectedValue(new Error('discovery down'));
    await expect(resolver.resolve(base)).resolves.toBe(`${base}/oauth/keys`);
    await expect(resolver.resolve(base)).resolves.toBe(`${base}/oauth/keys`);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    now.mockReturnValue(600_000);
    discoveryDoc({ issuer: base, jwks_uri: `${base}/oauth/new-keys` });
    await expect(resolver.resolve(base)).resolves.toBe(
      `${base}/oauth/new-keys`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('recovers from the initial legacy fallback after the TTL', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(0);
    const base = 'https://auth.example.com';
    fetchMock.mockRejectedValue(new Error('discovery down'));
    await expect(resolver.resolve(base)).resolves.toBe(
      `${base}/.well-known/jwks.json`,
    );

    now.mockReturnValue(300_000);
    discoveryDoc({ issuer: base, jwks_uri: `${base}/oauth/keys` });
    await expect(resolver.resolve(base)).resolves.toBe(`${base}/oauth/keys`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not reuse another issuer's cached URL after discovery fails", async () => {
    discoveryDoc({
      issuer: 'https://a.example.com',
      jwks_uri: 'https://a.example.com/keys',
    });
    await resolver.resolve('https://a.example.com');

    fetchMock.mockRejectedValue(new Error('discovery down'));
    await expect(resolver.resolve('https://b.example.com')).resolves.toBe(
      'https://b.example.com/.well-known/jwks.json',
    );
  });

  it('caches per base and refetches when base changes', async () => {
    discoveryDoc({
      issuer: 'https://a.example.com',
      jwks_uri: 'https://a.example.com/keys',
    });

    await expect(resolver.resolve('https://a.example.com')).resolves.toBe(
      'https://a.example.com/keys',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Same base hits cache — no second fetch.
    await expect(resolver.resolve('https://a.example.com/')).resolves.toBe(
      'https://a.example.com/keys',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Different base refetches.
    discoveryDoc({
      issuer: 'https://b.example.com',
      jwks_uri: 'https://b.example.com/keys',
    });
    await expect(resolver.resolve('https://b.example.com')).resolves.toBe(
      'https://b.example.com/keys',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
