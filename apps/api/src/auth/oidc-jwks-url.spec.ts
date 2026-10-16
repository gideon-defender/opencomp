import { fetchDiscoveryJwksUri, isUsableJwksUrl } from './oidc-jwks-url';

describe('isUsableJwksUrl', () => {
  it('accepts https anywhere', () => {
    expect(
      isUsableJwksUrl('https://auth.example.com/.well-known/jwks.json'),
    ).toBe(true);
  });

  it('accepts plain http for loopback hosts only', () => {
    expect(isUsableJwksUrl('http://localhost:8081/jwks.json')).toBe(true);
    expect(isUsableJwksUrl('http://127.0.0.1/jwks.json')).toBe(true);
    expect(isUsableJwksUrl('http://[::1]/jwks.json')).toBe(true);
    expect(isUsableJwksUrl('http://idp.localhost/jwks.json')).toBe(true);
    expect(isUsableJwksUrl('http://auth.example.com/jwks.json')).toBe(false);
  });

  it('rejects non-http schemes and unparseable values', () => {
    expect(isUsableJwksUrl('javascript:alert(1)')).toBe(false);
    expect(isUsableJwksUrl('ftp://auth.example.com/jwks.json')).toBe(false);
    expect(isUsableJwksUrl('not a url')).toBe(false);
    expect(isUsableJwksUrl('')).toBe(false);
  });
});

describe('fetchDiscoveryJwksUri', () => {
  const fetchMock = jest.fn();
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function discoveryDoc(body: unknown) {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    });
  }

  it('returns jwks_uri from the discovery document', async () => {
    discoveryDoc({
      issuer: 'https://auth.example.com',
      jwks_uri: 'https://auth.example.com/oauth/jwks',
    });

    await expect(
      fetchDiscoveryJwksUri('https://auth.example.com'),
    ).resolves.toBe('https://auth.example.com/oauth/jwks');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/.well-known/openid-configuration',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('accepts loopback http issuers', async () => {
    discoveryDoc({
      issuer: 'http://localhost:8081',
      jwks_uri: 'http://localhost:8081/jwks.json',
    });

    await expect(fetchDiscoveryJwksUri('http://localhost:8081')).resolves.toBe(
      'http://localhost:8081/jwks.json',
    );
  });

  it('rejects a discovery document for another issuer', async () => {
    discoveryDoc({
      issuer: 'https://evil.example.com',
      jwks_uri: 'https://evil.example.com/keys',
    });

    await expect(
      fetchDiscoveryJwksUri('https://auth.example.com'),
    ).resolves.toBeNull();
  });

  it('rejects a missing or non-string issuer', async () => {
    discoveryDoc({ jwks_uri: 'https://auth.example.com/oauth/jwks' });
    await expect(
      fetchDiscoveryJwksUri('https://auth.example.com'),
    ).resolves.toBeNull();

    discoveryDoc({
      issuer: 42,
      jwks_uri: 'https://auth.example.com/oauth/jwks',
    });
    await expect(
      fetchDiscoveryJwksUri('https://auth.example.com'),
    ).resolves.toBeNull();
  });

  it('ignores trailing slashes when comparing issuers', async () => {
    discoveryDoc({
      issuer: 'https://auth.example.com/',
      jwks_uri: 'https://auth.example.com/oauth/jwks',
    });

    await expect(
      fetchDiscoveryJwksUri('https://auth.example.com'),
    ).resolves.toBe('https://auth.example.com/oauth/jwks');
  });

  it('returns null when discovery is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(
      fetchDiscoveryJwksUri('https://auth.example.com'),
    ).resolves.toBeNull();
  });

  it('returns null on non-ok status, bad JSON, or non-object doc', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    await expect(
      fetchDiscoveryJwksUri('https://auth.example.com'),
    ).resolves.toBeNull();

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('bad json')),
    });
    await expect(
      fetchDiscoveryJwksUri('https://auth.example.com'),
    ).resolves.toBeNull();

    discoveryDoc(['not', 'an', 'object']);
    await expect(
      fetchDiscoveryJwksUri('https://auth.example.com'),
    ).resolves.toBeNull();
  });

  it('returns null for missing, non-string, or unusable jwks_uri', async () => {
    discoveryDoc({ issuer: 'https://auth.example.com' });
    await expect(
      fetchDiscoveryJwksUri('https://auth.example.com'),
    ).resolves.toBeNull();

    discoveryDoc({
      issuer: 'https://auth.example.com',
      jwks_uri: 42,
    });
    await expect(
      fetchDiscoveryJwksUri('https://auth.example.com'),
    ).resolves.toBeNull();

    discoveryDoc({
      issuer: 'https://auth.example.com',
      jwks_uri: 'http://auth.example.com/jwks.json',
    });
    await expect(
      fetchDiscoveryJwksUri('https://auth.example.com'),
    ).resolves.toBeNull();
  });

  it('refuses plain-HTTP discovery outside local dev', async () => {
    await expect(
      fetchDiscoveryJwksUri('http://auth.example.com'),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
