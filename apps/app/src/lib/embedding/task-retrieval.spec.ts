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

import { findSimilarTasks } from './index';

beforeEach(() => {
  upsertMock.mockReset();
  queryMock.mockReset();
  infoMock.mockReset();
  deleteMock.mockReset();
  rangeMock.mockReset();
  embedMock.mockReset();
  embedMock.mockImplementation((texts: string[]) => texts.map(() => Array(1024).fill(0.5)));
});

describe('findSimilarTasks', () => {
  // Range page helper — `nextCursor: ''` signals the enumeration is drained.
  function taskPage(
    vectors: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>,
  ) {
    rangeMock.mockResolvedValueOnce({ nextCursor: '', vectors });
  }

  it('enumerates the org task vectors by prefix and ranks them in-process by cosine', async () => {
    // Query points along [1,0]; task vectors are chosen so the cosine ordering
    // is deterministic: tsk_a (identical) > tsk_b (orthogonal) > tsk_c (opposite).
    embedMock.mockResolvedValueOnce([[1, 0]]);
    taskPage([
      {
        id: 'task_org_1_tsk_b',
        vector: [0, 1],
        metadata: { embeddingModel: 'ollama:bge-m3:1024', sourceId: 'tsk_b', department: 'none' },
      },
      {
        id: 'task_org_1_tsk_a',
        vector: [1, 0],
        metadata: { embeddingModel: 'ollama:bge-m3:1024', sourceId: 'tsk_a', department: 'hr' },
      },
      {
        id: 'task_org_1_tsk_c',
        vector: [-1, 0],
        metadata: { embeddingModel: 'ollama:bge-m3:1024', sourceId: 'tsk_c' },
      },
    ]);

    const results = await findSimilarTasks({
      organizationId: 'org_1',
      queryText: 'phishing risk',
      topK: 10,
    });

    // Enumerates via prefix range WITH the stored vectors — never an ANN query.
    expect(rangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: '0',
        prefix: 'task_org_1_',
        includeVectors: true,
        includeMetadata: true,
      }),
    );
    expect(queryMock).not.toHaveBeenCalled();
    // Sorted by score desc, scores on the (1+cos)/2 scale.
    expect(results).toEqual([
      { id: 'tsk_a', score: 1, department: 'hr' },
      { id: 'tsk_b', score: 0.5, department: 'none' },
      { id: 'tsk_c', score: 0, department: undefined },
    ]);
  });

  it('applies the topK cap after ranking', async () => {
    embedMock.mockResolvedValueOnce([[1, 0]]);
    taskPage([
      {
        id: 'task_org_1_tsk_a',
        vector: [1, 0],
        metadata: { embeddingModel: 'ollama:bge-m3:1024', sourceId: 'tsk_a' },
      },
      {
        id: 'task_org_1_tsk_b',
        vector: [0.9, 0.1],
        metadata: { embeddingModel: 'ollama:bge-m3:1024', sourceId: 'tsk_b' },
      },
      {
        id: 'task_org_1_tsk_c',
        vector: [-1, 0],
        metadata: { embeddingModel: 'ollama:bge-m3:1024', sourceId: 'tsk_c' },
      },
    ]);

    const results = await findSimilarTasks({
      organizationId: 'org_1',
      queryText: 'phishing risk',
      topK: 2,
    });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual(['tsk_a', 'tsk_b']);
  });

  it('paginates the enumeration across cursor pages', async () => {
    embedMock.mockResolvedValueOnce([[1, 0]]);
    rangeMock
      .mockResolvedValueOnce({
        nextCursor: 'cursor_2',
        vectors: [
          {
            id: 'task_org_1_tsk_p1',
            vector: [1, 0],
            metadata: { embeddingModel: 'ollama:bge-m3:1024', sourceId: 'tsk_p1' },
          },
        ],
      })
      .mockResolvedValueOnce({
        nextCursor: '',
        vectors: [
          {
            id: 'task_org_1_tsk_p2',
            vector: [0, 1],
            metadata: { embeddingModel: 'ollama:bge-m3:1024', sourceId: 'tsk_p2' },
          },
        ],
      });

    const results = await findSimilarTasks({ organizationId: 'org_1', queryText: 'x' });

    expect(rangeMock).toHaveBeenCalledTimes(2);
    expect(rangeMock.mock.calls[1][0]).toEqual(
      expect.objectContaining({ cursor: 'cursor_2', prefix: 'task_org_1_' }),
    );
    // A task from page 2 is included in the ranking.
    expect(results.map((r) => r.id).sort()).toEqual(['tsk_p1', 'tsk_p2']);
  });

  it('returns empty when query text is empty (no embed, no range)', async () => {
    const results = await findSimilarTasks({ organizationId: 'org_1', queryText: '   ' });
    expect(results).toEqual([]);
    expect(rangeMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns empty when the org has no task vectors', async () => {
    embedMock.mockResolvedValueOnce([[1, 0]]);
    taskPage([]);
    const results = await findSimilarTasks({ organizationId: 'org_1', queryText: 'x' });
    expect(results).toEqual([]);
  });

  it('recovers the raw task id from the prefix when metadata.sourceId is missing', async () => {
    // Legacy vector with no sourceId metadata. Returning the prefixed embedding
    // id would make runLinkage drop it as "not in live scope" (taskById is keyed
    // by raw ids), silently starving suggestions. (cubic P1)
    embedMock.mockResolvedValueOnce([[1, 0]]);
    taskPage([
      {
        id: 'task_org_1_tsk_legacy',
        vector: [1, 0],
        metadata: { embeddingModel: 'ollama:bge-m3:1024' },
      },
    ]);

    const results = await findSimilarTasks({ organizationId: 'org_1', queryText: 'phishing risk' });

    expect(results).toEqual([{ id: 'tsk_legacy', score: 1, department: undefined }]);
  });
});

describe('task vector model isolation', () => {
  it('does not rank legacy or different-model vectors', async () => {
    rangeMock.mockResolvedValue({
      vectors: [
        {
          id: 'task_org_1_current',
          vector: [1, 0, 0],
          metadata: { sourceId: 'current', embeddingModel: 'ollama:bge-m3:1024' },
        },
        { id: 'task_org_1_legacy', vector: [1, 0, 0], metadata: { sourceId: 'legacy' } },
        {
          id: 'task_org_1_titan',
          vector: [1, 0, 0],
          metadata: { sourceId: 'titan', embeddingModel: 'bedrock:titan:1024' },
        },
      ],
      nextCursor: null,
    });
    const results = await findSimilarTasks({ organizationId: 'org_1', queryText: 'text' });
    expect(results.map(({ id }) => id)).toEqual(['current']);
  });
});
