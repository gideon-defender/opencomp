jest.mock('@gideon-defender/db', () => ({
  EMBEDDING_IDENTITY: 'bedrock:amazon.titan-embed-text-v2:0:1024',
}));
import { needsUpdate } from './embedding-freshness';
const updatedAt = '2026-10-11T00:00:00.000Z';
const current = {
  id: 'policy_1_chunk0',
  sourceId: 'policy_1',
  sourceType: 'policy' as const,
  updatedAt,
  embeddingModel: 'bedrock:amazon.titan-embed-text-v2:0:1024',
};
describe('document embedding freshness', () => {
  it.each([null, undefined, 'ollama:bge-m3:1024', 'bedrock:other:1024'])(
    'rebuilds unchanged documents for model %s',
    (embeddingModel) => {
      expect(
        needsUpdate({
          existingEmbeddings: [{ ...current, embeddingModel }],
          updatedAt,
        }),
      ).toBe(true);
    },
  );
  it('keeps unchanged current-model documents', () => {
    expect(needsUpdate({ existingEmbeddings: [current], updatedAt })).toBe(
      false,
    );
  });
  it('rebuilds if even one chunk has an old model', () => {
    expect(
      needsUpdate({
        existingEmbeddings: [current, { ...current, embeddingModel: null }],
        updatedAt,
      }),
    ).toBe(true);
  });
  it('rebuilds missing or modified sources', () => {
    expect(needsUpdate({ existingEmbeddings: [], updatedAt })).toBe(true);
    expect(
      needsUpdate({
        existingEmbeddings: [current],
        updatedAt: '2026-10-12T00:00:00.000Z',
      }),
    ).toBe(true);
  });
});
