import 'server-only';

import { EMBEDDING_IDENTITY, embedTexts, type VectorRangeResult } from '@gideon-defender/db';
import { createHash } from 'node:crypto';
import {
  embeddingId,
  embeddingIdPrefix,
  getIndex,
  sourceIdFromEmbeddingId,
  TASK_VECTOR_MAX_PAGES,
  TASK_VECTOR_PAGE_SIZE,
} from './embedding-store';
export { pruneOrphanTaskVectors } from './prune-orphan-task-vectors';
export { waitForIndexed } from './wait-for-indexed';

type EntityKind = 'risk' | 'vendor' | 'task';

interface EntityInput {
  id: string;
  text: string;
  department?: string;
}

interface UpsertOptions {
  organizationId: string;
  kind: EntityKind;
  entities: EntityInput[];
  /**
   * Optional id → hash map of the embeddings currently stored for these
   * entities. Any entity whose freshly-computed `contentHash` matches its
   * stored value is skipped — both the OpenAI embedding call AND the
   * vector upsert. Pass an empty map (or omit) to force re-embedding.
   *
   * Stored hashes live on `Task/Risk/Vendor.embeddingHash` in Postgres;
   * `runLinkage` reads them up-front and writes the new hashes back after
   * upsert via `appliedHashes`.
   */
  existingHashes?: Map<string, string>;
}

interface UpsertEntityEmbeddingsResult {
  /** Newly embedded entities that should have their hash persisted. */
  appliedHashes: Array<{ id: string; hash: string }>;
  /** How many entities we skipped because their content was unchanged. */
  skippedCount: number;
}

interface FindSimilarTasksOptions {
  organizationId: string;
  queryText: string;
  topK?: number;
}

interface SimilarTaskResult {
  id: string; // raw task id (sourceId), not the prefixed embedding id
  score: number;
  department?: string;
}

const DEFAULT_TOP_K = 25;

/**
 * Stable hash of everything that determines the stored embedding: the text
 * (which produces the vector), the model + dimensions (which model produced
 * it), and the department (which is stored as metadata and returned by
 * queries). Any change to these fields requires a re-embed AND a re-upsert.
 *
 * Exported so callers writing the hash back to Postgres can compute it
 * exactly the way the upsert path does.
 */
function computeEntityContentHash({
  text,
  department,
}: {
  text: string;
  department?: string;
}): string {
  return createHash('sha256')
    .update(`${EMBEDDING_IDENTITY}:${department ?? ''}:${text}`)
    .digest('hex');
}

/**
 * Upsert per-org entity embeddings into the shared pgvector-backed store.
 *
 * NOTE: this now routes through `@gideon-defender/db`, the same shared client
 * used by `apps/api/src/vector-store/` — kept here so the trigger task does
 * not import across app boundaries.
 */
export async function upsertEntityEmbeddings({
  organizationId,
  kind,
  entities,
  existingHashes,
}: UpsertOptions): Promise<UpsertEntityEmbeddingsResult> {
  const valid = entities.filter((e) => e.text.trim().length > 0);
  if (valid.length === 0) return { appliedHashes: [], skippedCount: 0 };

  // Skip entities whose stored hash matches the current content hash —
  // text + model + dims + department haven't changed, so the existing
  // vector is still authoritative. Saves the OpenAI embed AND the vector
  // upsert (the two non-trivial costs in this path).
  const withHashes = valid.map((entity) => ({
    entity,
    hash: computeEntityContentHash({ text: entity.text, department: entity.department }),
  }));
  const toEmbed = withHashes.filter(({ entity, hash }) => existingHashes?.get(entity.id) !== hash);
  const skippedCount = withHashes.length - toEmbed.length;
  if (toEmbed.length === 0) {
    return { appliedHashes: [], skippedCount };
  }

  const embeddings = await embedTexts(toEmbed.map(({ entity }) => entity.text));

  const index = getIndex();
  await Promise.all(
    toEmbed.map(({ entity }, i) =>
      index.upsert({
        id: embeddingId(kind, organizationId, entity.id),
        vector: embeddings[i],
        metadata: {
          organizationId,
          sourceType: kind,
          sourceId: entity.id,
          content: entity.text.substring(0, 1000),
          ...(entity.department ? { department: entity.department } : {}),
        },
      }),
    ),
  );

  return {
    appliedHashes: toEmbed.map(({ entity, hash }) => ({ id: entity.id, hash })),
    skippedCount,
  };
}

interface OrgTaskVector {
  /** raw task id (sourceId), not the prefixed embedding id */
  sourceId: string;
  vector: number[];
  department?: string;
}

/**
 * Enumerate an org's task vectors (with their embeddings) by their shared id
 * prefix. Every task vector is keyed `task_${organizationId}_${sourceId}` (see
 * `embeddingId`), so a cursor-paginated `range` returns exactly this org's task
 * vectors — no metadata filter, no top-K ceiling.
 */
async function fetchOrgTaskVectors(organizationId: string): Promise<OrgTaskVector[]> {
  const index = getIndex();
  const prefix = embeddingIdPrefix('task', organizationId);

  const out: OrgTaskVector[] = [];
  let cursor: string | number = '0';
  let enumeratedFully = false;
  for (let page = 0; page < TASK_VECTOR_MAX_PAGES; page++) {
    const { vectors, nextCursor }: VectorRangeResult = await index.range({
      cursor,
      limit: TASK_VECTOR_PAGE_SIZE,
      prefix,
      organizationId,
      includeVectors: true,
      includeMetadata: true,
    });
    for (const r of vectors) {
      if (!r.vector) continue; // defensive: skip any vector row missing embeddings
      const meta = r.metadata;
      if (meta?.embeddingModel !== EMBEDDING_IDENTITY) continue;
      out.push({
        sourceId: meta?.sourceId ?? sourceIdFromEmbeddingId('task', organizationId, String(r.id)),
        vector: r.vector as number[],
        department: meta?.department ?? undefined,
      });
    }
    if (!nextCursor) {
      enumeratedFully = true;
      break;
    }
    cursor = nextCursor;
  }
  if (!enumeratedFully) {
    console.warn(
      `[embedding] task-vector enumeration hit the ${TASK_VECTOR_MAX_PAGES}-page cap for org ${organizationId} after ${out.length} vector(s); ranking may be incomplete`,
    );
  }
  return out;
}

/**
 * Cosine similarity mapped to the vector store's COSINE score scale,
 * `(1 + cos) / 2`, so scores stay in [0, 1] and are drop-in compatible with
 * the department boost / threshold in `linkSuggestions` and the reranker's
 * `cosineScore` hint.
 */
export function cosineToUnitScore(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  const cos = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return (1 + cos) / 2;
}

/**
 * Find the top-K most similar Tasks in an org for a given query string.
 * Returns raw task ids (not prefixed embedding ids) along with score + department.
 *
 * Retrieval enumerates the org's task vectors by id prefix and scores them
 * exactly in-process rather than issuing a metadata-filtered ANN query. An org
 * holds at most low-hundreds of tasks, so exact scoring over the full set is
 * both correct (no recall loss) and cheap, and it keeps the score semantics
 * identical across storage backends.
 */
export async function findSimilarTasks({
  organizationId,
  queryText,
  topK = DEFAULT_TOP_K,
}: FindSimilarTasksOptions): Promise<SimilarTaskResult[]> {
  if (!queryText.trim()) return [];

  const [queryVector] = await embedTexts([queryText]);

  const taskVectors = await fetchOrgTaskVectors(organizationId);
  if (taskVectors.length === 0) return [];

  return taskVectors
    .map((t) => ({
      id: t.sourceId,
      score: cosineToUnitScore(queryVector, t.vector),
      department: t.department,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
