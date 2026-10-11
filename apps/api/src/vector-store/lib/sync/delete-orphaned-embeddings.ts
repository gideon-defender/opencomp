import { logger } from '../../logger';
import { vectorIndex } from '../core/client';
import { db } from '@db';
import type { ExistingEmbedding } from '../core/query-helpers';
import { fetchPolicies } from './sync-policies';
import { fetchContextEntries } from './sync-context';
import { fetchKnowledgeBaseDocuments } from './sync-knowledge-base';

/**
 * Delete orphaned embeddings (sources that no longer exist in DB)
 */
export async function deleteOrphanedEmbeddings(
  organizationId: string,
  existingEmbeddings: Map<string, ExistingEmbedding[]>,
): Promise<number> {
  // Fetch current DB IDs
  const [policies, contextEntries, manualAnswers, kbDocuments] =
    await Promise.all([
      fetchPolicies(organizationId),
      fetchContextEntries(organizationId),
      db.securityQuestionnaireManualAnswer.findMany({
        where: { organizationId },
        select: { id: true },
      }),
      fetchKnowledgeBaseDocuments(organizationId),
    ]);

  const dbPolicyIds = new Set(policies.map((p) => p.id));
  const dbContextIds = new Set(contextEntries.map((c) => c.id));
  const dbManualAnswerIds = new Set(manualAnswers.map((ma) => ma.id));
  const dbKbDocIds = new Set(kbDocuments.map((d) => d.id));

  let orphanedDeleted = 0;

  for (const [sourceId, embeddings] of existingEmbeddings.entries()) {
    const sourceType = embeddings[0]?.sourceType;
    if (!sourceType) continue;

    const shouldExist =
      (sourceType === 'policy' && dbPolicyIds.has(sourceId)) ||
      (sourceType === 'context' && dbContextIds.has(sourceId)) ||
      (sourceType === 'manual_answer' && dbManualAnswerIds.has(sourceId)) ||
      (sourceType === 'knowledge_base_document' && dbKbDocIds.has(sourceId));

    if (!shouldExist && vectorIndex) {
      const idsToDelete = embeddings.map((e) => e.id);
      try {
        await vectorIndex.delete(idsToDelete, organizationId);
        orphanedDeleted += idsToDelete.length;
        logger.info('Deleted orphaned embeddings', {
          sourceId,
          sourceType,
          deletedCount: idsToDelete.length,
        });
      } catch (error) {
        logger.warn('Failed to delete orphaned embeddings', {
          sourceId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  return orphanedDeleted;
}
