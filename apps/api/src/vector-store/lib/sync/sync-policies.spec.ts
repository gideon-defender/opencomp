jest.mock('@db', () => ({ db: { policy: { findMany: jest.fn() } } }));
jest.mock('@gideon-defender/db', () => ({
  EMBEDDING_IDENTITY: 'bedrock:titan:1024',
}));
jest.mock('../utils/extract-policy-text', () => ({
  extractTextFromPolicy: jest.fn(() => 'Policy content'),
}));
jest.mock('./sync-utils', () => ({
  needsUpdate: jest.requireActual('./embedding-freshness').needsUpdate,
  deleteOldEmbeddings: jest.fn(),
  createChunkItems: jest.fn(() => [
    { id: 'policy_pol_1_chunk0', text: 'Policy content' },
  ]),
  upsertChunks: jest.fn(),
  initSyncStats: (total: number) => ({
    total,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    lastUpsertedEmbeddingId: null,
  }),
}));
import { db } from '@db';
import { upsertChunks } from './sync-utils';
import { syncPolicies } from './sync-policies';
const updatedAt = new Date('2026-10-11T00:00:00Z');
describe('unchanged policy model migration', () => {
  it('rebuilds legacy vectors once and skips current-model vectors afterward', async () => {
    const findMany = db.policy.findMany as jest.Mock;
    findMany.mockResolvedValue([
      {
        id: 'pol_1',
        name: 'Policy',
        content: [],
        updatedAt,
        organizationId: 'org_1',
      },
    ]);
    const legacy = {
      id: 'policy_pol_1_chunk0',
      sourceId: 'pol_1',
      sourceType: 'policy' as const,
      updatedAt: updatedAt.toISOString(),
      embeddingModel: null,
    };
    const rebuilt = await syncPolicies('org_1', new Map([['pol_1', [legacy]]]));
    expect(rebuilt.updated).toBe(1);
    expect(upsertChunks).toHaveBeenCalledTimes(1);
    const skipped = await syncPolicies(
      'org_1',
      new Map([
        ['pol_1', [{ ...legacy, embeddingModel: 'bedrock:titan:1024' }]],
      ]),
    );
    expect(skipped.skipped).toBe(1);
    expect(upsertChunks).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org_1' }),
      }),
    );
  });
});
