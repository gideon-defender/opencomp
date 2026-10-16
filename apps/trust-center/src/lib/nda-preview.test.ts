import { afterEach, describe, expect, it, vi } from 'vitest';
import { trustApi } from './api';

describe('NDA preview PDF validation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    new Blob([], { type: 'application/pdf' }),
    new Blob(['{"pdfDownloadUrl":"http://localstack:4566/file.pdf"}'], {
      type: 'application/json',
    }),
  ])('rejects an empty or non-PDF response', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => body }));
    await expect(trustApi.previewNda('token')).rejects.toThrow('Trust API request failed');
  });
});
