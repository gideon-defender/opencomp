import { getIndex } from './embedding-store';

interface WaitForIndexedOptions {
  /** Hard ceiling. Resolves with `pendingAtTimeout` set if exceeded. */
  maxWaitMs?: number;
  /** Poll cadence. */
  intervalMs?: number;
}

interface WaitForIndexedResult {
  waitedMs: number;
  polls: number;
  /** Defined only when we hit `maxWaitMs` without reaching pending=0. */
  pendingAtTimeout?: number;
}

/**
 * pgvector HNSW indexing is synchronous — once `upsert` returns, the vector is
 * immediately queryable, so `info().pendingVectorCount` is always 0 here. This
 * is a no-op that resolves on the first poll.
 *
 * Kept as a no-op gate so callers (`runLinkage`) can keep the same phase
 * ordering regardless of backend: it guarantees that anything written before
 * this call is searchable before matching begins.
 *
 * Call this AFTER `upsertEntityEmbeddings` and BEFORE any query that depends
 * on the just-written vectors being searchable.
 */
export async function waitForIndexed({
  maxWaitMs = 30_000,
  intervalMs = 250,
}: WaitForIndexedOptions = {}): Promise<WaitForIndexedResult> {
  const index = getIndex();
  const start = Date.now();
  let polls = 0;
  while (Date.now() - start < maxWaitMs) {
    polls += 1;
    const info = await index.info();
    if (info.pendingVectorCount === 0) {
      return { waitedMs: Date.now() - start, polls };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  // Timed out — fetch one more time so the caller can log how far behind we are.
  const final = await index.info().catch(() => null);
  return {
    waitedMs: Date.now() - start,
    polls,
    pendingAtTimeout: final?.pendingVectorCount,
  };
}
