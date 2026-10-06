import { validateGcpRollbackOverlap } from './gcp-remediation-rollback-overlap';

const BUCKET = 'https://storage.googleapis.com/storage/v1/b/my-bucket';

function writeStep(overrides: Record<string, unknown> = {}) {
  return {
    method: 'PATCH',
    url: BUCKET,
    body: {},
    purpose: 'fix',
    ...overrides,
  };
}

describe('validateGcpRollbackOverlap', () => {
  it('refuses a GET rollback (a read restores nothing)', () => {
    const errors = validateGcpRollbackOverlap(
      [writeStep()],
      [{ ...writeStep(), method: 'GET', purpose: 'rollback' }],
    );
    expect(errors.join(' ')).toMatch(/a read restores nothing/);
  });

  it('refuses a rollback outside every fix resource', () => {
    const errors = validateGcpRollbackOverlap(
      [writeStep()],
      [{ ...writeStep(), url: `${BUCKET}-other`, purpose: 'rollback' }],
    );
    expect(errors.join(' ')).toMatch(/does not target fix step/);
  });

  it('names the outside-resource case when lists are not positional', () => {
    const errors = validateGcpRollbackOverlap(
      [writeStep(), writeStep({ url: `${BUCKET}/o/obj` })],
      [{ ...writeStep(), url: `${BUCKET}-other`, purpose: 'rollback' }],
    );
    expect(errors.join(' ')).toMatch(/outside every fix-step resource/);
  });

  it('accepts a sibling only with a slash boundary (no prefix trick)', () => {
    // `${BUCKET}-other` shares a string prefix but is not a child.
    const errors = validateGcpRollbackOverlap(
      [writeStep()],
      [{ ...writeStep(), url: `${BUCKET}-other/o/obj`, purpose: 'rollback' }],
    );
    expect(errors.join(' ')).toMatch(/does not target fix step/);
  });

  it('accepts a child rollback of the fixed resource', () => {
    expect(
      validateGcpRollbackOverlap(
        [writeStep()],
        [{ ...writeStep(), url: `${BUCKET}/o/obj`, purpose: 'rollback' }],
      ),
    ).toEqual([]);
  });

  it('refuses an exact-resource DELETE over a PUT fix (may pre-exist)', () => {
    const errors = validateGcpRollbackOverlap(
      [writeStep({ method: 'PUT' })],
      [{ ...writeStep(), method: 'DELETE', purpose: 'rollback' }],
    );
    expect(errors.join(' ')).toMatch(/does not target fix step/);
  });

  it('accepts an exact-resource DELETE over a POST fix (created it)', () => {
    expect(
      validateGcpRollbackOverlap(
        [writeStep({ method: 'POST' })],
        [{ ...writeStep(), method: 'DELETE', purpose: 'rollback' }],
      ),
    ).toEqual([]);
  });

  it('refuses a child DELETE unnamed in the fix body', () => {
    const errors = validateGcpRollbackOverlap(
      [writeStep({ method: 'POST', body: { name: 'created-child' } })],
      [
        {
          ...writeStep(),
          method: 'DELETE',
          url: `${BUCKET}/o/pre-existing`,
          purpose: 'rollback',
        },
      ],
    );
    expect(errors.join(' ')).toMatch(/does not target fix step/);
  });

  it('accepts a child DELETE named in the fix body', () => {
    expect(
      validateGcpRollbackOverlap(
        [writeStep({ method: 'POST', body: { name: 'created-child' } })],
        [
          {
            ...writeStep(),
            method: 'DELETE',
            url: `${BUCKET}/o/created-child`,
            purpose: 'rollback',
          },
        ],
      ),
    ).toEqual([]);
  });

  it('refuses overlap across query-selected identity (?name=)', () => {
    const errors = validateGcpRollbackOverlap(
      [writeStep({ url: `${BUCKET}?name=alice` })],
      [
        {
          ...writeStep(),
          url: `${BUCKET}?name=bob`,
          purpose: 'rollback',
        },
      ],
    );
    expect(errors.join(' ')).toMatch(/does not target fix step/);
  });
});
