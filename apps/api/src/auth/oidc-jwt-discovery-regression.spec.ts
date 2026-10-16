import { OidcJwtService } from './oidc-jwt.service';

const mockCreateRemoteJWKSet = jest.fn(() => 'mock-jwks');
const mockJwtVerify = jest.fn();

jest.mock('jose', () => ({
  ...jest.requireActual<typeof import('jose')>('jose'),
  createRemoteJWKSet: (...args: unknown[]) =>
    (mockCreateRemoteJWKSet as (...values: unknown[]) => unknown)(...args),
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}));

function token({ issuer, kid }: { issuer: string; kid?: string }): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString(
    'base64url',
  );
  const payload = Buffer.from(JSON.stringify({ iss: issuer })).toString(
    'base64url',
  );
  return `${header}.${payload}.signature`;
}

describe('OidcJwtService discovery regressions', () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;
  const fetchMock = jest.fn();
  const base = 'https://auth.example.com';
  const validToken = token({ issuer: base, kid: 'k1' });
  let service: OidcJwtService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      OIDC_ISSUER_URL: base,
      OIDC_JWT_ISSUER: base,
      OIDC_JWT_AUDIENCE: 'my-app',
      OIDC_JWKS_CACHE_TTL_SECS: '300',
    };
    globalThis.fetch = fetchMock;
    fetchMock.mockRejectedValue(new Error('discovery unavailable'));
    mockJwtVerify.mockResolvedValue({
      payload: { sub: 'user_1', tid: 'org_1' },
      protectedHeader: { kid: 'k1' },
    });
    service = new OidcJwtService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it.each([
    ['opaque session bearer', 'native-session-token'],
    ['foreign JWT', token({ issuer: 'https://other.example.com', kid: 'k1' })],
    ['JWT without a key ID', token({ issuer: base })],
  ])(
    'skips discovery for a %s on cold and expired caches',
    async (_name, bearer) => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(0);

      await expect(service.verify(bearer)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockCreateRemoteJWKSet).not.toHaveBeenCalled();
      expect(mockJwtVerify).not.toHaveBeenCalled();

      await service.verify(validToken);
      now.mockReturnValue(300_000);
      jest.clearAllMocks();

      await expect(service.verify(bearer)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockCreateRemoteJWKSet).not.toHaveBeenCalled();
      expect(mockJwtVerify).not.toHaveBeenCalled();
    },
  );

  it('keeps the key client after failed discovery and replaces it after a URL change', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(0);
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ issuer: base, jwks_uri: `${base}/keys` }),
    });
    await expect(service.verify(validToken)).resolves.not.toBeNull();
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(
      new URL(`${base}/keys`),
      expect.anything(),
    );

    now.mockReturnValue(300_000);
    fetchMock.mockRejectedValue(new Error('discovery unavailable'));
    await expect(service.verify(validToken)).resolves.not.toBeNull();
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);

    now.mockReturnValue(600_000);
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ issuer: base, jwks_uri: `${base}/new-keys` }),
    });
    await expect(service.verify(validToken)).resolves.not.toBeNull();
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(2);
    expect(mockCreateRemoteJWKSet).toHaveBeenLastCalledWith(
      new URL(`${base}/new-keys`),
      expect.anything(),
    );
  });
});
