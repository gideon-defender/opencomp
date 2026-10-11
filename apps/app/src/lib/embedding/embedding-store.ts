import { vectorIndex as pgVectorIndex, type VectorIndex } from '@gideon-defender/db';

type EntityKind = 'risk' | 'vendor' | 'task';

// Self-hosted BAAI/bge-m3 (1024 dims) via Ollama; model + dims imported from
// @gideon-defender/db so the content hash and the serving client stay in lockstep.
// Pagination for enumerating an org's task vectors by their shared id prefix —
// used by both `findSimilarTasks` (exact in-process ranking) and
// `pruneOrphanTaskVectors` (orphan sweep). Prefix enumeration has no top-K
// ceiling; page size only controls how many vectors come back per round trip.
export const TASK_VECTOR_PAGE_SIZE = 1000;
// Backstop so a misbehaving cursor can't loop forever. 500 pages × 1000 = 500k
// task vectors, far beyond any real org — hitting it signals a bug, not scale.
export const TASK_VECTOR_MAX_PAGES = 500;

export function getIndex(): VectorIndex {
  if (!pgVectorIndex) {
    throw new Error('Vector store is not configured (DATABASE_URL)');
  }
  return pgVectorIndex;
}

export function embeddingIdPrefix(kind: EntityKind, organizationId: string): string {
  return `${kind}_${organizationId}_`;
}

export function embeddingId(kind: EntityKind, organizationId: string, sourceId: string): string {
  return `${embeddingIdPrefix(kind, organizationId)}${sourceId}`;
}

/**
 * Inverse of `embeddingId`: recover the raw source id from a prefixed embedding
 * id. Used only as a fallback for vectors written before `metadata.sourceId`
 * existed — treating the prefixed id as a raw source id would misidentify the
 * entity, so `pruneOrphanTaskVectors` could delete a live task's vector (its
 * prefixed id never matches the raw-id `liveTaskIds` set) and clear the hash of
 * a row that doesn't exist.
 */
export function sourceIdFromEmbeddingId(
  kind: EntityKind,
  organizationId: string,
  id: string,
): string {
  const prefix = embeddingIdPrefix(kind, organizationId);
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}
