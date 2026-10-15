import {
  EntitlementsDeniedError,
  enforceOidcEntitlements,
  evaluateEntitlements,
  parseEntitlementsClaim,
} from './oidc-entitlements';
import { enforceBootstrapGate } from './oidc-gates';

const mockOrgFindUnique = jest.fn();
const mockOrgRoleFindMany = jest.fn();
const mockMemberFindFirst = jest.fn();
jest.mock('@db', () => ({
  db: {
    organization: {
      findUnique: (...args: unknown[]) => mockOrgFindUnique(...args),
    },
    organizationRole: {
      findMany: (...args: unknown[]) => mockOrgRoleFindMany(...args),
    },
    member: { findFirst: (...args: unknown[]) => mockMemberFindFirst(...args) },
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockOrgFindUnique.mockResolvedValue({ id: 'tenant-1' });
  mockOrgRoleFindMany.mockResolvedValue([]);
  mockMemberFindFirst.mockResolvedValue(null);
});

describe('parseEntitlementsClaim', () => {
  it('returns empty for absent or invalid claims', () => {
    expect(parseEntitlementsClaim(undefined)).toEqual([]);
    expect(parseEntitlementsClaim(null)).toEqual([]);
    expect(parseEntitlementsClaim({})).toEqual([]);
    expect(parseEntitlementsClaim({ entitlements: 'admin' })).toEqual([]);
    expect(parseEntitlementsClaim({ entitlements: [] })).toEqual([]);
  });

  it('drops non-string and blank entries', () => {
    expect(
      parseEntitlementsClaim({
        entitlements: ['admin', 42, null, '  ', 'auditor'],
      }),
    ).toEqual(['admin', 'auditor']);
  });

  it('trims survivors and keeps duplicates as presented', () => {
    expect(
      parseEntitlementsClaim({
        entitlements: [' admin ', 'admin', 'auditor '],
      }),
    ).toEqual(['admin', 'admin', 'auditor']);
  });

  it('rejects control characters without changing role names', () => {
    expect(
      parseEntitlementsClaim({
        entitlements: [
          'admin\noidc.entitlements.enforce grant email=x',
          'au\x7fditor',
        ],
      }),
    ).toEqual([]);
  });
});

describe('malformed entitlement authorization', () => {
  it.each(['ad\nmin', 'ow\x7fner', 'au\x00ditor', '\towner'])(
    'rejects %j at enforcement',
    async (role) => {
      await expect(
        enforceOidcEntitlements({
          claims: { entitlements: [role] },
          email: 'ada@example.com',
          tenantId: 'tenant-1',
        }),
      ).rejects.toBeInstanceOf(EntitlementsDeniedError);
    },
  );

  it('keeps valid entries when another value is malformed', async () => {
    await expect(
      enforceOidcEntitlements({
        claims: { entitlements: ['ad\nmin', ' employee '] },
        email: 'ada@example.com',
        tenantId: 'tenant-1',
      }),
    ).resolves.toEqual({ matched: ['employee'] });
  });

  it('does not bootstrap an unknown tenant from a malformed owner value', async () => {
    mockOrgFindUnique.mockResolvedValue(null);
    await expect(
      enforceBootstrapGate({
        claims: { entitlements: ['ow\x7fner'] },
        email: 'ada@example.com',
        tenantId: 'tenant-new',
      }),
    ).rejects.toMatchObject({ reason: 'no_owner_bootstrap' });
  });
});

describe('evaluateEntitlements', () => {
  it('returns matched/unmatched with tenantKnown for a known org', async () => {
    const result = await evaluateEntitlements({
      claims: { sub: 'u1', entitlements: ['admin', 'other-app'] },
      tenantId: 'tenant-1',
    });

    expect(result.tenantKnown).toBe(true);
    expect(result.matched).toEqual(['admin']);
    expect(result.unmatched).toEqual(['other-app']);
  });

  it('matches built-ins for unknown tenants (bootstrap owner check)', async () => {
    mockOrgFindUnique.mockResolvedValue(null);

    const result = await evaluateEntitlements({
      claims: { sub: 'u1', entitlements: ['owner', 'other-app'] },
      tenantId: 'tenant-new',
    });

    expect(result.tenantKnown).toBe(false);
    expect(result.matched).toEqual(['owner']);
    expect(result.unmatched).toEqual(['other-app']);
  });

  it('propagates database failures for the caller to decide', async () => {
    mockOrgRoleFindMany.mockRejectedValue(new Error('db down'));

    await expect(
      evaluateEntitlements({
        claims: { sub: 'u1', entitlements: ['admin'] },
        tenantId: 'tenant-1',
      }),
    ).rejects.toThrow('db down');
  });
});

describe('enforceOidcEntitlements (Phase 1 pilot)', () => {
  it('returns matched roles for a valid assignment', async () => {
    const result = await enforceOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin'] },
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({ matched: ['admin'] });
  });

  it('denies empty entitlements with a distinguished error', async () => {
    const error: unknown = await enforceOidcEntitlements({
      claims: { sub: 'u1' },
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    }).catch((err: unknown) => err);

    if (!(error instanceof EntitlementsDeniedError)) {
      throw new Error('expected EntitlementsDeniedError');
    }
    expect(error.reason).toBe('empty_entitlements');
  });

  it('denies wrong-app entitlements with no_valid_match', async () => {
    const error: unknown = await enforceOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['other-app-role'] },
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    }).catch((err: unknown) => err);

    if (!(error instanceof EntitlementsDeniedError)) {
      throw new Error('expected EntitlementsDeniedError');
    }
    expect(error.reason).toBe('no_valid_match');
  });

  it('denies unknown tenants closed (allowlisted tenant with no org row)', async () => {
    mockOrgFindUnique.mockResolvedValue(null);

    const error: unknown = await enforceOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['owner'] },
      email: 'ada@example.com',
      tenantId: 'tenant-missing',
    }).catch((err: unknown) => err);

    if (!(error instanceof EntitlementsDeniedError)) {
      throw new Error('expected EntitlementsDeniedError');
    }
    expect(error.reason).toBe('unknown_tenant');
  });

  it('propagates lookup failures raw (fail closed, distinct from deny)', async () => {
    mockOrgRoleFindMany.mockRejectedValue(new Error('db down'));

    const error: unknown = await enforceOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin'] },
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(EntitlementsDeniedError);
  });
});
