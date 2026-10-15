import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/permissions.server', () => ({
  requireApiPermission: vi.fn(),
}));

vi.mock('@/lib/api-server', () => ({
  serverApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { serverApi } from '@/lib/api-server';
import { requireApiPermission } from '@/lib/permissions.server';
import { POST } from './route';

const mockedRequire = vi.mocked(requireApiPermission);
const mockedGet = vi.mocked(serverApi.get);
const mockedPost = vi.mocked(serverApi.post);
const mockedPut = vi.mocked(serverApi.put);
const mockedDelete = vi.mocked(serverApi.delete);

const validBody = {
  organizationId: 'org_1',
  accountId: 'acc_123',
  environment: 'production',
  package: 'tasker_standard',
  apiKey: 'key_live_123',
};

function req(body: unknown) {
  return new Request('http://test/api/checkr/configure', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function grant() {
  mockedRequire.mockResolvedValue({
    organizationId: 'org_1',
    userId: 'u_1',
    permissions: { integration: ['update'], secret: ['create', 'delete'] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  grant();
  mockedGet.mockResolvedValue({ data: { data: [] }, status: 200 });
  mockedPost.mockResolvedValue({
    data: { secret: { id: 'sec_1' } },
    status: 201,
  });
  mockedPut.mockResolvedValue({
    data: { accountId: 'acc_123', enabled: true },
    status: 200,
  });
  mockedDelete.mockResolvedValue({ data: { success: true }, status: 200 });
});

describe('POST /api/checkr/configure', () => {
  it.each([{ secret: [] }, { secret: ['create'] }, { secret: ['delete'] }])(
    'rejects incomplete secret permissions $secret before any writes',
    async ({ secret }) => {
      mockedRequire.mockResolvedValue({
        organizationId: 'org_1',
        userId: 'u_1',
        permissions: { integration: ['update'], secret },
      });

      const res = await POST(req(validBody));

      expect(res.status).toBe(403);
      expect(mockedPost).not.toHaveBeenCalled();
      expect(mockedPut).not.toHaveBeenCalled();
      expect(mockedDelete).not.toHaveBeenCalled();
    },
  );

  it('rejects without integration update permission', async () => {
    mockedRequire.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));

    const res = await POST(req(validBody));

    expect(res.status).toBe(403);
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedPut).not.toHaveBeenCalled();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('rejects a stale page tenant before touching secrets', async () => {
    const res = await POST(req({ ...validBody, organizationId: 'org_other' }));

    expect(res.status).toBe(409);
    expect(mockedGet).not.toHaveBeenCalled();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedPut).not.toHaveBeenCalled();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('requires the page tenant before touching secrets', async () => {
    const res = await POST(req({ ...validBody, organizationId: undefined }));

    expect(res.status).toBe(400);
    expect(mockedGet).not.toHaveBeenCalled();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('rejects an invalid body without touching secrets', async () => {
    const res = await POST(req({ ...validBody, apiKey: '' }));

    expect(res.status).toBe(400);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only API key', async () => {
    const res = await POST(req({ ...validBody, apiKey: '   ' }));

    expect(res.status).toBe(400);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('creates the tenant secret then configures intake', async () => {
    const res = await POST(req(validBody));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockedPost).toHaveBeenCalledWith(
      '/v1/secrets',
      expect.objectContaining({
        name: expect.stringMatching(/^checkr-api-key-/),
        value: 'key_live_123',
      }),
      { 'X-Organization-Id': 'org_1' },
    );
    expect(mockedPut).toHaveBeenCalledWith(
      '/v1/people/candidate-screenings/connection',
      expect.objectContaining({ accountId: 'acc_123', apiKeySecretId: 'sec_1' }),
      { 'X-Organization-Id': 'org_1' },
    );
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(body.connection).toMatchObject({ accountId: 'acc_123' });
  });

  it('uses a separate version without modifying or deleting the previous credential', async () => {
    mockedGet.mockResolvedValue({
      data: { data: [{ id: 'sec_old', name: 'checkr-api-key' }] },
      status: 200,
    });
    mockedPost.mockResolvedValue({ data: { secret: { id: 'sec_new' } }, status: 201 });

    const res = await POST(req(validBody));

    expect(res.status).toBe(200);
    expect(mockedPost).toHaveBeenCalledWith(
      '/v1/secrets',
      expect.objectContaining({ name: expect.stringMatching(/^checkr-api-key-/) }),
      { 'X-Organization-Id': 'org_1' },
    );
    expect(mockedPut).toHaveBeenCalledExactlyOnceWith(
      '/v1/people/candidate-screenings/connection',
      expect.objectContaining({ apiKeySecretId: 'sec_new' }),
      { 'X-Organization-Id': 'org_1' },
    );
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('uses unique secret names for successive saves', async () => {
    await POST(req(validBody));
    await POST(req(validBody));

    const first = mockedPost.mock.calls[0][1];
    const second = mockedPost.mock.calls[1][1];
    expect(first).not.toEqual(second);
  });

  it.each([400, 403, 409, 422])(
    'removes only the proposed secret after rejection (%i)',
    async (status) => {
      mockedPut.mockResolvedValue({
        data: null,
        error: 'Checkr rejected the configuration.',
        status,
      });

      const res = await POST(req(validBody));

      expect(res.status).toBe(status);
      expect(mockedPut).toHaveBeenCalledTimes(1);
      expect(mockedDelete).toHaveBeenCalledExactlyOnceWith('/v1/secrets/sec_1', {
        'X-Organization-Id': 'org_1',
      });
    },
  );

  it.each([408, 500, 502, 504])(
    'retains the proposed secret after an uncertain result (%i)',
    async (status) => {
      mockedPut.mockResolvedValue({ data: null, error: 'Connection update failed.', status });

      const res = await POST(req(validBody));

      expect(res.status).toBe(status);
      expect(mockedDelete).not.toHaveBeenCalled();
    },
  );

  it('retains the proposed secret when the connection request throws', async () => {
    mockedPut.mockRejectedValueOnce(new Error('Network error'));

    const res = await POST(req(validBody));

    expect(res.status).toBe(500);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('preserves the validation error when secret cleanup fails', async () => {
    mockedPut.mockResolvedValue({ data: null, error: 'Invalid Checkr key.', status: 400 });
    mockedDelete.mockRejectedValueOnce(new Error('Cleanup failed'));

    const res = await POST(req(validBody));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid Checkr key.' });
  });

  it('rejects an unexpected secret response before configuring intake', async () => {
    mockedPost.mockResolvedValue({ data: { id: 'sec_wrong_envelope' }, status: 201 });

    const res = await POST(req(validBody));

    expect(res.status).toBe(500);
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it('surfaces secret creation permission failures with their own status', async () => {
    mockedPost.mockResolvedValue({ data: null, error: 'Forbidden', status: 403 });

    const res = await POST(req(validBody));

    expect(res.status).toBe(403);
    expect(mockedPut).not.toHaveBeenCalled();
  });
});
