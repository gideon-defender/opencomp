const mockOrgRoleFindMany = jest.fn();
jest.mock('@db', () => ({
  db: {
    organizationRole: {
      findMany: (...a: unknown[]) => mockOrgRoleFindMany(...a),
    },
  },
}));

jest.mock('@gideon-defender/auth', () => ({
  BUILT_IN_ROLE_PERMISSIONS: {
    owner: { app: ['read'] },
    admin: { app: ['read'] },
    auditor: { app: ['read'] },
    employee: { policy: ['read'], portal: ['read', 'update'] },
    contractor: { policy: ['read'], portal: ['read', 'update'] },
  },
}));

import {
  getValidRoleNames,
  hasAppAccess,
  mergeInto,
  resolveRolePermissions,
  splitRoleString,
} from './app-access';

describe('hasAppAccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrgRoleFindMany.mockResolvedValue([]);
  });

  it('grants for built-in app roles without a DB lookup', async () => {
    expect(await hasAppAccess('org_1', 'owner')).toBe(true);
    expect(await hasAppAccess('org_1', 'admin')).toBe(true);
    expect(await hasAppAccess('org_1', 'auditor')).toBe(true);
    expect(mockOrgRoleFindMany).not.toHaveBeenCalled();
  });

  it('denies for Portal-only built-in roles', async () => {
    expect(await hasAppAccess('org_1', 'employee')).toBe(false);
    expect(await hasAppAccess('org_1', 'contractor')).toBe(false);
  });

  it('treats comma-separated roles as a union (any granting role wins)', async () => {
    expect(await hasAppAccess('org_1', 'employee,admin')).toBe(true);
  });

  it('grants for a custom role with app:read', async () => {
    mockOrgRoleFindMany.mockResolvedValue([
      { permissions: JSON.stringify({ app: ['read'], control: ['read'] }) },
    ]);
    expect(await hasAppAccess('org_1', 'Compliance Lead')).toBe(true);
  });

  it('denies for a custom role without app:read', async () => {
    mockOrgRoleFindMany.mockResolvedValue([
      { permissions: JSON.stringify({ policy: ['read'], portal: ['read'] }) },
    ]);
    expect(await hasAppAccess('org_1', 'Portal Role')).toBe(false);
  });

  it('denies for empty or null roles', async () => {
    expect(await hasAppAccess('org_1', null)).toBe(false);
    expect(await hasAppAccess('org_1', '')).toBe(false);
  });

  it('treats a role named like an Object prototype key (constructor) as custom', async () => {
    // Must NOT be shadowed by Object.prototype.constructor — it's a custom role.
    mockOrgRoleFindMany.mockResolvedValue([
      { permissions: JSON.stringify({ app: ['read'] }) },
    ]);
    expect(await hasAppAccess('org_1', 'constructor')).toBe(true);
    expect(mockOrgRoleFindMany).toHaveBeenCalled();
  });

  it('does not throw on malformed custom-role permissions', async () => {
    mockOrgRoleFindMany.mockResolvedValue([{ permissions: '{not valid json' }]);
    await expect(hasAppAccess('org_1', 'Broken Role')).resolves.toBe(false);
  });
});

describe('getValidRoleNames', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrgRoleFindMany.mockResolvedValue([]);
  });

  it('returns the built-in names and scopes the lookup to the org', async () => {
    const names = await getValidRoleNames('org_1');

    expect(names.has('owner')).toBe(true);
    expect(names.has('admin')).toBe(true);
    expect(names.has('auditor')).toBe(true);
    expect(names.has('employee')).toBe(true);
    expect(names.has('contractor')).toBe(true);
    expect(mockOrgRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org_1' },
        select: { name: true },
      }),
    );
  });

  it('unions custom role names with the built-ins', async () => {
    mockOrgRoleFindMany.mockResolvedValue([{ name: 'security-reviewer' }]);

    const names = await getValidRoleNames('org_1');

    expect(names.has('security-reviewer')).toBe(true);
    expect(names.has('admin')).toBe(true);
    expect(names.has('bogus')).toBe(false);
  });
});

describe('splitRoleString', () => {
  it('returns null for null or undefined (no membership row)', () => {
    expect(splitRoleString(null)).toBeNull();
    expect(splitRoleString(undefined)).toBeNull();
  });

  it('splits on commas, trims, and drops blanks', () => {
    expect(splitRoleString('admin, employee ,,auditor ')).toEqual([
      'admin',
      'employee',
      'auditor',
    ]);
  });

  it('returns an empty array for a blank role string', () => {
    expect(splitRoleString('  ')).toEqual([]);
  });
});

describe('resolveRolePermissions hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrgRoleFindMany.mockResolvedValue([]);
  });

  it('trims whitespace so " admin" still grants', async () => {
    const perms = await resolveRolePermissions('org_1', [' admin ']);
    expect(perms.app).toEqual(expect.arrayContaining(['read']));
    expect(mockOrgRoleFindMany).not.toHaveBeenCalled();
  });

  it('does not crash on toString/valueOf stored rows', async () => {
    mockOrgRoleFindMany.mockResolvedValue([
      { permissions: JSON.stringify({ toString: ['read'], app: ['read'] }) },
    ]);
    await expect(resolveRolePermissions('org_1', ['Custom'])).resolves.toEqual(
      expect.objectContaining({ app: ['read'] }),
    );
  });

  it('mergeInto shadows inherited keys instead of throwing', () => {
    const target: Record<string, Set<string>> = {};
    expect(() =>
      mergeInto(target, { toString: ['read'], app: ['read'] }),
    ).not.toThrow();
    expect(target.app?.has('read')).toBe(true);
  });
});
