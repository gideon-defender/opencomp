import {
  iamActionPatternMatches,
  isPermissionCoveredBySet,
  readRolePermissionSets,
  subtractDeniedActions,
  type RolePolicyReader,
} from './remediation-permission-coverage';

describe('iamActionPatternMatches', () => {
  it('matches exact actions case-insensitively', () => {
    expect(iamActionPatternMatches('s3:GetObject', 's3:GetObject')).toBe(true);
    expect(iamActionPatternMatches('S3:GETOBJECT', 's3:GetObject')).toBe(true);
    expect(iamActionPatternMatches('s3:GetObject', 's3:PutObject')).toBe(false);
  });

  it('matches service wildcards', () => {
    expect(iamActionPatternMatches('s3:*', 's3:CreateBucket')).toBe(true);
    expect(iamActionPatternMatches('s3:*', 'ec2:RunInstances')).toBe(false);
    expect(iamActionPatternMatches('*', 's3:GetObject')).toBe(true);
  });

  it('matches partial wildcards', () => {
    expect(iamActionPatternMatches('s3:Get*', 's3:GetObject')).toBe(true);
    expect(iamActionPatternMatches('s3:Get*', 's3:PutObject')).toBe(false);
    expect(iamActionPatternMatches('s3:*Bucket*', 's3:CreateBucket')).toBe(
      true,
    );
    expect(iamActionPatternMatches('s3:*Bucket*', 's3:GetObject')).toBe(false);
  });

  it('treats RegExp syntax in the pattern as literal', () => {
    expect(iamActionPatternMatches('s3:Get(Object)', 's3:GetObject')).toBe(
      false,
    );
    expect(iamActionPatternMatches('s3:Get.Object', 's3:GetXObject')).toBe(
      false,
    );
  });

  it('matches the single-character wildcard like IAM', () => {
    expect(iamActionPatternMatches('s3:Get?bject', 's3:GetObject')).toBe(true);
    expect(iamActionPatternMatches('s3:Get?bject', 's3:GetObjects')).toBe(
      false,
    );
    expect(iamActionPatternMatches('s3:Get?', 's3:GetObject')).toBe(false);
  });
});

describe('subtractDeniedActions', () => {
  it('removes exact and case-variant denies', () => {
    const allowed = new Set(['s3:GetObject', 's3:PutObject']);
    subtractDeniedActions(allowed, new Set(['S3:GetObject']));
    expect(allowed).toEqual(new Set(['s3:PutObject']));
  });

  it('removes actions covered by partial-wildcard denies', () => {
    const allowed = new Set(['s3:GetObject', 's3:PutObject']);
    subtractDeniedActions(allowed, new Set(['s3:Get*']));
    expect(allowed).toEqual(new Set(['s3:PutObject']));
  });

  it('clears everything on global denies', () => {
    for (const deny of ['*', '*:*']) {
      const allowed = new Set(['s3:GetObject']);
      subtractDeniedActions(allowed, new Set([deny]));
      expect(allowed).toEqual(new Set());
    }
  });

  it('leaves unmatched allows alone', () => {
    const allowed = new Set(['s3:GetObject']);
    subtractDeniedActions(allowed, new Set(['ec2:*']));
    expect(allowed).toEqual(new Set(['s3:GetObject']));
  });
});

describe('isPermissionCoveredBySet', () => {
  it('covers exact, service-wildcard, and partial-wildcard grants', () => {
    expect(
      isPermissionCoveredBySet(
        's3:GetObject',
        new Set(['s3:GetObject', 'ec2:DescribeInstances']),
      ),
    ).toBe(true);
    expect(isPermissionCoveredBySet('s3:GetObject', new Set(['s3:*']))).toBe(
      true,
    );
    expect(isPermissionCoveredBySet('s3:GetObject', new Set(['s3:Get*']))).toBe(
      true,
    );
    expect(isPermissionCoveredBySet('s3:GetObject', new Set(['*']))).toBe(true);
  });

  it('does not cover across services or verbs', () => {
    expect(isPermissionCoveredBySet('s3:GetObject', new Set(['ec2:*']))).toBe(
      false,
    );
    expect(isPermissionCoveredBySet('s3:GetObject', new Set(['s3:Put*']))).toBe(
      false,
    );
    expect(isPermissionCoveredBySet('s3:GetObject', new Set())).toBe(false);
  });

  it('lets a specific deny defeat a wildcard allow', () => {
    expect(
      isPermissionCoveredBySet(
        's3:GetObject',
        new Set(['s3:*']),
        new Set(['s3:GetObject']),
      ),
    ).toBe(false);
    expect(
      isPermissionCoveredBySet(
        's3:GetObject',
        new Set(['s3:*']),
        new Set(['s3:Get*']),
      ),
    ).toBe(false);
    expect(
      isPermissionCoveredBySet(
        's3:GetObject',
        new Set(['s3:*']),
        new Set(['s3:Get?bject']),
      ),
    ).toBe(false);
    expect(
      isPermissionCoveredBySet(
        's3:PutObject',
        new Set(['s3:*']),
        new Set(['s3:GetObject']),
      ),
    ).toBe(true);
  });
});

describe('readRolePermissionSets', () => {
  const reader = (overrides: Partial<RolePolicyReader>): RolePolicyReader => ({
    listInlinePolicyNames: async () => ({ names: ['p1'] }),
    getInlinePolicyDocument: async () => ({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Action: ['s3:GetObject'] }],
    }),
    listAttachedPolicies: async () => ({ policies: [] }),
    getAttachedPolicyDocument: async () => ({}),
    ...overrides,
  });

  it('fails closed when a policy read errors (deny-everything)', async () => {
    const errors: string[] = [];
    const { allowed, denied } = await readRolePermissionSets(
      reader({
        getInlinePolicyDocument: async () => {
          throw new Error('access denied');
        },
      }),
      'OpenComp-Remediator',
      (message) => errors.push(message),
    );
    expect(errors).toHaveLength(1);
    // The unread policy may hide an explicit Deny — coverage must report
    // missing rather than ready.
    expect(isPermissionCoveredBySet('s3:GetObject', allowed, denied)).toBe(
      false,
    );
  });

  it('fails closed when an attached policy ARN is missing', async () => {
    const errors: string[] = [];
    const { denied } = await readRolePermissionSets(
      reader({
        listAttachedPolicies: async () => ({ policies: [{}] }),
      }),
      'OpenComp-Remediator',
      (message) => errors.push(message),
    );
    expect(errors).toHaveLength(1);
    expect(denied.has('*')).toBe(true);
  });
});
