import { Departments } from '@db';
import { createHash } from 'node:crypto';
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

import { cosineToUnitScore, upsertEntityEmbeddings } from './index';

beforeEach(() => {
  upsertMock.mockReset();
  queryMock.mockReset();
  infoMock.mockReset();
  deleteMock.mockReset();
  rangeMock.mockReset();
  embedMock.mockReset();
  embedMock.mockImplementation((texts: string[]) => texts.map(() => Array(1024).fill(0.5)));
});

describe('upsertEntityEmbeddings', () => {
  it('upserts each entity with the right id format and returns applied hashes', async () => {
    const result = await upsertEntityEmbeddings({
      organizationId: 'org_1',
      kind: 'risk',
      entities: [
        { id: 'rsk_a', text: 'phishing risk' },
        { id: 'rsk_b', text: 'data breach risk' },
      ],
    });
    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'risk_org_1_rsk_a',
        metadata: expect.objectContaining({
          organizationId: 'org_1',
          sourceType: 'risk',
          sourceId: 'rsk_a',
        }),
      }),
    );
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'risk_org_1_rsk_b',
      }),
    );
    expect(result.appliedHashes.map((h) => h.id).sort()).toEqual(['rsk_a', 'rsk_b']);
    expect(result.appliedHashes.every((h) => /^[a-f0-9]{64}$/.test(h.hash))).toBe(true);
    expect(result.skippedCount).toBe(0);
  });

  it('skips entities with empty text', async () => {
    const result = await upsertEntityEmbeddings({
      organizationId: 'org_1',
      kind: 'task',
      entities: [
        { id: 'tsk_a', text: '' },
        { id: 'tsk_b', text: '   ' },
        { id: 'tsk_c', text: 'real task' },
      ],
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'task_org_1_tsk_c' }));
    expect(result.appliedHashes.map((h) => h.id)).toEqual(['tsk_c']);
  });

  it('persists department in metadata when provided', async () => {
    await upsertEntityEmbeddings({
      organizationId: 'org_1',
      kind: 'task',
      entities: [{ id: 'tsk_a', text: 'hr task', department: Departments.hr }],
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ department: 'hr' }),
      }),
    );
  });

  it('skips entities whose existing hash matches (no embed, no upsert)', async () => {
    // First call: capture the hashes the store sees written.
    const first = await upsertEntityEmbeddings({
      organizationId: 'org_1',
      kind: 'task',
      entities: [
        { id: 'tsk_a', text: 'unchanged text', department: Departments.hr },
        { id: 'tsk_b', text: 'also unchanged' },
      ],
    });
    expect(upsertMock).toHaveBeenCalledTimes(2);

    upsertMock.mockClear();

    // Second call with the SAME content + the recorded hashes — should skip.
    const existing = new Map(first.appliedHashes.map((h) => [h.id, h.hash]));
    const second = await upsertEntityEmbeddings({
      organizationId: 'org_1',
      kind: 'task',
      entities: [
        { id: 'tsk_a', text: 'unchanged text', department: Departments.hr },
        { id: 'tsk_b', text: 'also unchanged' },
      ],
      existingHashes: existing,
    });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(second.appliedHashes).toEqual([]);
    expect(second.skippedCount).toBe(2);
  });

  it('only re-embeds entities whose text or department changed', async () => {
    const first = await upsertEntityEmbeddings({
      organizationId: 'org_1',
      kind: 'task',
      entities: [
        { id: 'tsk_a', text: 'original text' },
        { id: 'tsk_b', text: 'stable text' },
        { id: 'tsk_c', text: 'no department' },
      ],
    });
    upsertMock.mockClear();

    const existing = new Map(first.appliedHashes.map((h) => [h.id, h.hash]));
    const second = await upsertEntityEmbeddings({
      organizationId: 'org_1',
      kind: 'task',
      entities: [
        { id: 'tsk_a', text: 'updated text' }, // text changed → re-embed
        { id: 'tsk_b', text: 'stable text' }, // unchanged → skip
        { id: 'tsk_c', text: 'no department', department: Departments.hr }, // dept added → re-embed
      ],
      existingHashes: existing,
    });
    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(second.appliedHashes.map((h) => h.id).sort()).toEqual(['tsk_a', 'tsk_c']);
    expect(second.skippedCount).toBe(1);
  });
});

describe('cosineToUnitScore', () => {
  it('maps identical vectors to 1, opposite to 0, orthogonal to 0.5', () => {
    expect(cosineToUnitScore([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosineToUnitScore([1, 0], [-1, 0])).toBeCloseTo(0, 10);
    expect(cosineToUnitScore([1, 0], [0, 1])).toBeCloseTo(0.5, 10);
  });

  it('is magnitude-invariant (pure cosine) and matches the vector store (1+cos)/2', () => {
    // Same direction, different magnitudes → still 1.
    expect(cosineToUnitScore([2, 0], [5, 0])).toBeCloseTo(1, 10);
    // cos = 0.6 → (1 + 0.6) / 2 = 0.8
    expect(cosineToUnitScore([3, 4], [3, 0])).toBeCloseTo(0.8, 10);
  });

  it('returns 0 for a zero vector instead of NaN', () => {
    expect(cosineToUnitScore([0, 0], [1, 1])).toBe(0);
    expect(cosineToUnitScore([1, 1], [0, 0])).toBe(0);
  });
});

describe('model identity cache migration', () => {
  it('rebuilds vectors whose old hash lacks the provider identity', async () => {
    const oldHash = createHash('sha256').update('bge-m3:1024::text').digest('hex');
    const result = await upsertEntityEmbeddings({
      organizationId: 'org_1',
      kind: 'task',
      entities: [{ id: 'tsk_1', text: 'text' }],
      existingHashes: new Map([['tsk_1', oldHash]]),
    });
    expect(embedMock).toHaveBeenCalledWith(['text']);
    expect(result.appliedHashes[0].hash).not.toBe(oldHash);
  });
});
