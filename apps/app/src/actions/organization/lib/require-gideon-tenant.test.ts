import { serverApi } from '@/lib/api-server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireGideonTenantId } from './require-gideon-tenant';
vi.mock('@/lib/api-server', () => ({ serverApi: { get: vi.fn() } }));

describe('requireGideonTenantId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the tenant authorized by the API for both setup actions', async () => {
    vi.mocked(serverApi.get).mockResolvedValue({ data: { tenantId: 'tenant-1' }, status: 200 });
    expect(await requireGideonTenantId({ user: { id: 'user-1' } })).toEqual({
      tenantId: 'tenant-1',
    });
    expect(serverApi.get).toHaveBeenCalledWith('/v1/auth/gideon/bootstrap');
  });

  it('rejects an old setup session when the API denies owner authorization', async () => {
    vi.mocked(serverApi.get).mockResolvedValue({ error: 'Forbidden', status: 403 });
    expect(await requireGideonTenantId({ user: { id: 'user-1' } })).toEqual({
      error: expect.stringContaining('owner assignment'),
    });
  });

  it('fails closed on malformed responses and API outages', async () => {
    for (const response of [
      { data: {}, status: 200 },
      { error: 'Unavailable', status: 503 },
    ]) {
      vi.mocked(serverApi.get).mockResolvedValue(response);
      expect(await requireGideonTenantId({ user: { id: 'user-1' } })).toHaveProperty('error');
    }
  });

  it('rejects missing sessions without an API call', async () => {
    expect(await requireGideonTenantId(null)).toEqual({ error: 'Not authorized.' });
    expect(serverApi.get).not.toHaveBeenCalled();
  });
});
