import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { query, execute, tenant } = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
  tenant: vi.fn(),
}));
vi.mock('./client', () => ({ withTenant: tenant, withService: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgresql://localhost/test');
  vi.stubEnv('EMBEDDINGS_PROVIDER', 'bedrock');
  vi.stubEnv('EMBEDDING_MODEL', 'amazon.titan-embed-text-v2:0');
  tenant.mockImplementation(
    async (
      _org: string,
      callback: (tx: { $queryRaw: typeof query; $executeRaw: typeof execute }) => Promise<unknown>,
    ) => callback({ $queryRaw: query, $executeRaw: execute }),
  );
  query.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());
describe('vector model isolation', () => {
  it('stamps current model identity on inserts and conflict updates', async () => {
    const { vectorIndex } = await import('./vector-index');
    await vectorIndex?.upsert({
      id: 'policy_1',
      vector: [0.1],
      metadata: { organizationId: 'org_1', sourceType: 'policy', sourceId: 'pol_1' },
    });
    const statement: Prisma.Sql = execute.mock.calls[0][0];
    expect(statement.sql).toContain('"embeddingModel" = EXCLUDED."embeddingModel"');
    expect(statement.values).toContain('bedrock:amazon.titan-embed-text-v2:0:1024');
    expect(tenant).toHaveBeenCalledWith('org_1', expect.any(Function));
  });
  it('filters incompatible and legacy vectors before similarity ranking', async () => {
    const { vectorIndex } = await import('./vector-index');
    await vectorIndex?.query({ vector: [0.1], topK: 5, organizationId: 'org_1' });
    const statement: Prisma.Sql = query.mock.calls[0][0];
    expect(statement.sql).toContain('AND "embeddingModel" = ?');
    expect(statement.sql.indexOf('"embeddingModel" =')).toBeLessThan(
      statement.sql.indexOf('ORDER BY'),
    );
    expect(statement.values).toContain('bedrock:amazon.titan-embed-text-v2:0:1024');
    expect(statement.values).toContain('org_1');
  });
});

describe('atomic document batches', () => {
  it('commits all chunks through one tenant transaction and SQL statement', async () => {
    const { upsertVectors } = await import('./vector-index');
    await upsertVectors({
      organizationId: 'org_1',
      records: ['chunk_1', 'chunk_2'].map((id) => ({
        id,
        vector: [0.1],
        metadata: { organizationId: 'org_1', sourceType: 'policy', sourceId: 'pol_1' },
      })),
    });
    expect(tenant).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    const statement: Prisma.Sql = execute.mock.calls[0][0];
    expect(statement.values).toContain('chunk_1');
    expect(statement.values).toContain('chunk_2');
  });
  it('rejects cross-tenant batches before any write', async () => {
    const { upsertVectors } = await import('./vector-index');
    await expect(
      upsertVectors({
        organizationId: 'org_1',
        records: [
          {
            id: 'chunk_1',
            vector: [0.1],
            metadata: { organizationId: 'org_2', sourceType: 'policy', sourceId: 'pol_1' },
          },
        ],
      }),
    ).rejects.toThrow('one organization');
    expect(tenant).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
