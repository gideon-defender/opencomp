import { Prisma } from '@prisma/client';
import { withTenant } from './client.js';
import { EMBEDDING_IDENTITY } from './embedding-client.js';
import { toVectorLiteral } from './vector-index-sql.js';
import type { VectorRecordInput } from './vector-index-types.js';

/** A complete document batch commits atomically, so failed chunks cannot look fresh. */
export async function upsertVectors({
  organizationId,
  records,
}: {
  organizationId: string;
  records: VectorRecordInput[];
}): Promise<void> {
  if (records.length === 0) return;
  if (records.some(({ metadata }) => metadata.organizationId !== organizationId)) {
    throw new Error('Vector batch must belong to one organization');
  }
  const rows = records.map(
    ({ id, vector, metadata }) => Prisma.sql`(
    ${id}, ${toVectorLiteral(vector)}::vector, ${organizationId},
    ${metadata.sourceType}, ${metadata.sourceId}, ${metadata.content ?? null},
    ${metadata.policyName ?? null}, ${metadata.contextQuestion ?? null},
    ${metadata.documentName ?? null}, ${metadata.manualAnswerQuestion ?? null},
    ${metadata.department ?? null}, ${metadata.updatedAt ? new Date(metadata.updatedAt) : null},
    ${EMBEDDING_IDENTITY}
  )`,
  );
  await withTenant(organizationId, async (tx) => {
    // Bound parameters below PostgreSQL's limit while retaining one transaction.
    for (let offset = 0; offset < rows.length; offset += 500) {
      await tx.$executeRaw(Prisma.sql`
      INSERT INTO "vector_embedding" (
        "id", "embedding", "organizationId", "sourceType", "sourceId", "content",
        "policyName", "contextQuestion", "documentName", "manualAnswerQuestion",
        "department", "updatedAt", "embeddingModel"
      ) VALUES ${Prisma.join(rows.slice(offset, offset + 500))}
      ON CONFLICT ("id") DO UPDATE SET
        "embedding" = EXCLUDED."embedding",
        "organizationId" = EXCLUDED."organizationId",
        "sourceType" = EXCLUDED."sourceType", "sourceId" = EXCLUDED."sourceId",
        "content" = EXCLUDED."content", "policyName" = EXCLUDED."policyName",
        "contextQuestion" = EXCLUDED."contextQuestion", "documentName" = EXCLUDED."documentName",
        "manualAnswerQuestion" = EXCLUDED."manualAnswerQuestion",
        "department" = EXCLUDED."department", "updatedAt" = EXCLUDED."updatedAt",
        "embeddingModel" = EXCLUDED."embeddingModel"
      `);
    }
  });
}
