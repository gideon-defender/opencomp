/**
 * Batch lifecycle vocabulary. A batch only accepts work while it is still in
 * progress (`pending`, `running`); every other state is terminal and never
 * accepts more work. `done` is a legacy alias of `completed` written by the
 * trigger task — prefer `completed` for new callers.
 *
 * The partial unique index
 * (`RemediationBatch_one_active_per_connection`) enforces the same boundary
 * in SQL (`status IN ('pending', 'running')`). Keep these sets in sync with
 * that predicate — the index is unmanaged by Prisma, so `migrate diff` will
 * never flag a divergence.
 */

/** A batch only accepts skips while it is still in progress. */
export const ACTIVE_BATCH_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'running',
]);

/** Terminal batch states — a batch here never accepts more work. */
export const TERMINAL_BATCH_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  // Legacy alias written by the trigger task. Prefer 'completed' for new
  // callers; 'done' stays terminal so finished batches can still be cleared.
  'done',
  'failed',
  'cancelled',
]);

export function isActiveBatchStatus(status: unknown): boolean {
  return typeof status === 'string' && ACTIVE_BATCH_STATUSES.has(status);
}

export function isTerminalBatchStatus(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_BATCH_STATUSES.has(status);
}

/**
 * True for the two spellings of "finished successfully". `done` is the
 * legacy alias written by the trigger task; `completed` is preferred for
 * new callers. The pair is interchangeable for idempotency checks so a
 * retried completion or a `done` → `completed` normalization is a no-op,
 * not an error.
 */
export function isCompletedBatchStatus(status: unknown): boolean {
  return status === 'completed' || status === 'done';
}

/** Outcome of a terminal-batch update attempt that is not a reopen. */
export type TerminalUpdateDecision =
  'idempotent' | 'normalize-completed' | 'refuse';

/**
 * Decide what a non-reopen update means against a terminal batch.
 * At-least-once trigger callbacks resend the same terminal status (or the
 * same run link) — that is a no-op. A `done` ↔ `completed` swap only
 * normalizes the legacy alias. Anything that would change the finished
 * batch refuses closed.
 */
export function classifyTerminalUpdate(params: {
  status?: string;
  triggerRunId?: string;
  currentStatus: unknown;
  currentTriggerRunId: unknown;
}): TerminalUpdateDecision {
  const sameStatus =
    params.status !== undefined && params.status === params.currentStatus;
  const sameRunLink =
    params.triggerRunId !== undefined &&
    params.triggerRunId === params.currentTriggerRunId;
  const completesAlias =
    params.status !== undefined &&
    isCompletedBatchStatus(params.status) &&
    isCompletedBatchStatus(params.currentStatus);
  if (
    (params.status === undefined || sameStatus || completesAlias) &&
    (params.triggerRunId === undefined || sameRunLink)
  ) {
    if (
      completesAlias &&
      params.status !== undefined &&
      params.status !== params.currentStatus
    ) {
      return 'normalize-completed';
    }
    return 'idempotent';
  }
  return 'refuse';
}
