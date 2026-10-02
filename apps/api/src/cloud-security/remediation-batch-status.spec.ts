import {
  ACTIVE_BATCH_STATUSES,
  TERMINAL_BATCH_STATUSES,
  classifyTerminalUpdate,
  isActiveBatchStatus,
  isCompletedBatchStatus,
  isTerminalBatchStatus,
} from './remediation-batch-status';

describe('batch status vocabulary', () => {
  it('keeps the active set aligned with the partial unique index predicate', () => {
    // SQL: WHERE status IN ('pending', 'running'). Drift here reopens the
    // check-then-create race the index exists to close.
    expect([...ACTIVE_BATCH_STATUSES].sort()).toEqual(['pending', 'running']);
  });

  it('keeps active and terminal sets disjoint', () => {
    for (const status of ACTIVE_BATCH_STATUSES) {
      expect(TERMINAL_BATCH_STATUSES.has(status)).toBe(false);
    }
  });

  it('treats done as terminal (legacy alias of completed)', () => {
    expect(isTerminalBatchStatus('done')).toBe(true);
    expect(isActiveBatchStatus('done')).toBe(false);
  });

  it('rejects non-string statuses', () => {
    expect(isActiveBatchStatus(undefined)).toBe(false);
    expect(isTerminalBatchStatus(null)).toBe(false);
    expect(isCompletedBatchStatus(42)).toBe(false);
  });

  it('treats done and completed as the same finished spelling', () => {
    expect(isCompletedBatchStatus('done')).toBe(true);
    expect(isCompletedBatchStatus('completed')).toBe(true);
    expect(isCompletedBatchStatus('failed')).toBe(false);
  });
});

describe('classifyTerminalUpdate', () => {
  it('treats a resend of the same terminal state as idempotent', () => {
    expect(
      classifyTerminalUpdate({
        status: 'completed',
        currentStatus: 'completed',
        currentTriggerRunId: 'run-1',
      }),
    ).toBe('idempotent');
  });

  it('treats a run-link-only resend as idempotent', () => {
    expect(
      classifyTerminalUpdate({
        triggerRunId: 'run-1',
        currentStatus: 'failed',
        currentTriggerRunId: 'run-1',
      }),
    ).toBe('idempotent');
  });

  it('normalizes done to completed', () => {
    expect(
      classifyTerminalUpdate({
        status: 'completed',
        currentStatus: 'done',
        currentTriggerRunId: 'run-1',
      }),
    ).toBe('normalize-completed');
  });

  it('normalizes completed to done', () => {
    expect(
      classifyTerminalUpdate({
        status: 'done',
        currentStatus: 'completed',
        currentTriggerRunId: 'run-1',
      }),
    ).toBe('normalize-completed');
  });

  it('refuses a status change on a terminal batch', () => {
    expect(
      classifyTerminalUpdate({
        status: 'failed',
        currentStatus: 'completed',
        currentTriggerRunId: 'run-1',
      }),
    ).toBe('refuse');
  });

  it('refuses a run-link swap on a terminal batch', () => {
    expect(
      classifyTerminalUpdate({
        triggerRunId: 'run-2',
        currentStatus: 'completed',
        currentTriggerRunId: 'run-1',
      }),
    ).toBe('refuse');
  });
});
