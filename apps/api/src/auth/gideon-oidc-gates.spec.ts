import {
  isBootstrapEnforced,
  isEnforcementEnabledFor,
  isKnownTenant,
} from './gideon-oidc-gates';

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

describe('pilot allowlist + bootstrap gates', () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('isEnforcementEnabledFor matches allowlisted tenants only', () => {
    process.env.GIDEON_ENFORCEMENT_TENANTS = 'tenant-1, tenant-2';

    expect(isEnforcementEnabledFor('tenant-1')).toBe(true);
    expect(isEnforcementEnabledFor('tenant-2')).toBe(true);
    expect(isEnforcementEnabledFor('tenant-3')).toBe(false);
    expect(isEnforcementEnabledFor(undefined)).toBe(false);
  });

  it('isEnforcementEnabledFor is audit-everywhere when unset', () => {
    delete process.env.GIDEON_ENFORCEMENT_TENANTS;

    expect(isEnforcementEnabledFor('tenant-1')).toBe(false);
  });

  it('enforces every identified tenant in all-tenant mode without an allowlist', () => {
    process.env.GIDEON_ENFORCEMENT_ALL_TENANTS = 'true';
    delete process.env.GIDEON_ENFORCEMENT_TENANTS;
    expect(isEnforcementEnabledFor('tenant-1')).toBe(true);
    expect(isEnforcementEnabledFor('new-tenant')).toBe(true);
    expect(isEnforcementEnabledFor(undefined)).toBe(false);
  });

  it('requires explicit true for all-tenant mode', () => {
    process.env.GIDEON_ENFORCEMENT_ALL_TENANTS = 'false';
    delete process.env.GIDEON_ENFORCEMENT_TENANTS;
    expect(isEnforcementEnabledFor('tenant-1')).toBe(false);
  });

  it('isBootstrapEnforced defaults off', () => {
    delete process.env.GIDEON_BOOTSTRAP_ENFORCED;
    expect(isBootstrapEnforced()).toBe(false);

    process.env.GIDEON_BOOTSTRAP_ENFORCED = 'true';
    expect(isBootstrapEnforced()).toBe(true);
  });

  it('isKnownTenant distinguishes org rows from unknown tenants', async () => {
    expect(await isKnownTenant('tenant-1')).toBe(true);

    mockOrgFindUnique.mockResolvedValue(null);
    expect(await isKnownTenant('tenant-x')).toBe(false);
    expect(await isKnownTenant(undefined)).toBe(false);
  });
});
