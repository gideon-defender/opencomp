import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDING_MODEL, embedTexts } from './embedding-client';

describe('embedTexts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.EMBEDDINGS_BASE_URL;
  });

  it('posts the model and inputs to /api/embed and returns the vectors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await embedTexts(['alpha', 'beta']);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/embed',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: ['alpha', 'beta'] }),
      }),
    );
    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it('uses EMBEDDINGS_BASE_URL when set', async () => {
    process.env.EMBEDDINGS_BASE_URL = 'http://tei:8080';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[1]] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await embedTexts(['x']);

    expect(fetchMock.mock.calls[0][0]).toBe('http://tei:8080/api/embed');
  });

  it('accepts a bare-array response (TEI legacy shape)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [[0.5, 0.6]],
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(embedTexts(['x'])).resolves.toEqual([[0.5, 0.6]]);
  });

  it('throws when the server returns a non-ok status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'unavailable',
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(embedTexts(['x'])).rejects.toThrow(/503/);
  });

  it('throws when the response is missing embeddings', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'no model loaded' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(embedTexts(['x'])).rejects.toThrow(/missing embeddings/);
  });

  it.each([{ embeddings: [['bad']] }, { embeddings: [[0.1], [0.2]] }])(
    'rejects invalid vectors or mismatched batch counts',
    async (data) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
      await expect(embedTexts(['text'])).rejects.toThrow(/embedding|vector/i);
    },
  );

  it('returns [] for empty/whitespace-only input without calling the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(embedTexts(['', '   '])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
