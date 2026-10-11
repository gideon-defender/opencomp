jest.mock('../core/find-existing-embeddings', () => ({
  findAllOrganizationEmbeddings: jest.fn(),
}));
jest.mock('./sync-policies', () => ({ syncPolicies: jest.fn() }));
jest.mock('./sync-context', () => ({ syncContextEntries: jest.fn() }));
jest.mock('./sync-knowledge-base', () => ({
  syncKnowledgeBaseDocuments: jest.fn(),
}));
jest.mock('./sync-manual-answers', () => ({ syncManualAnswers: jest.fn() }));
jest.mock('./delete-orphaned-embeddings', () => ({
  deleteOrphanedEmbeddings: jest.fn(),
}));
jest.mock('./verify-embedding', () => ({ verifyEmbeddingIsReady: jest.fn() }));
import { findAllOrganizationEmbeddings } from '../core/find-existing-embeddings';
import { syncPolicies } from './sync-policies';
import { syncContextEntries } from './sync-context';
import { syncKnowledgeBaseDocuments } from './sync-knowledge-base';
import { syncManualAnswers } from './sync-manual-answers';
import { deleteOrphanedEmbeddings } from './delete-orphaned-embeddings';
import { syncOrganizationEmbeddings } from './sync-organization';
const stats = {
  created: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  total: 0,
  lastUpsertedEmbeddingId: null,
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(findAllOrganizationEmbeddings).mockResolvedValue(new Map());
  for (const sync of [
    syncPolicies,
    syncContextEntries,
    syncKnowledgeBaseDocuments,
    syncManualAnswers,
  ])
    jest.mocked(sync).mockResolvedValue(stats);
  jest.mocked(deleteOrphanedEmbeddings).mockResolvedValue(0);
});
describe('document rebuild completion', () => {
  it.each(['policy', 'context', 'knowledge-base', 'manual-answer'])(
    'rejects incomplete %s rebuilds',
    async (source) => {
      const sync =
        source === 'policy'
          ? syncPolicies
          : source === 'context'
            ? syncContextEntries
            : source === 'knowledge-base'
              ? syncKnowledgeBaseDocuments
              : syncManualAnswers;
      jest.mocked(sync).mockResolvedValue({ ...stats, failed: 1 });
      await expect(syncOrganizationEmbeddings('org_1')).rejects.toThrow(
        'rebuild failed for 1 sources',
      );
    },
  );
  it('retries a failed rebuild on the next request', async () => {
    jest.mocked(syncPolicies).mockResolvedValueOnce({ ...stats, failed: 1 });
    await expect(syncOrganizationEmbeddings('org_1')).rejects.toThrow(
      'rebuild failed',
    );
    await expect(syncOrganizationEmbeddings('org_1')).resolves.toBeUndefined();
    expect(syncPolicies).toHaveBeenCalledTimes(2);
  });
  it('shares a pending rebuild between concurrent requests in the same organization', async () => {
    let complete: (() => void) | undefined;
    jest.mocked(syncPolicies).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = () => resolve(stats);
        }),
    );
    const first = syncOrganizationEmbeddings('org_1');
    const second = syncOrganizationEmbeddings('org_1');
    await Promise.resolve();
    await Promise.resolve();
    expect(syncPolicies).toHaveBeenCalledTimes(1);
    complete?.();
    await Promise.all([first, second]);
  });
});
