import {
  CheckrIntakeClient,
  CheckrIntakeRejected,
} from './checkr-intake-client';

describe('Checkr candidate intake client', () => {
  const fetchMock = jest.fn();
  const client = new CheckrIntakeClient({
    apiKey: 'tenant-key',
    environment: 'sandbox',
  });
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });
  afterAll(() => jest.restoreAllMocks());

  it('verifies credentials against the configured account', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'account-b' })),
    );
    await expect(client.verifyAccount('account-a')).rejects.toThrow(
      'do not match',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.checkr-staging.com/v1/account',
      expect.anything(),
    );
  });

  it('keeps account read rejection distinct from a definite vendor-write rejection', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(client.verifyAccount('account-a')).rejects.not.toBeInstanceOf(
      CheckrIntakeRejected,
    );
  });

  it('uses hosted invitations with frozen work location and idempotency key', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'inv_1' })));
    await expect(
      client.invite({
        candidateId: 'c_1',
        package: 'basic',
        key: 'stable-key',
        node: null,
        country: 'US',
        state: 'CA',
        city: 'Oakland',
      }),
    ).resolves.toBe('inv_1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.checkr-staging.com/v1/invitations',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': 'stable-key' }),
        body: JSON.stringify({
          candidate_id: 'c_1',
          package: 'basic',
          work_locations: [{ country: 'US', state: 'CA', city: 'Oakland' }],
        }),
      }),
    );
  });

  it('never falls back to direct reports when invitations are unavailable', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(
      client.invite({
        candidateId: 'c_1',
        package: 'basic',
        key: 'key',
        node: null,
        country: 'US',
        state: 'CA',
        city: null,
      }),
    ).rejects.toBeInstanceOf(CheckrIntakeRejected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([409, 429, 500])(
    'keeps an ambiguous/transient %s recoverable',
    async (status) => {
      fetchMock.mockResolvedValue(new Response('{}', { status }));
      await expect(
        client.createCandidate({
          email: 'a@b.com',
          firstName: 'A',
          lastName: 'B',
          key: 'key',
        }),
      ).rejects.toThrow('needs recovery');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
