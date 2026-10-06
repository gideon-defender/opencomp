import { checkGcpExecutionPreconditions } from './gcp-execution-preconditions';
import type { GcpApiStep } from './gcp-plan-step-validation';

const READ: GcpApiStep = {
  method: 'GET',
  url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
  purpose: 'read',
};

const FIX: GcpApiStep = {
  method: 'PATCH',
  url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
  body: { iamConfiguration: {} },
  purpose: 'fix',
};

describe('checkGcpExecutionPreconditions', () => {
  it('refuses read executions that carry rollback steps', () => {
    // Reads run pre-acknowledgment with the auditor token: rollback steps
    // are writes, so they must never ride along.
    const failure = checkGcpExecutionPreconditions({
      steps: [READ],
      accessToken: 'token',
      expectedProjectId: 'my-proj',
      expectedBucket: 'my-bucket',
      autoRollbackSteps: [READ],
      isRead: true,
    });
    expect(failure?.message).toMatch(/cannot carry rollback steps/);
  });

  it('refuses rollback arrays that do not pair 1:1 with fix steps', () => {
    // Compensation is positional (rollback[j] undoes fix step j) — a
    // mismatched count would roll back the wrong subset.
    const failure = checkGcpExecutionPreconditions({
      steps: [FIX],
      accessToken: 'token',
      expectedProjectId: 'my-proj',
      expectedBucket: 'my-bucket',
      autoRollbackSteps: [READ, READ],
    });
    expect(failure?.message).toMatch(/Rollback mismatch: 2 rollback steps/);
  });

  it('allows an empty rollback array (no safety net, same as absent)', () => {
    expect(
      checkGcpExecutionPreconditions({
        steps: [FIX],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
        autoRollbackSteps: [],
      }),
    ).toBeNull();
  });

  it('allows a 1:1 fix/rollback pairing', () => {
    expect(
      checkGcpExecutionPreconditions({
        steps: [FIX],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
        autoRollbackSteps: [READ],
      }),
    ).toBeNull();
  });

  it('allows reads without rollback steps', () => {
    expect(
      checkGcpExecutionPreconditions({
        steps: [READ],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
        isRead: true,
      }),
    ).toBeNull();
  });

  it('surfaces URL validation failures instead of executing', () => {
    const failure = checkGcpExecutionPreconditions({
      steps: [
        { method: 'PATCH', url: 'http://evil.example/x', purpose: 'fix' },
      ],
      accessToken: 'token',
    });
    expect(failure?.message).toMatch(/URL validation failed/);
  });
});
