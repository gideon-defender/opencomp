import {
  decodeAzureTokenClaims,
  mintAzureSpToken,
  readAzureEffectiveActions,
  type AzureFetch,
} from './azure-remediation-identity';

function tokenFor(claims: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${encoded}.signature`;
}

function okJson(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('mintAzureSpToken', () => {
  const params = {
    tenantId: 'tenant-1',
    clientId: 'client-1',
    clientSecret: 'secret-1',
  };

  it('returns the access token with its lifetime', async () => {
    const fetchMock = jest.fn(async () =>
      okJson({ access_token: 'tok', expires_in: 3599 }),
    );
    const fetchFn = fetchMock as unknown as AzureFetch;
    const token = await mintAzureSpToken({ ...params, fetchFn });
    expect(token).toEqual({ accessToken: 'tok', expiresIn: 3599 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain('/tenant-1/oauth2/v2.0/token');
    expect(init?.body as string).toContain('grant_type=client_credentials');
  });

  it('defaults string lifetimes and throws without a token', async () => {
    const fetchFn = jest.fn(async () =>
      okJson({ access_token: 'tok', expires_in: '3600' }),
    ) as unknown as AzureFetch;
    const token = await mintAzureSpToken({ ...params, fetchFn });
    expect(token.expiresIn).toBe(3600);

    const empty = jest.fn(async () =>
      okJson({ expires_in: 3600 }),
    ) as unknown as AzureFetch;
    await expect(
      mintAzureSpToken({ ...params, fetchFn: empty }),
    ).rejects.toThrow(/no access token/);
  });

  it('throws visibly on HTTP and network failure (never certifies)', async () => {
    const denied = jest.fn(async () =>
      okJson({ error: 'invalid_client' }, 401),
    ) as unknown as AzureFetch;
    await expect(
      mintAzureSpToken({ ...params, fetchFn: denied }),
    ).rejects.toThrow(/\(401\)/);

    const down = jest.fn(async () => {
      throw new Error('socket hangup');
    }) as unknown as AzureFetch;
    await expect(
      mintAzureSpToken({ ...params, fetchFn: down }),
    ).rejects.toThrow(/unreachable/);
  });
});

describe('readAzureEffectiveActions', () => {
  it('returns the flattened effective actions', async () => {
    const fetchFn = jest.fn(async () =>
      okJson({ value: [{ actions: ['a/b'] }, { actions: ['c/d', 'e/f'] }] }),
    ) as unknown as AzureFetch;
    const result = await readAzureEffectiveActions({
      accessToken: 'tok',
      subscriptionId: 'sub-1',
      fetchFn,
    });
    expect(result).toEqual({ actions: ['a/b', 'c/d', 'e/f'] });
  });

  it('reports denial instead of throwing on 401/403', async () => {
    for (const status of [401, 403]) {
      const fetchFn = jest.fn(async () =>
        okJson({ error: { code: 'AuthorizationFailed' } }, status),
      ) as unknown as AzureFetch;
      const result = await readAzureEffectiveActions({
        accessToken: 'tok',
        subscriptionId: 'sub-1',
        fetchFn,
      });
      expect(result).toEqual({ denied: true });
    }
  });

  it('throws on other failures and unreachable hosts', async () => {
    const broken = jest.fn(async () =>
      okJson({ error: 'boom' }, 500),
    ) as unknown as AzureFetch;
    await expect(
      readAzureEffectiveActions({
        accessToken: 'tok',
        subscriptionId: 'sub-1',
        fetchFn: broken,
      }),
    ).rejects.toThrow(/\(500\)/);
  });
});

describe('decodeAzureTokenClaims', () => {
  it('extracts appid and tid from a minted-looking JWT', () => {
    expect(
      decodeAzureTokenClaims(tokenFor({ appid: 'app-1', tid: 'tenant-1' })),
    ).toEqual({ appid: 'app-1', tid: 'tenant-1' });
  });

  it('returns null for non-JWT input', () => {
    expect(decodeAzureTokenClaims('not-a-token')).toBeNull();
    expect(decodeAzureTokenClaims('')).toBeNull();
    expect(decodeAzureTokenClaims('a.b.c')).toBeNull();
  });
});
