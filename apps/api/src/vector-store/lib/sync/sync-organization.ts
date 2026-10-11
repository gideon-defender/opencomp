import { findAllOrganizationEmbeddings } from '../core/find-existing-embeddings';
import { logger } from '../../logger';
import { syncPolicies } from './sync-policies';
import { syncContextEntries } from './sync-context';
import { syncKnowledgeBaseDocuments } from './sync-knowledge-base';
import { syncManualAnswers } from './sync-manual-answers';
import { deleteOrphanedEmbeddings } from './delete-orphaned-embeddings';
import { verifyEmbeddingIsReady } from './verify-embedding';

/**
 * Lock map to prevent concurrent syncs for the same organization
 */
const syncLocks = new Map<string, Promise<void>>();

/**
 * Full resync of organization embeddings
 * Uses a lock mechanism to prevent concurrent syncs for the same organization.
 */
export async function syncOrganizationEmbeddings(
  organizationId: string,
): Promise<void> {
  if (!organizationId || organizationId.trim().length === 0) {
    logger.warn('Invalid organizationId provided for sync');
    return;
  }

  // Check if sync is already in progress
  const existingSync = syncLocks.get(organizationId);
  if (existingSync) {
    logger.info('Sync already in progress, waiting for completion', {
      organizationId,
    });
    return existingSync;
  }

  // Create and store new sync promise
  const syncPromise = performSync(organizationId);
  syncLocks.set(organizationId, syncPromise);

  // Clean up lock when sync completes
  syncPromise
    .finally(() => {
      syncLocks.delete(organizationId);
      logger.info('Sync lock released', { organizationId });
    })
    .catch(() => {
      // Error already logged in performSync
    });

  return syncPromise;
}

/**
 * Internal function that performs the actual sync operation
 */
async function performSync(organizationId: string): Promise<void> {
  logger.info('Starting incremental organization embeddings sync', {
    organizationId,
  });

  try {
    // Step 1: Fetch all existing embeddings once
    const existingEmbeddings =
      await findAllOrganizationEmbeddings(organizationId);
    logger.info('Fetched existing embeddings', {
      organizationId,
      totalSources: existingEmbeddings.size,
    });

    // Step 2: Sync policies
    const policyStats = await syncPolicies(organizationId, existingEmbeddings);

    // Step 3: Sync context entries
    const contextStats = await syncContextEntries(
      organizationId,
      existingEmbeddings,
    );

    // Step 4: Sync manual answers
    const manualAnswerStats = await syncManualAnswers(
      organizationId,
      existingEmbeddings,
    );

    // Step 5: Sync Knowledge Base documents
    const kbDocStats = await syncKnowledgeBaseDocuments(
      organizationId,
      existingEmbeddings,
    );

    const failed =
      policyStats.failed +
      contextStats.failed +
      manualAnswerStats.failed +
      kbDocStats.failed;
    if (failed > 0) {
      throw new Error(
        `Document embedding rebuild failed for ${failed} sources`,
      );
    }

    // Step 6: Delete orphaned embeddings
    const orphanedDeleted = await deleteOrphanedEmbeddings(
      organizationId,
      existingEmbeddings,
    );

    // Step 7: Verify embeddings are queryable (handles write-to-read visibility lag)
    // Only verify if we actually created or updated any embeddings
    const totalCreated =
      policyStats.created +
      contextStats.created +
      manualAnswerStats.created +
      kbDocStats.created;
    const totalUpdated =
      policyStats.updated +
      contextStats.updated +
      manualAnswerStats.updated +
      kbDocStats.updated;

    // Find the last upserted embedding ID (prioritize knowledge base, then manual answers, then context, then policies)
    // This ensures we verify the most recently upserted embedding
    const lastUpsertedEmbeddingId =
      kbDocStats.lastUpsertedEmbeddingId ??
      manualAnswerStats.lastUpsertedEmbeddingId ??
      contextStats.lastUpsertedEmbeddingId ??
      policyStats.lastUpsertedEmbeddingId ??
      null;

    if ((totalCreated > 0 || totalUpdated > 0) && lastUpsertedEmbeddingId) {
      const verificationResult = await verifyEmbeddingIsReady(
        lastUpsertedEmbeddingId,
        organizationId,
      );
      logger.info('Embeddings verification completed', {
        organizationId,
        embeddingId: lastUpsertedEmbeddingId,
        verified: verificationResult.success,
        attempts: verificationResult.attempts,
        totalWaitMs: verificationResult.totalWaitMs,
      });
    } else if (totalCreated > 0 || totalUpdated > 0) {
      logger.warn(
        'Embeddings were created/updated but no embedding ID tracked for verification',
        { organizationId, totalCreated, totalUpdated },
      );
    } else {
      logger.info('Skipping verification - no new embeddings created/updated', {
        organizationId,
      });
    }

    logger.info('Incremental organization embeddings sync completed', {
      organizationId,
      policies: policyStats,
      context: contextStats,
      manualAnswers: manualAnswerStats,
      knowledgeBaseDocuments: kbDocStats,
      orphanedDeleted,
    });
  } catch (error) {
    logger.error('Failed to sync organization embeddings', {
      organizationId,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
