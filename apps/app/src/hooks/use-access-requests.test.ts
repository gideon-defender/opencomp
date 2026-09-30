import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { fetchPreviewNdaPdf } from './use-access-requests';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    raw: vi.fn(),
  },
  api: {},
}));

const mockRaw = vi.mocked(apiClient.raw);

describe('fetchPreviewNdaPdf', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns the PDF blob on success', async () => {
    mockRaw.mockResolvedValue(
      new Response('pdf-bytes', {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    );

    const result = await fetchPreviewNdaPdf('req_1');

    expect(mockRaw).toHaveBeenCalledWith(
      '/v1/trust-access/admin/requests/req_1/preview-nda',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(await result.text()).toBe('pdf-bytes');
  });

  it('encodes request ids with special characters', async () => {
    mockRaw.mockResolvedValue(
      new Response('pdf-bytes', {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    );

    await fetchPreviewNdaPdf('../evil');

    expect(mockRaw).toHaveBeenCalledWith(
      `/v1/trust-access/admin/requests/${encodeURIComponent('../evil')}/preview-nda`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws a not-found error on 404 so the caller can toast', async () => {
    mockRaw.mockResolvedValue(new Response('nope', { status: 404 }));

    await expect(fetchPreviewNdaPdf('missing')).rejects.toThrow(
      'Access request not found',
    );
  });

  it('throws a session error on 401 and a permission error on 403', async () => {
    mockRaw.mockResolvedValueOnce(new Response('x', { status: 401 }));
    await expect(fetchPreviewNdaPdf('req_1')).rejects.toThrow('Session expired');

    mockRaw.mockResolvedValueOnce(new Response('x', { status: 403 }));
    await expect(fetchPreviewNdaPdf('req_1')).rejects.toThrow(
      'Missing permission',
    );
  });

  it('throws a generic error on 500 so the caller can toast', async () => {
    mockRaw.mockResolvedValue(new Response('boom', { status: 500 }));

    await expect(fetchPreviewNdaPdf('req_1')).rejects.toThrow(
      'Failed to generate preview',
    );
  });
});
