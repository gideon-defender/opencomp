import { Prisma } from '@prisma/client';
import { withService, withTenant } from './client';
import { EMBEDDING_IDENTITY } from './embedding-client';
import {
  escapeLike,
  idsInClause,
  METADATA_SELECT,
  parseVector,
  rowToMetadata,
  tenantWhere,
  toVectorLiteral,
  type VectorRow,
} from './vector-index-sql';
import type {
  VectorFetchResult,
  VectorIndex,
  VectorInfoResult,
  VectorQueryResult,
  VectorRangeResult,
} from './vector-index-types';
import { upsertVectors } from './vector-index-write';
export { upsertVectors } from './vector-index-write';

export * from './vector-index-listing';
export * from './vector-index-types';

// All operations retain tenant scoping and RLS. Similarity searches only compare
// vectors produced by the current provider/model/dimension identity.
export const vectorIndex: VectorIndex | null = process.env.DATABASE_URL
  ? {
      async query({
        vector,
        topK,
        organizationId,
        includeMetadata = false,
        filter,
      }): Promise<VectorQueryResult[]> {
        const vectorLiteral = toVectorLiteral(vector);
        return withTenant(organizationId, async (tx) => {
          const rows = await tx.$queryRaw<VectorRow[]>(Prisma.sql`
            SELECT "id",
              1 - (("embedding" <=> ${vectorLiteral}::vector) / 2) AS "score",
              ${METADATA_SELECT}
            FROM "vector_embedding"
            ${tenantWhere(organizationId, filter)}
              AND "embeddingModel" = ${EMBEDDING_IDENTITY}
            ORDER BY "embedding" <=> ${vectorLiteral}::vector
            LIMIT ${topK}
          `);
          return rows.map((row) => ({
            id: row.id,
            score: Number(row.score),
            ...(includeMetadata ? { metadata: rowToMetadata(row) } : {}),
          }));
        });
      },

      async upsert({ id, vector, metadata }): Promise<{ id: string }> {
        await upsertVectors({
          organizationId: metadata.organizationId,
          records: [{ id, vector, metadata }],
        });
        return { id };
      },

      async fetch(ids, organizationId, options = {}): Promise<VectorFetchResult[]> {
        if (ids.length === 0) return [];
        return withTenant(organizationId, async (tx) => {
          const rows = await tx.$queryRaw<VectorRow[]>(Prisma.sql`
            SELECT "id", ${options.includeVectors ? Prisma.sql`"embedding",` : Prisma.empty} ${METADATA_SELECT}
            FROM "vector_embedding"
            WHERE "id" ${idsInClause(ids)} AND "organizationId" = ${organizationId}
          `);
          return rows.map((row) => ({
            id: row.id,
            ...(options.includeVectors ? { vector: parseVector(row.embedding) } : {}),
            metadata: rowToMetadata(row),
          }));
        });
      },

      async delete(ids: string[], organizationId: string): Promise<void> {
        if (ids.length === 0) return;
        await withTenant(organizationId, async (tx) => {
          await tx.$executeRaw(Prisma.sql`
            DELETE FROM "vector_embedding"
            WHERE "id" ${idsInClause(ids)} AND "organizationId" = ${organizationId}
          `);
        });
      },

      async range({
        cursor = '0',
        limit,
        prefix = '',
        includeVectors = false,
        includeMetadata = false,
        organizationId,
      }): Promise<VectorRangeResult> {
        const pattern = `${escapeLike(prefix)}%`;
        return withTenant(organizationId, async (tx) => {
          const rows = await tx.$queryRaw<VectorRow[]>(Prisma.sql`
            SELECT "id", ${includeVectors ? Prisma.sql`"embedding",` : Prisma.empty} ${METADATA_SELECT}
            FROM "vector_embedding"
            WHERE "organizationId" = ${organizationId}
              AND "id" LIKE ${pattern} AND (${String(cursor)} = '' OR "id" > ${String(cursor)})
            ORDER BY "id"
            LIMIT ${limit + 1}
          `);
          const hasMore = rows.length > limit;
          const page = hasMore ? rows.slice(0, limit) : rows;
          return {
            vectors: page.map((row) => ({
              id: row.id,
              ...(includeVectors ? { vector: parseVector(row.embedding) } : {}),
              ...(includeMetadata ? { metadata: rowToMetadata(row) } : {}),
            })),
            nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
          };
        });
      },

      async info(): Promise<VectorInfoResult> {
        return withService(async (tx) => {
          const rows = await tx.$queryRaw<Array<{ total: number }>>(Prisma.sql`
            SELECT count(*)::int AS "total" FROM "vector_embedding"
          `);
          return {
            totalVectorCount: rows[0]?.total ?? 0,
            pendingVectorCount: 0,
            dimension: 1024,
          };
        });
      },
    }
  : null;
