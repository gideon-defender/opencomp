import type { VectorRangeResult } from '@gideon-defender/db';
import {
  embeddingIdPrefix,
  getIndex,
  sourceIdFromEmbeddingId,
  TASK_VECTOR_MAX_PAGES,
  TASK_VECTOR_PAGE_SIZE,
} from './embedding-store';

interface PruneOrphanTaskVectorsResult {
  /** sourceIds of the task vectors that were deleted from the vector store. */
  deletedSourceIds: string[];
  /** How many of the org's task vectors were examined. */
  scanned: number;
}

/**
 * Delete an org's task vectors whose `sourceId` is no longer in the live task
 * scope. `lib/embedding` only ever UPSERTS task vectors — it has no other
 * delete path — so tasks that are deleted, or whose controls all get archived
 * (dropping them from `runLinkage`'s scope query), leave orphan vectors behind
 * indefinitely. Those orphans are still returned by `findSimilarTasks` (which
 * filters on organizationId + sourceType only) and, being embedded from real
 * compliance work, sit cosine-near the live tasks — crowding them out of the
 * top-K recall entirely and starving risks/vendors of suggestions (CS-681).
 *
 * Every task vector is keyed `task_${organizationId}_${sourceId}` (see
 * `embeddingId`), so a cursor-paginated `range` over that id prefix enumerates
 * exactly this org's task vectors with no top-K ceiling — a bounded `query`
 * would silently miss any orphans past its window on a large org. The returned
 * `deletedSourceIds` let the caller clear each task's stored `embeddingHash`,
 * keeping "no vector" consistent with "no hash" so a task that later re-enters
 * scope re-embeds instead of being skipped by the dedup guard. Only sourceIds
 * whose vector was actually deleted are returned, so a transient delete failure
 * never desynchronizes that pairing.
 */
export async function pruneOrphanTaskVectors({
  organizationId,
  liveTaskIds,
}: {
  organizationId: string;
  /** sourceIds of the tasks currently in the linkage scope. */
  liveTaskIds: Set<string>;
}): Promise<PruneOrphanTaskVectorsResult> {
  const index = getIndex();
  const prefix = embeddingIdPrefix('task', organizationId);

  // Enumerate the org's task vectors page by page over their shared id prefix.
  // A drained page reports a falsy `nextCursor`; the page cap is a runaway
  // backstop (a healthy cursor always terminates first).
  const orphans: Array<{ vectorId: string; sourceId: string }> = [];
  let scanned = 0;
  let cursor: string | number = '0';
  let enumeratedFully = false;
  for (let page = 0; page < TASK_VECTOR_MAX_PAGES; page++) {
    // Annotate the result explicitly: `cursor = nextCursor` would otherwise make
    // TS infer `nextCursor`'s type from a binding that depends on it (TS7022).
    const { vectors, nextCursor }: VectorRangeResult = await index.range({
      cursor,
      limit: TASK_VECTOR_PAGE_SIZE,
      prefix,
      organizationId,
      includeMetadata: true,
    });
    scanned += vectors.length;
    for (const r of vectors) {
      const meta = (r.metadata ?? {}) as { sourceId?: string };
      const sourceId =
        meta.sourceId ?? sourceIdFromEmbeddingId('task', organizationId, String(r.id));
      if (liveTaskIds.has(sourceId)) continue;
      orphans.push({ vectorId: String(r.id), sourceId });
    }
    if (!nextCursor) {
      enumeratedFully = true;
      break;
    }
    cursor = nextCursor;
  }
  if (!enumeratedFully) {
    console.warn(
      `[embedding] orphan sweep hit the ${TASK_VECTOR_MAX_PAGES}-page cap for org ${organizationId} after scanning ${scanned} vector(s); enumeration may be incomplete`,
    );
  }

  if (orphans.length === 0) {
    return { deletedSourceIds: [], scanned };
  }

  // Delete in batches, resilient to transient failures: a failing batch is
  // logged and skipped so later batches still run, and only the sourceIds whose
  // vector was actually deleted are returned. That keeps hash-clearing aligned
  // with real deletions — clearing a hash whose vector survived would leave a
  // task that re-embeds needlessly, but never one with a cached hash and no
  // vector (which would be skipped by the dedup guard and never re-embed).
  const deletedSourceIds: string[] = [];
  const BATCH = 100;
  for (let i = 0; i < orphans.length; i += BATCH) {
    const batch = orphans.slice(i, i + BATCH);
    try {
      await index.delete(
        batch.map((o) => o.vectorId),
        organizationId,
      );
      deletedSourceIds.push(...batch.map((o) => o.sourceId));
    } catch (err) {
      console.error(
        `[embedding] orphan vector delete batch failed for org ${organizationId} (${batch.length} id(s)); continuing`,
        err,
      );
    }
  }

  return { deletedSourceIds, scanned };
}
