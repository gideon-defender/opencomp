import { EMBEDDING_IDENTITY } from '@gideon-defender/db';
import type { ExistingEmbedding } from '../core/query-helpers';

/** Unknown or different models require a rebuild even if source content is unchanged. */
export function needsUpdate({
  existingEmbeddings,
  updatedAt,
}: {
  existingEmbeddings: ExistingEmbedding[];
  updatedAt: string;
}): boolean {
  return (
    existingEmbeddings.length === 0 ||
    existingEmbeddings.some(
      (embedding) =>
        embedding.embeddingModel !== EMBEDDING_IDENTITY ||
        !embedding.updatedAt ||
        embedding.updatedAt < updatedAt,
    )
  );
}
