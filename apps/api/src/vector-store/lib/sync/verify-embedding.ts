import { logger } from '../../logger';
import { vectorIndex } from '../core/client';

/**
 * Verifies that embeddings are indexed and QUERYABLE after sync.
 * Uses retry with exponential backoff to handle write-to-read visibility lag.
 *
 * IMPORTANT: We use vectorIndex.query() instead of fetch() because:
 * - fetch() checks if data is stored (works immediately)
 * - query() checks if data is INDEXED for semantic search (may have delay)
 *
 * The embedding must be queryable, not just fetchable, for RAG to work.
 */
export async function verifyEmbeddingIsReady(
  embeddingId: string,
  organizationId: string,
): Promise<{
  success: boolean;
  attempts: number;
  totalWaitMs: number;
}> {
  if (!vectorIndex) {
    logger.warn('Vector index not configured, skipping verification');
    return { success: false, attempts: 0, totalWaitMs: 0 };
  }

  const maxRetries = 8;
  const initialDelay = 300; // 300ms
  let totalWaitMs = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // First, fetch the embedding to get its vector
      const fetchedEmbeddings = await vectorIndex.fetch(
        [embeddingId],
        organizationId,
        {
          includeVectors: true,
        },
      );

      const fetchedEmbedding = fetchedEmbeddings?.[0];
      if (!fetchedEmbedding || !fetchedEmbedding.vector) {
        // Embedding not even stored yet, wait and retry
        if (attempt < maxRetries) {
          const delay = initialDelay * Math.pow(2, attempt - 1);
          logger.info('Embedding not yet stored, waiting before retry', {
            organizationId,
            embeddingId,
            attempt,
            nextDelayMs: delay,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
          totalWaitMs += delay;
        }
        continue;
      }

      // Now query using the embedding's own vector to verify it's INDEXED
      // If the embedding is indexed, querying with its own vector should return itself
      const queryResults = await vectorIndex.query({
        vector: fetchedEmbedding.vector,
        topK: 1,
        organizationId,
        filter: `organizationId = "${organizationId}"`,
        includeMetadata: true,
      });

      // Check if our embedding appears in the query results
      const isIndexed = queryResults.some(
        (result) => result.id === embeddingId,
      );

      if (isIndexed) {
        logger.info(
          'Embedding verification succeeded - indexed and queryable',
          {
            organizationId,
            embeddingId,
            attempt,
            totalWaitMs,
          },
        );
        return { success: true, attempts: attempt, totalWaitMs };
      }

      // Embedding is stored but not yet indexed for search
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt - 1); // 300ms, 600ms, 1200ms, 2400ms...
        logger.info(
          'Embedding stored but not yet indexed, waiting before retry',
          {
            organizationId,
            embeddingId,
            attempt,
            nextDelayMs: delay,
            queryResultCount: queryResults.length,
          },
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        totalWaitMs += delay;
      }
    } catch (error) {
      logger.warn('Verification query failed', {
        organizationId,
        embeddingId,
        attempt,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Continue to next retry
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        totalWaitMs += delay;
      }
    }
  }

  // All retries exhausted
  logger.warn('Embedding verification failed after all retries', {
    organizationId,
    embeddingId,
    attempts: maxRetries,
    totalWaitMs,
  });
  return { success: false, attempts: maxRetries, totalWaitMs };
}
