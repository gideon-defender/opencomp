import {
  accessForeignShareEntries,
  bindingsGrantPrivilegedRole,
  bindingsGrantPublicAccess,
  bodyGrantsPrivilegedRoleDeep,
  bodyGrantsPublicAccessDeep,
  datasetAccessGrantsPrivilegedRole,
  datasetAccessGrantsPublicAccess,
  isForeignResourceShareEntry,
  isPublicAclEntry,
  isPublicIamMember,
  isPublicPredefinedAcl,
  validatePostRollback,
} from './gcp-remediation-grant-checks';

describe('grant-shape predicates', () => {
  it('detects public IAM members case-insensitively', () => {
    expect(isPublicIamMember('allUsers')).toBe(true);
    expect(isPublicIamMember('ALLAUTHENTICATEDUSERS')).toBe(true);
    expect(isPublicIamMember('alice@example.com')).toBe(false);
    expect(isPublicIamMember(undefined)).toBe(false);
  });

  it('detects public ACL entities and canned ACLs', () => {
    expect(isPublicAclEntry({ entity: 'allUsers' })).toBe(true);
    expect(isPublicAclEntry({ entity: 'user-alice@example.com' })).toBe(false);
    // `authenticatedRead` grants READER to allAuthenticatedUsers.
    expect(isPublicPredefinedAcl('authenticatedRead')).toBe(true);
    expect(isPublicPredefinedAcl('private')).toBe(false);
  });

  it('detects public and privileged bindings', () => {
    expect(
      bindingsGrantPublicAccess([
        { role: 'roles/viewer', members: ['allUsers'] },
      ]),
    ).toBe(true);
    expect(
      bindingsGrantPublicAccess([
        { role: 'roles/viewer', members: ['alice@example.com'] },
      ]),
    ).toBe(false);
    expect(
      bindingsGrantPrivilegedRole([
        { role: 'roles/editor', members: ['mallory@evil.example'] },
      ]),
    ).toBe(true);
    expect(bindingsGrantPrivilegedRole('not-an-array')).toBe(false);
  });

  it('detects dataset access grants including domain shares', () => {
    expect(
      datasetAccessGrantsPublicAccess([{ domain: 'evil.example' }]),
    ).toBe(true);
    expect(
      datasetAccessGrantsPublicAccess([
        { role: 'READER', userByEmail: 'a@example.com' },
      ]),
    ).toBe(false);
    expect(
      datasetAccessGrantsPrivilegedRole([{ role: 'roles/owner' }]),
    ).toBe(true);
  });

  it('spots foreign-share entries and nothing else', () => {
    expect(isForeignResourceShareEntry({ view: { tableId: 'v' } })).toBe(true);
    expect(isForeignResourceShareEntry({})).toBe(false);
    expect(
      accessForeignShareEntries([{ role: 'READER' }, { dataset: { id: 'd' } }]),
    ).toHaveLength(1);
  });

  it('finds deeply nested grants under arbitrary keys', () => {
    expect(
      bodyGrantsPublicAccessDeep({ a: { b: [{ members: ['allUsers'] }] } }),
    ).toBe(true);
    expect(
      bodyGrantsPrivilegedRoleDeep({ iam: { bindings: [{ role: 'roles/owner' }] } }),
    ).toBe(true);
    expect(bodyGrantsPublicAccessDeep({ role: 'roles/viewer' })).toBe(false);
  });
});

describe('validatePostRollback', () => {
  const URL = 'https://storage.googleapis.com/storage/v1/b/my-bucket';
  const FIX = { method: 'POST', url: URL, body: { a: 1 }, purpose: 'fix' };
  const STATE = { read: { a: 1 } };

  function post(body: Record<string, unknown>) {
    return { method: 'POST', url: URL, body, purpose: 'rollback' };
  }

  it('fails closed without pre-fix state', () => {
    const errors = validatePostRollback({
      step: post({ a: 1 }),
      prefix: 'Step 1',
      index: 0,
      rollbackSteps: [post({ a: 1 })],
      fixSteps: [FIX],
    });
    expect(errors.join(' ')).toMatch(/no pre-fix state/);
  });

  it('refuses without reviewed fix steps', () => {
    const errors = validatePostRollback({
      step: post({ a: 1 }),
      prefix: 'Step 1',
      index: 0,
      rollbackSteps: [post({ a: 1 })],
      fixSteps: [],
      previousState: STATE,
    });
    expect(errors.join(' ')).toMatch(/no reviewed fix steps/);
  });

  it('refuses a rollback targeting an untouched resource', () => {
    const errors = validatePostRollback({
      step: { ...post({ a: 1 }), url: `${URL}-other` },
      prefix: 'Step 1',
      index: 0,
      rollbackSteps: [post({ a: 1 })],
      fixSteps: [FIX],
      previousState: STATE,
    });
    expect(errors.join(' ')).toMatch(/no reviewed fix step touched/);
  });

  it('refuses a body that differs from the reviewed write', () => {
    const errors = validatePostRollback({
      step: post({ a: 2 }),
      prefix: 'Step 1',
      index: 0,
      rollbackSteps: [post({ a: 2 })],
      fixSteps: [FIX],
      previousState: STATE,
    });
    expect(errors.join(' ')).toMatch(/differs from the reviewed fix write/);
  });

  it('accepts an exact replay of the reviewed write', () => {
    expect(
      validatePostRollback({
        step: post({ a: 1 }),
        prefix: 'Step 1',
        index: 0,
        rollbackSteps: [post({ a: 1 })],
        fixSteps: [FIX],
        previousState: STATE,
      }),
    ).toEqual([]);
  });
});
