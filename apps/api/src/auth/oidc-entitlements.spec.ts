import { auditOidcEntitlements } from './oidc-entitlements';

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

describe('auditOidcEntitlements (Phase 0 audit mode)', () => {
  it('flags empty entitlements as would-deny without writing', async () => {
    const result = await auditOidcEntitlements({
      claims: { sub: 'u1' },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(true);
    expect(result.reason).toBe('empty_entitlements');
    expect(mockMemberFindFirst).not.toHaveBeenCalled();
  });

  it('flags a missing tenant as would-deny without any lookup', async () => {
    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin'] },
      userId: 'usr_1',
      email: 'ada@example.com',
    });

    expect(result.wouldDeny).toBe(true);
    expect(result.reason).toBe('unknown_tenant');
    expect(result.presented).toEqual(['admin']);
    expect(result.unmatched).toEqual(['admin']);
    expect(mockOrgFindUnique).not.toHaveBeenCalled();
    expect(mockMemberFindFirst).not.toHaveBeenCalled();
  });

  it('flags unknown tenants as would-deny', async () => {
    mockOrgFindUnique.mockResolvedValue(null);

    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-unknown',
    });

    expect(result.wouldDeny).toBe(true);
    expect(result.reason).toBe('unknown_tenant');
  });

  it('denies wrong-app entitlements with no valid match', async () => {
    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['other-app-role'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(true);
    expect(result.reason).toBe('no_valid_match');
    expect(result.unmatched).toEqual(['other-app-role']);
  });

  it('matches built-in names and reports would-overwrite on role drift', async () => {
    mockMemberFindFirst.mockResolvedValue({ role: 'employee' });

    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(false);
    expect(result.matched).toEqual(['admin']);
    expect(result.memberRole).toBe('employee');
    expect(result.wouldOverwrite).toBe(true);
  });

  it('matches whitespace-padded entitlements after trimming', async () => {
    mockMemberFindFirst.mockResolvedValue({ role: 'admin' });

    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: [' admin '] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(false);
    expect(result.matched).toEqual(['admin']);
    expect(result.unmatched).toEqual([]);
  });

  it('reports would-keep when the cached role already matches', async () => {
    mockMemberFindFirst.mockResolvedValue({ role: 'admin' });

    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(false);
    expect(result.memberRole).toBe('admin');
    expect(result.wouldOverwrite).toBe(false);
  });

  it('reports would-overwrite for a first-time member with no cached role', async () => {
    mockMemberFindFirst.mockResolvedValue(null);

    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(false);
    expect(result.memberRole).toBeNull();
    expect(result.wouldOverwrite).toBe(true);
  });

  it('treats duplicate entitlements as set-equal (no spurious overwrite)', async () => {
    mockMemberFindFirst.mockResolvedValue({ role: 'admin' });

    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin', 'admin'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(false);
    expect(result.presented).toEqual(['admin', 'admin']);
    expect(result.wouldOverwrite).toBe(false);
  });

  it('matches custom OrganizationRole names', async () => {
    mockOrgRoleFindMany.mockResolvedValue([{ name: 'security-reviewer' }]);

    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['security-reviewer'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(false);
    expect(result.matched).toEqual(['security-reviewer']);
  });

  it('splits a partial match and still allows login', async () => {
    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin', 'bogus'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(false);
    expect(result.presented).toEqual(['admin', 'bogus']);
    expect(result.matched).toEqual(['admin']);
    expect(result.unmatched).toEqual(['bogus']);
  });

  it('treats comma-separated cached roles as a set (order-independent keep)', async () => {
    mockMemberFindFirst.mockResolvedValue({ role: 'admin,employee' });

    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['employee', 'admin'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(false);
    expect(result.memberRole).toBe('admin,employee');
    expect(result.wouldOverwrite).toBe(false);
  });

  it('reports would-overwrite when the cached set drifts from presented', async () => {
    mockMemberFindFirst.mockResolvedValue({ role: 'admin,employee' });

    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(false);
    expect(result.wouldOverwrite).toBe(true);
  });

  it('matches role names verbatim (case-sensitive, no translation table)', async () => {
    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['Admin'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(true);
    expect(result.reason).toBe('no_valid_match');
    expect(result.unmatched).toEqual(['Admin']);
  });

  it('never throws on lookup failure (audit must not break login)', async () => {
    mockOrgRoleFindMany.mockRejectedValue(new Error('db down'));

    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(false);
    expect(result.reason).toBe('lookup_failed');
    expect(result.presented).toEqual(['admin']);
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  it('never throws when the org lookup fails', async () => {
    mockOrgFindUnique.mockRejectedValue(new Error('db down'));

    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(false);
    expect(result.reason).toBe('lookup_failed');
  });

  it('never throws when the member lookup fails after a match', async () => {
    mockMemberFindFirst.mockRejectedValue(new Error('db down'));

    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(false);
    expect(result.reason).toBe('lookup_failed');
  });

  it('never throws on a non-Error rejection', async () => {
    mockOrgRoleFindMany.mockRejectedValue('db down');

    const result = await auditOidcEntitlements({
      claims: { sub: 'u1', entitlements: ['admin'] },
      userId: 'usr_1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(result.wouldDeny).toBe(false);
    expect(result.reason).toBe('lookup_failed');
  });
});
