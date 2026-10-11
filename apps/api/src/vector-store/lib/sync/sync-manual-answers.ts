import { db } from '@db';
import { batchUpsertEmbeddings } from '../core/upsert-embedding';
import { logger } from '../../logger';
import type { ExistingEmbedding } from '../core/query-helpers';
import type { SyncStats } from './sync-utils';
import { needsUpdate } from './embedding-freshness';

/**
 * Sync manual answers for an organization
 */
export async function syncManualAnswers(
  organizationId: string,
  existingEmbeddings: Map<string, ExistingEmbedding[]>,
): Promise<SyncStats> {
  const manualAnswers = await db.securityQuestionnaireManualAnswer.findMany({
    where: { organizationId },
    select: {
      id: true,
      question: true,
      answer: true,
      updatedAt: true,
    },
  });

  logger.info('Syncing manual answers', {
    organizationId,
    count: manualAnswers.length,
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let lastUpsertedEmbeddingId: string | null = null;

  if (manualAnswers.length > 0) {
    const itemsToUpsert = manualAnswers
      .map((ma) => {
        const embeddingId = `manual_answer_${ma.id}`;
        const text = `${ma.question}\n\n${ma.answer}`;
        const updatedAt = ma.updatedAt.toISOString();

        const existing = existingEmbeddings.get(ma.id) || [];
        const requiresUpdate =
          needsUpdate({
            existingEmbeddings: existing,
            updatedAt,
          }) || existing.some((embedding) => embedding.updatedAt !== updatedAt);

        if (!requiresUpdate) {
          skipped++;
          return null;
        }

        if (existing.length === 0) created++;
        else updated++;

        return {
          id: embeddingId,
          text,
          metadata: {
            organizationId,
            sourceType: 'manual_answer' as const,
            sourceId: ma.id,
            content: text,
            manualAnswerQuestion: ma.question,
            updatedAt,
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    // Filter out items with empty text (same filter as batchUpsertEmbeddings)
    // This ensures we only track IDs that will actually be upserted
    const validItems = itemsToUpsert.filter(
      (item) => item.text && item.text.trim().length > 0,
    );

    if (validItems.length > 0) {
      await batchUpsertEmbeddings(validItems);
      // Track the last ACTUALLY upserted embedding ID
      lastUpsertedEmbeddingId = validItems[validItems.length - 1]?.id ?? null;
    }
  }

  logger.info('Manual answers sync completed', {
    organizationId,
    created,
    updated,
    skipped,
    total: manualAnswers.length,
  });

  return {
    created,
    updated,
    skipped,
    failed: 0,
    total: manualAnswers.length,
    lastUpsertedEmbeddingId,
  };
}
