import { beforeEach, describe, expect, it, vi } from 'vitest';

const { upsertMock, queryMock, infoMock, deleteMock, rangeMock, embedMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  queryMock: vi.fn(),
  infoMock: vi.fn(),
  deleteMock: vi.fn(),
  rangeMock: vi.fn(),
  embedMock: vi.fn(),
}));

vi.mock('@gideon-defender/db', () => ({
  vectorIndex: {
    upsert: upsertMock,
    query: queryMock,
    info: infoMock,
    delete: deleteMock,
    range: rangeMock,
  },
  embedTexts: embedMock,
  EMBEDDING_MODEL: 'bge-m3',
  EMBEDDING_IDENTITY: 'ollama:bge-m3:1024',
  EMBEDDING_DIMENSIONS: 1024,
}));

import { pruneOrphanTaskVectors, waitForIndexed } from './index';

beforeEach(() => {
  upsertMock.mockReset();
  queryMock.mockReset();
  infoMock.mockReset();
  deleteMock.mockReset();
  rangeMock.mockReset();
  embedMock.mockReset();
  embedMock.mockImplementation((texts: string[]) => texts.map(() => Array(1024).fill(0.5)));
});

describe('waitForIndexed', () => {
  function infoResult(pendingVectorCount: number) {
    return {
      vectorCount: 100,
      pendingVectorCount,
      indexSize: 1024,
      dimension: 1024,
      similarityFunction: 'COSINE' as const,
      namespaces: {},
    };
  }

  it('returns immediately when pending count is already zero', async () => {
    infoMock.mockResolvedValueOnce(infoResult(0));

    const result = await waitForIndexed({ maxWaitMs: 5000, intervalMs: 50 });

    expect(result.polls).toBe(1);
    expect(result.pendingAtTimeout).toBeUndefined();
    expect(infoMock).toHaveBeenCalledTimes(1);
  });

  it('polls until pending drains to zero', async () => {
    infoMock
      .mockResolvedValueOnce(infoResult(5))
      .mockResolvedValueOnce(infoResult(2))
      .mockResolvedValueOnce(infoResult(0));

    const result = await waitForIndexed({ maxWaitMs: 5000, intervalMs: 10 });

    expect(result.polls).toBe(3);
    expect(result.pendingAtTimeout).toBeUndefined();
    expect(infoMock).toHaveBeenCalledTimes(3);
  });

  it('returns with pendingAtTimeout when the deadline elapses before pending hits zero', async () => {
    // Always return non-zero pending — the timeout should kick in.
    infoMock.mockResolvedValue(infoResult(7));

    const result = await waitForIndexed({ maxWaitMs: 80, intervalMs: 20 });

    expect(result.pendingAtTimeout).toBe(7);
    expect(result.waitedMs).toBeGreaterThanOrEqual(80);
    // The timeout polls + the trailing diagnostic info() call.
    expect(infoMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('pruneOrphanTaskVectors', () => {
  // Single-page range result: `nextCursor: ''` tells the sweep it's drained.
  function onePage(vectors: Array<{ id: string; metadata?: { sourceId?: string } }>) {
    rangeMock.mockResolvedValueOnce({ nextCursor: '', vectors });
  }

  it('deletes only vectors whose sourceId is not in the live task set', async () => {
    onePage([
      {
        id: 'task_org_1_tsk_live',
        metadata: { sourceId: 'tsk_live' },
      },
      {
        id: 'task_org_1_tsk_orphan1',
        metadata: { sourceId: 'tsk_orphan1' },
      },
      {
        id: 'task_org_1_tsk_orphan2',
        metadata: { sourceId: 'tsk_orphan2' },
      },
    ]);
    deleteMock.mockResolvedValueOnce({ deleted: 2 });

    const result = await pruneOrphanTaskVectors({
      organizationId: 'org_1',
      liveTaskIds: new Set(['tsk_live']),
    });

    // Enumerates the org's task vectors via a prefix range (no topK ceiling),
    // starting from cursor '0'.
    expect(rangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: '0',
        prefix: 'task_org_1_',
        includeMetadata: true,
      }),
    );
    // No cosine query is used to enumerate for the prune.
    expect(queryMock).not.toHaveBeenCalled();
    // Deletes the orphan vectors by their prefixed embedding id — never the live one.
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith(
      ['task_org_1_tsk_orphan1', 'task_org_1_tsk_orphan2'],
      'org_1',
    );
    expect(result.deletedSourceIds).toEqual(['tsk_orphan1', 'tsk_orphan2']);
    expect(result.scanned).toBe(3);
  });

  it('does not call delete when every task vector is still live', async () => {
    onePage([
      {
        id: 'task_org_1_tsk_a',
        metadata: { sourceId: 'tsk_a' },
      },
      {
        id: 'task_org_1_tsk_b',
        metadata: { sourceId: 'tsk_b' },
      },
    ]);

    const result = await pruneOrphanTaskVectors({
      organizationId: 'org_1',
      liveTaskIds: new Set(['tsk_a', 'tsk_b']),
    });

    expect(deleteMock).not.toHaveBeenCalled();
    expect(result.deletedSourceIds).toEqual([]);
    expect(result.scanned).toBe(2);
  });

  it('batches deletes at 100 ids per call', async () => {
    // 250 orphans → three delete batches (100 + 100 + 50).
    const vectors = Array.from({ length: 250 }, (_, i) => ({
      id: `task_org_1_tsk_${i}`,
      metadata: { sourceId: `tsk_${i}` },
    }));
    onePage(vectors);
    deleteMock.mockResolvedValue({ deleted: 100 });

    const result = await pruneOrphanTaskVectors({
      organizationId: 'org_1',
      liveTaskIds: new Set(),
    });

    expect(deleteMock).toHaveBeenCalledTimes(3);
    expect(deleteMock.mock.calls[0][0]).toHaveLength(100);
    expect(deleteMock.mock.calls[1][0]).toHaveLength(100);
    expect(deleteMock.mock.calls[2][0]).toHaveLength(50);
    expect(result.deletedSourceIds).toHaveLength(250);
  });

  it('paginates the whole index via the cursor — orphans past page 1 are not missed', async () => {
    // Two pages: page 1 hands back a cursor, page 2 drains it. An orphan on the
    // SECOND page must still be found — the old top-1000 query would miss it on
    // a large org. (CS-681, cubic P2)
    rangeMock
      .mockResolvedValueOnce({
        nextCursor: 'cursor_2',
        vectors: [
          {
            id: 'task_org_1_tsk_live1',
            metadata: { sourceId: 'tsk_live1' },
          },
          {
            id: 'task_org_1_tsk_orphan_p1',
            metadata: { sourceId: 'tsk_orphan_p1' },
          },
        ],
      })
      .mockResolvedValueOnce({
        nextCursor: '',
        vectors: [
          {
            id: 'task_org_1_tsk_live2',
            metadata: { sourceId: 'tsk_live2' },
          },
          {
            id: 'task_org_1_tsk_orphan_p2',
            metadata: { sourceId: 'tsk_orphan_p2' },
          },
        ],
      });
    deleteMock.mockResolvedValue({ deleted: 1 });

    const result = await pruneOrphanTaskVectors({
      organizationId: 'org_1',
      liveTaskIds: new Set(['tsk_live1', 'tsk_live2']),
    });

    expect(rangeMock).toHaveBeenCalledTimes(2);
    // Second call reuses the returned cursor.
    expect(rangeMock.mock.calls[1][0]).toEqual(
      expect.objectContaining({ cursor: 'cursor_2', prefix: 'task_org_1_' }),
    );
    // Both orphans deleted, including the one on page 2.
    expect(result.deletedSourceIds.sort()).toEqual(['tsk_orphan_p1', 'tsk_orphan_p2']);
    expect(result.scanned).toBe(4);
  });

  it('falls back to the id-prefix when metadata.sourceId is missing (does not prune a live vector)', async () => {
    // Legacy vectors written before sourceId was stored in metadata. The raw
    // task id must be parsed from the `task_${org}_` prefix — treating the whole
    // prefixed id as a sourceId would (a) fail the liveTaskIds check and delete
    // a LIVE vector, and (b) push a bogus id into deletedSourceIds. (cubic P1)
    onePage([
      // Live task, but its vector has no sourceId metadata.
      { id: 'task_org_1_tsk_live', metadata: {} },
      // Genuine orphan, also missing sourceId metadata.
      { id: 'task_org_1_tsk_orphan', metadata: {} },
    ]);
    deleteMock.mockResolvedValueOnce({ deleted: 1 });

    const result = await pruneOrphanTaskVectors({
      organizationId: 'org_1',
      liveTaskIds: new Set(['tsk_live']),
    });

    // The live vector is preserved; only the true orphan is deleted...
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith(['task_org_1_tsk_orphan'], 'org_1');
    // ...and deletedSourceIds carries the RAW task id, so the caller's
    // embeddingHash clear targets a real row.
    expect(result.deletedSourceIds).toEqual(['tsk_orphan']);
  });

  it('continues past a failing delete batch and returns only successfully-deleted sourceIds', async () => {
    // 150 orphans → two batches (100 + 50). The first batch's delete throws
    // (transient store error); the sweep must still run batch 2 and must NOT
    // report batch 1's sourceIds as deleted — clearing their hashes while the
    // vectors survive is wasteful, but reporting them deleted while the vectors
    // are gone-but-cached would break re-embedding. (cubic P2)
    const vectors = Array.from({ length: 150 }, (_, i) => ({
      id: `task_org_1_tsk_${i}`,
      metadata: { sourceId: `tsk_${i}` },
    }));
    onePage(vectors);
    deleteMock
      .mockRejectedValueOnce(new Error('vector store 500'))
      .mockResolvedValueOnce({ deleted: 50 });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await pruneOrphanTaskVectors({
      organizationId: 'org_1',
      liveTaskIds: new Set(),
    });

    // Both batches attempted despite the first throwing.
    expect(deleteMock).toHaveBeenCalledTimes(2);
    // Only the second (successful) batch's 50 sourceIds are returned.
    expect(result.deletedSourceIds).toHaveLength(50);
    expect(result.deletedSourceIds).toEqual(vectors.slice(100).map((v) => v.metadata.sourceId));
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
