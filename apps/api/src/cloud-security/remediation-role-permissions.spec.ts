import {
  normalizePolicyStatements,
  readRolePermissionSets,
  type RolePolicyReader,
} from './remediation-permission-coverage';

function doc(
  statements: Array<{
    Effect: string;
    Action?: string | string[];
    NotAction?: string | string[];
  }>,
): unknown {
  return { Version: '2012-10-17', Statement: statements };
}

/** Paged inline policies: each entry is one page of policy-name lists. */
function inlineReader(
  pages: string[][],
  docs: Record<string, unknown>,
): { reader: RolePolicyReader; seenMarkers: Array<string | undefined> } {
  const seenMarkers: Array<string | undefined> = [];
  let attachedCalled = 0;
  const reader: RolePolicyReader = {
    listInlinePolicyNames: async ({ marker }) => {
      seenMarkers.push(marker);
      const index = marker === undefined ? 0 : Number(marker) + 1;
      return {
        names: pages[index] ?? [],
        marker: index + 1 < pages.length ? String(index) : undefined,
      };
    },
    getInlinePolicyDocument: async ({ policyName }) => {
      const found = docs[policyName];
      if (!found) throw new Error(`no such policy: ${policyName}`);
      return found;
    },
    listAttachedPolicies: async () => {
      attachedCalled += 1;
      return { policies: [] };
    },
    getAttachedPolicyDocument: async () => {
      throw new Error('should not be called');
    },
  };
  void attachedCalled;
  return { reader, seenMarkers };
}

describe('normalizePolicyStatements', () => {
  it('wraps a single statement object in an array', () => {
    expect(
      normalizePolicyStatements(
        doc([{ Effect: 'Allow', Action: ['s3:GetObject'] }]),
      ),
    ).toHaveLength(1);
  });

  it('keeps statement arrays and drops non-objects', () => {
    const statements = normalizePolicyStatements({
      Statement: [
        { Effect: 'Allow', Action: 's3:GetObject' },
        null,
        'nonsense',
        { Effect: 'Deny', Action: ['s3:PutObject'] },
      ],
    });
    expect(statements).toHaveLength(2);
  });

  it('returns empty for missing or malformed documents', () => {
    for (const bad of [null, undefined, 42, [], {}, { Statement: null }]) {
      expect(normalizePolicyStatements(bad)).toEqual([]);
    }
  });
});

describe('readRolePermissionSets — pagination and deny semantics', () => {
  it('follows inline-policy pagination instead of dropping later pages', async () => {
    const { reader, seenMarkers } = inlineReader([['p1'], ['p2']], {
      p1: doc([{ Effect: 'Allow', Action: ['s3:GetObject'] }]),
      p2: doc([{ Effect: 'Allow', Action: ['s3:PutObject'] }]),
    });
    const errors: string[] = [];

    const { allowed, denied } = await readRolePermissionSets(
      reader,
      'OpenComp-Remediator',
      (message) => errors.push(message),
    );

    expect(allowed).toEqual(new Set(['s3:GetObject', 's3:PutObject']));
    expect(denied).toEqual(new Set());
    expect(errors).toEqual([]);
    // First call unmarked, second call carries the page marker.
    expect(seenMarkers).toEqual([undefined, '0']);
  });

  it('reads attached managed policies across pages', async () => {
    const attachedMarkers: Array<string | undefined> = [];
    const reader: RolePolicyReader = {
      listInlinePolicyNames: async () => ({ names: [] }),
      getInlinePolicyDocument: async () => {
        throw new Error('should not be called');
      },
      listAttachedPolicies: async ({ marker }) => {
        attachedMarkers.push(marker);
        return marker === undefined
          ? {
              policies: [],
              marker: 'a1',
            }
          : {
              policies: [{ arn: 'arn:aws:iam::aws:policy/Extra' }],
              marker: undefined,
            };
      },
      getAttachedPolicyDocument: async (policyArn) => {
        expect(policyArn).toBe('arn:aws:iam::aws:policy/Extra');
        return doc([{ Effect: 'Allow', Action: ['logs:DescribeLogGroups'] }]);
      },
    };

    const { allowed } = await readRolePermissionSets(
      reader,
      'OpenComp-Remediator',
      () => {},
    );

    expect(allowed).toEqual(new Set(['logs:DescribeLogGroups']));
    expect(attachedMarkers).toEqual([undefined, 'a1']);
  });

  it('collects explicit denies alongside allows', async () => {
    const { reader } = inlineReader([['p1']], {
      p1: doc([
        { Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject'] },
        { Effect: 'Deny', Action: ['s3:Get*'] },
      ]),
    });

    const { allowed, denied } = await readRolePermissionSets(
      reader,
      'OpenComp-Remediator',
      () => {},
    );

    expect(allowed).toEqual(new Set(['s3:GetObject', 's3:PutObject']));
    expect(denied).toEqual(new Set(['s3:Get*']));
  });

  it('treats Deny with NotAction as a broad deny instead of zero entries', async () => {
    // Deny-everything-except-X is a common guardrail shape. Dropping the
    // statement would report "ready" while IAM denies execution.
    const { reader } = inlineReader([['p1']], {
      p1: doc([
        { Effect: 'Allow', Action: ['s3:*'] },
        { Effect: 'Deny', NotAction: ['s3:GetObject'] },
      ]),
    });

    const { allowed, denied } = await readRolePermissionSets(
      reader,
      'OpenComp-Remediator',
      () => {},
    );

    expect(allowed).toEqual(new Set(['s3:*']));
    expect(denied).toContain('*');
  });

  it('grants Allow with NotAction no coverage for a concrete action', async () => {
    // Allow-everything-except-X cannot prove a specific action is covered.
    const { reader } = inlineReader([['p1']], {
      p1: doc([{ Effect: 'Allow', NotAction: ['s3:GetObject'] }]),
    });

    const { allowed, denied } = await readRolePermissionSets(
      reader,
      'OpenComp-Remediator',
      () => {},
    );

    expect(allowed).toEqual(new Set());
    expect(denied).toEqual(new Set());
  });

  it('skips unreadable policies but keeps the rest', async () => {
    const { reader } = inlineReader([['good', 'bad']], {
      good: doc([{ Effect: 'Allow', Action: ['s3:GetObject'] }]),
    });
    const errors: string[] = [];

    const { allowed, denied } = await readRolePermissionSets(
      reader,
      'OpenComp-Remediator',
      (message) => errors.push(message),
    );

    expect(allowed).toEqual(new Set(['s3:GetObject']));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Failed to read policy bad/);
    // The unread policy may hide an explicit Deny — fail closed.
    expect(denied).toContain('*');
  });

  it('fails closed on attached policies without an ARN', async () => {
    const reader: RolePolicyReader = {
      listInlinePolicyNames: async () => ({ names: [] }),
      getInlinePolicyDocument: async () => {
        throw new Error('should not be called');
      },
      listAttachedPolicies: async () => ({
        policies: [{ name: 'arn-less' }],
      }),
      getAttachedPolicyDocument: async () => {
        throw new Error('should not be called');
      },
    };
    const errors: string[] = [];

    const { allowed, denied } = await readRolePermissionSets(
      reader,
      'OpenComp-Remediator',
      (message) => errors.push(message),
    );

    // The unreadable policy may hide an explicit Deny — coverage must
    // report missing rather than ready.
    expect(allowed).toEqual(new Set());
    expect(denied).toContain('*');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/missing its ARN/);
  });
});
