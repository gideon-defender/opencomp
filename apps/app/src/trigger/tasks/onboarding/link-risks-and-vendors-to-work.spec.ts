import { Departments } from '@db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, upsertMock, findSimilarTasksMock, rerankSuggestionsMock } = vi.hoisted(() => ({
  dbMock: {
    risk: { findMany: vi.fn(), update: vi.fn() },
    vendor: { findMany: vi.fn(), update: vi.fn() },
    task: { findMany: vi.fn() },
  },
  upsertMock: vi.fn(),
  findSimilarTasksMock: vi.fn(),
  rerankSuggestionsMock: vi.fn(),
}));

vi.mock('@db/server', () => ({ db: dbMock }));

vi.mock('@/lib/embedding', () => ({
  upsertEntityEmbeddings: upsertMock,
  findSimilarTasks: findSimilarTasksMock,
  waitForIndexed: vi.fn().mockResolvedValue(undefined),
  pruneOrphanTaskVectors: vi.fn().mockResolvedValue({ deletedSourceIds: [] }),
}));

vi.mock('@/lib/rerank-suggestions', () => ({
  rerankSuggestions: rerankSuggestionsMock,
}));

vi.mock('@gideon-defender/trigger-local', () => ({
  task: (def: { run: (...args: unknown[]) => unknown }) => ({ run: def.run }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metadata: { set: vi.fn() },
}));

import { linkRisksAndVendorsToWork } from './link-risks-and-vendors-to-work';

const runTask = (
  linkRisksAndVendorsToWork as unknown as {
    run: (payload: {
      organizationId: string;
      riskId?: string;
      vendorId?: string;
    }) => Promise<unknown>;
  }
).run;

// By default the reranker echoes cosine scores scaled to a 0-10 range, so
// tests can reason about candidate ordering via the input `score` values
// they pass to findSimilarTasksMock.
beforeEach(() => {
  upsertMock.mockReset();
  upsertMock.mockResolvedValue({ appliedHashes: [], skippedCount: 0 });
  findSimilarTasksMock.mockReset();
  rerankSuggestionsMock.mockReset();
  rerankSuggestionsMock.mockImplementation(
    async ({ candidates }: { candidates: Array<{ id: string; cosineScore: number }> }) =>
      candidates
        .map((c) => ({ id: c.id, cosineScore: c.cosineScore, rerankScore: c.cosineScore * 10 }))
        .sort((a, b) => b.rerankScore - a.rerankScore),
  );
  Object.values(dbMock).forEach((m) =>
    Object.values(m as Record<string, ReturnType<typeof vi.fn>>).forEach((fn) => fn.mockReset()),
  );
});

describe('linkRisksAndVendorsToWork', () => {
  it('links only the high-confidence matches once the floor is already satisfied by them', async () => {
    dbMock.risk.findMany.mockResolvedValueOnce([
      {
        id: 'rsk_1',
        title: 'Phishing',
        description: 'Email phishing',
        category: 'people',
        department: Departments.hr,
      },
    ]);
    dbMock.vendor.findMany.mockResolvedValueOnce([]);
    dbMock.task.findMany.mockResolvedValueOnce([
      { id: 'tsk_a', title: 'Awareness training', description: '', department: Departments.hr },
      { id: 'tsk_b', title: 'Backup', description: '', department: Departments.it },
      { id: 'tsk_c', title: 'Phishing sim', description: '', department: Departments.hr },
      { id: 'tsk_d', title: 'Unrelated', description: '', department: Departments.it },
    ]);
    // rerankScore = cosineScore * 10 via the fallback mock: tsk_a/b/c score
    // >= AUTONOMOUS_MIN_RERANK_SCORE (5) and already meet the floor (3), so
    // the low-confidence tsk_d (rerankScore 2) is excluded entirely.
    findSimilarTasksMock.mockResolvedValueOnce([
      { id: 'tsk_a', score: 0.9, department: Departments.hr },
      { id: 'tsk_b', score: 0.8, department: Departments.it },
      { id: 'tsk_c', score: 0.6, department: Departments.hr },
      { id: 'tsk_d', score: 0.2, department: Departments.it },
    ]);

    await runTask({ organizationId: 'org_1' });

    expect(dbMock.risk.update).toHaveBeenCalledWith({
      where: { id: 'rsk_1' },
      data: {
        tasks: { connect: [{ id: 'tsk_a' }, { id: 'tsk_b' }, { id: 'tsk_c' }] },
      },
    });
  });

  it('falls back to the top candidate to guarantee a minimum link when the reranker is conservative', async () => {
    dbMock.risk.findMany.mockResolvedValueOnce([
      { id: 'rsk_1', title: 't', description: 'd', category: 'people', department: Departments.hr },
    ]);
    dbMock.vendor.findMany.mockResolvedValueOnce([]);
    dbMock.task.findMany.mockResolvedValueOnce([
      { id: 'tsk_a', title: 'irrelevant', description: '', department: Departments.it },
    ]);
    findSimilarTasksMock.mockResolvedValueOnce([
      { id: 'tsk_a', score: 0.3, department: Departments.it },
    ]);

    await runTask({ organizationId: 'org_1' });

    expect(dbMock.risk.update).toHaveBeenCalledWith({
      where: { id: 'rsk_1' },
      data: { tasks: { connect: [{ id: 'tsk_a' }] } },
    });
  });

  it('returns early when org has no tasks', async () => {
    dbMock.risk.findMany.mockResolvedValueOnce([
      { id: 'rsk_1', title: 't', description: 'd', category: 'people', department: Departments.hr },
    ]);
    dbMock.vendor.findMany.mockResolvedValueOnce([]);
    dbMock.task.findMany.mockResolvedValueOnce([]);

    await runTask({ organizationId: 'org_1' });

    expect(findSimilarTasksMock).not.toHaveBeenCalled();
    expect(dbMock.risk.update).not.toHaveBeenCalled();
  });

  it('scopes to a single risk when riskId is provided', async () => {
    dbMock.risk.findMany.mockResolvedValueOnce([
      { id: 'rsk_1', title: 'a', description: '', category: 'people', department: Departments.hr },
    ]);
    dbMock.vendor.findMany.mockResolvedValueOnce([]);
    dbMock.task.findMany.mockResolvedValueOnce([
      { id: 'tsk_a', title: 'awareness', description: '', department: Departments.hr },
    ]);
    findSimilarTasksMock.mockResolvedValueOnce([
      { id: 'tsk_a', score: 0.9, department: Departments.hr },
    ]);

    await runTask({ organizationId: 'org_1', riskId: 'rsk_1' });

    expect(dbMock.risk.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', id: 'rsk_1' },
      select: expect.any(Object),
    });
  });

  it('links vendors via _TaskToVendor when vendorId is provided', async () => {
    dbMock.risk.findMany.mockResolvedValueOnce([]);
    dbMock.vendor.findMany.mockResolvedValueOnce([
      {
        id: 'vnd_1',
        name: 'AcmeSaaS',
        description: 'cloud crm',
        category: 'software_as_a_service',
      },
    ]);
    dbMock.task.findMany.mockResolvedValueOnce([
      { id: 'tsk_a', title: 'vendor review', description: '', department: Departments.gov },
    ]);
    findSimilarTasksMock.mockResolvedValueOnce([
      { id: 'tsk_a', score: 0.85, department: Departments.gov },
    ]);

    await runTask({ organizationId: 'org_1', vendorId: 'vnd_1' });

    expect(dbMock.vendor.update).toHaveBeenCalledWith({
      where: { id: 'vnd_1' },
      data: { tasks: { connect: [{ id: 'tsk_a' }] } },
    });
  });
});
