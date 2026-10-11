import { findVectorsByFilter, listVectorsByOrganization } from './client';
import { type ExistingEmbedding, type SourceType } from './query-helpers';
import { logger } from '../../logger';

// Re-export types for backward compatibility
export { ExistingEmbedding };

const VALID_SOURCE_TYPES: SourceType[] = [
  'policy',
  'context',
  'manual_answer',
  'knowledge_base_document',
];

/**
 * Finds existing embeddings for a specific policy, context, manual answer, or
 * knowledge base document. Uses exact metadata filtering (organizationId +
 * sourceType + sourceId) on the vector_embedding table, so recall is complete
 * regardless of embedding similarity.
 */
export async function findEmbeddingsForSource(
  sourceId: string,
  sourceType: SourceType,
  organizationId: string,
  _documentName?: string,
): Promise<ExistingEmbedding[]> {
  if (!sourceId || !organizationId) {
    return [];
  }

  try {
    const records = await findVectorsByFilter({
      organizationId,
      sourceType,
      sourceId,
    });

    const matchingEmbeddings: ExistingEmbedding[] = records.map((record) => ({
      id: record.id,
      sourceId: record.metadata.sourceId,
      sourceType: record.metadata.sourceType as SourceType,
      updatedAt: record.metadata.updatedAt ?? undefined,
      embeddingModel: record.metadata.embeddingModel,
    }));

    logger.info('Found embeddings for source', {
      sourceId,
      sourceType,
      organizationId,
      count: matchingEmbeddings.length,
    });

    return matchingEmbeddings;
  } catch (error) {
    logger.warn('Failed to find embeddings for source', {
      sourceId,
      sourceType,
      organizationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
}

/**
 * Finds all existing embeddings for an organization (for orphaned detection).
 * Exact metadata listing from the vector_embedding table, grouped by sourceId.
 */
export async function findAllOrganizationEmbeddings(
  organizationId: string,
): Promise<Map<string, ExistingEmbedding[]>> {
  if (!organizationId || organizationId.trim().length === 0) {
    return new Map();
  }

  try {
    const records = await listVectorsByOrganization(organizationId);

    const groupedBySourceId = new Map<string, ExistingEmbedding[]>();

    for (const record of records) {
      const sourceType = record.metadata.sourceType;
      if (!VALID_SOURCE_TYPES.includes(sourceType as SourceType)) {
        continue;
      }

      const existing = groupedBySourceId.get(record.metadata.sourceId) || [];
      existing.push({
        id: record.id,
        sourceId: record.metadata.sourceId,
        sourceType: sourceType as SourceType,
        updatedAt: record.metadata.updatedAt ?? undefined,
        embeddingModel: record.metadata.embeddingModel,
      });
      groupedBySourceId.set(record.metadata.sourceId, existing);
    }

    logger.info('Found existing embeddings for organization', {
      organizationId,
      totalEmbeddings: records.length,
      uniqueSources: groupedBySourceId.size,
    });

    return groupedBySourceId;
  } catch (error) {
    logger.error('Failed to find existing embeddings', {
      organizationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return new Map();
  }
}
