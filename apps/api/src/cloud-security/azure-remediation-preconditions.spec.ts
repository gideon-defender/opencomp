import { checkAzureWriteAccess } from './azure-remediation-preconditions';

function okJson(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('checkAzureWriteAccess', () => {
  const params = { accessToken: 'sp-token', subscriptionId: 'sub-1' };

  it('passes when a write grant is present', async () => {
    const fetchFn = jest.fn(async () =>
      okJson({
        value: [{ actions: ['Microsoft.Storage/storageAccounts/write'] }],
      }),
    );
    await expect(
      checkAzureWriteAccess({ ...params, fetchFn }),
    ).resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('throws when no write grant is held (fail closed, no Contributor advice)', async () => {
    const fetchFn = jest.fn(async () =>
      okJson({
        value: [{ actions: ['Microsoft.Storage/storageAccounts/read'] }],
      }),
    );
    await expect(checkAzureWriteAccess({ ...params, fetchFn })).rejects.toThrow(
      /no write grant/,
    );
  });

  it('throws when the check call itself fails (unproven writes do not run)', async () => {
    const failed = jest.fn(async () => okJson({ error: 'boom' }, 500));
    await expect(
      checkAzureWriteAccess({ ...params, fetchFn: failed }),
    ).rejects.toThrow(/\(500\)/);

    const down = jest.fn(async () => {
      throw new Error('socket hangup');
    });
    await expect(
      checkAzureWriteAccess({ ...params, fetchFn: down }),
    ).rejects.toThrow(/unreachable/);
  });
});
