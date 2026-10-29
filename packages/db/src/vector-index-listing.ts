import { Prisma } from '@prisma/client';
import { withTenant } from './client.js';
import { METADATA_SELECT, rowToRecord, type VectorRow } from './vector-index-sql.js';
import type { VectorRecord } from './vector-index-types.js';

export async function deleteVectorsByOrganization(organizationId: string): Promise<void> {
  await withTenant(organizationId, async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`DELETE FROM "vector_embedding" WHERE "organizationId" = ${organizationId}`,
    );
  });
}

export async function findVectorsByFilter(input: {
  organizationId: string;
  sourceType: string;
  sourceId: string;
}): Promise<VectorRecord[]> {
  const rows = await withTenant(input.organizationId, async (tx) =>
    tx.$queryRaw<VectorRow[]>(Prisma.sql`
      SELECT "id", ${METADATA_SELECT}
      FROM "vector_embedding"
      WHERE "organizationId" = ${input.organizationId}
        AND "sourceType" = ${input.sourceType}
        AND "sourceId" = ${input.sourceId}
      ORDER BY "id"
    `),
  );
  return rows.map(rowToRecord);
}

export async function listVectorsByOrganizationAndType(
  organizationId: string,
  sourceType: string,
): Promise<VectorRecord[]> {
  const rows = await withTenant(organizationId, async (tx) =>
    tx.$queryRaw<VectorRow[]>(Prisma.sql`
      SELECT "id", ${METADATA_SELECT}
      FROM "vector_embedding"
      WHERE "organizationId" = ${organizationId}
        AND "sourceType" = ${sourceType}
      ORDER BY "id"
    `),
  );
  return rows.map(rowToRecord);
}

export async function listVectorsByOrganization(organizationId: string): Promise<VectorRecord[]> {
  const rows = await withTenant(organizationId, async (tx) =>
    tx.$queryRaw<VectorRow[]>(Prisma.sql`
      SELECT "id", ${METADATA_SELECT}
      FROM "vector_embedding"
      WHERE "organizationId" = ${organizationId}
      ORDER BY "id"
    `),
  );
  return rows.map(rowToRecord);
}

export async function countVectorsByOrganization(
  organizationId: string,
  sourceType?: string,
): Promise<{ total: number; bySourceType: Record<string, number> }> {
  const rows = await withTenant(organizationId, async (tx) => {
    const where = sourceType
      ? Prisma.sql`WHERE "organizationId" = ${organizationId} AND "sourceType" = ${sourceType}`
      : Prisma.sql`WHERE "organizationId" = ${organizationId}`;
    return tx.$queryRaw<Array<{ sourceType: string; count: number }>>(Prisma.sql`
      SELECT "sourceType", count(*)::int AS "count"
      FROM "vector_embedding"
      ${where}
      GROUP BY "sourceType"
    `);
  });
  const bySourceType: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    bySourceType[row.sourceType] = row.count;
    total += row.count;
  }
  return { total, bySourceType };
}
