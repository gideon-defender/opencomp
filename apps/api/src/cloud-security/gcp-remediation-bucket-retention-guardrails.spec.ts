import { validateGcpBucketRetentionPolicy } from './gcp-remediation-bucket-retention-guardrails';

const BUCKET_URL = 'https://storage.googleapis.com/storage/v1/b/my-bucket';

function argsFor(
  body: Record<string, unknown>,
  priorPolicy: Record<string, unknown> | null | undefined,
  readUrl: string = BUCKET_URL,
) {
  return {
    body,
    prefix: 'test',
    step: { url: BUCKET_URL },
    realState:
      priorPolicy === undefined
        ? undefined
        : { 'read bucket': { name: 'my-bucket', ...priorPolicy } },
    readSteps: [{ purpose: 'read bucket', url: readUrl }],
  };
}

const policy = (period: string) => ({ retentionPolicy: { retentionPeriod: period } });

describe('validateGcpBucketRetentionPolicy', () => {
  it('refuses clearing the policy via null', () => {
    const errors = validateGcpBucketRetentionPolicy(
      argsFor({ retentionPolicy: null }, { retentionPolicy: { retentionPeriod: '3600s' } }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('clearing the bucket retention policy');
  });

  it('refuses a zero period (clearing by another name)', () => {
    const errors = validateGcpBucketRetentionPolicy(
      argsFor(policy('0s'), { retentionPolicy: { retentionPeriod: '3600s' } }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('clearing the bucket retention policy');
  });

  it('refuses an unparseable period instead of weakening blind', () => {
    const errors = validateGcpBucketRetentionPolicy(
      argsFor(policy('not-a-period'), {
        retentionPolicy: { retentionPeriod: '3600s' },
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('clearing the bucket retention policy');
  });

  it('allows lengthening against a bound pre-fix period', () => {
    expect(
      validateGcpBucketRetentionPolicy(
        argsFor(policy('7200s'), {
          retentionPolicy: { retentionPeriod: '3600s' },
        }),
      ),
    ).toEqual([]);
  });

  it('refuses shortening against a bound pre-fix period', () => {
    const errors = validateGcpBucketRetentionPolicy(
      argsFor(policy('3600s'), {
        retentionPolicy: { retentionPeriod: '7200s' },
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('shortening the bucket retention period');
  });

  it('refuses retention edits with no pre-fix read state', () => {
    const errors = validateGcpBucketRetentionPolicy(
      argsFor(policy('3600s'), undefined),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('without pre-fix read state');
  });

  it('allows adding a policy the bound read proves absent', () => {
    // The covering read returns the bucket record with no retentionPolicy
    // key and selects no field subset — the bucket provably lacks one.
    expect(
      validateGcpBucketRetentionPolicy(argsFor(policy('3600s'), {})),
    ).toEqual([]);
  });

  it('refuses when the only covering read is field-masked', () => {
    const errors = validateGcpBucketRetentionPolicy(
      argsFor(policy('3600s'), {}, `${BUCKET_URL}?fields=name`),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('without a readable pre-fix period');
  });

  it('ignores bodies without a retention period', () => {
    expect(
      validateGcpBucketRetentionPolicy(argsFor({ iamConfiguration: {} }, {})),
    ).toEqual([]);
  });
});
