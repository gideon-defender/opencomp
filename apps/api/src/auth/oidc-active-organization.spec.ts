jest.mock('./legacy-shared-user', () => ({
  findLegacySharedUser: jest.fn().mockResolvedValue(undefined),
}));

import { resolveActiveOrganizationId } from './oidc-provisioning';

const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockQueryRaw = jest.fn();
const mockMemberFindFirst = jest.fn();
const mockOrgFindFirst = jest.fn();
const mockOrgFindUnique = jest.fn();

jest.mock('@db', () => ({
  // normalizeEmail is used by the implementation; keep the mock faithful.
  normalizeEmail: jest.requireActual('@gideon-defender/email').normalizeEmail,
  db: {
    user: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    member: {
      findFirst: (...args: unknown[]) => mockMemberFindFirst(...args),
    },
    organization: {
      findFirst: (...args: unknown[]) => mockOrgFindFirst(...args),
      findUnique: (...args: unknown[]) => mockOrgFindUnique(...args),
    },
    session: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

describe('resolveActiveOrganizationId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the tenant org id when the user is a member (tenant is the org)', async () => {
    mockOrgFindUnique.mockResolvedValue({ id: 'tenant-1' });
    mockMemberFindFirst.mockResolvedValue({ id: 'mem_1' });
    mockOrgFindFirst.mockResolvedValue({ id: 'org_recent' });

    await expect(
      resolveActiveOrganizationId({ userId: 'usr_1', tenantId: 'tenant-1' }),
    ).resolves.toBe('tenant-1');

    expect(mockOrgFindUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      select: { id: true },
    });
    expect(mockMemberFindFirst).toHaveBeenCalledWith({
      where: {
        userId: 'usr_1',
        organizationId: 'tenant-1',
        deactivated: false,
        idpAccessRevoked: false,
      },
      select: { id: true },
    });
    expect(mockOrgFindFirst).not.toHaveBeenCalled();
  });

  it('resolves null for unknown tenants (setup flow, no most-recent fallback)', async () => {
    mockOrgFindUnique.mockResolvedValue(null);
    mockOrgFindFirst.mockResolvedValue({ id: 'org_recent' });

    await expect(
      resolveActiveOrganizationId({ userId: 'usr_1', tenantId: 'tenant-1' }),
    ).resolves.toBeNull();
    expect(mockMemberFindFirst).not.toHaveBeenCalled();
    expect(mockOrgFindFirst).not.toHaveBeenCalled();
  });

  it('resolves null when the user is not a member of the tenant org', async () => {
    mockOrgFindUnique.mockResolvedValue({ id: 'tenant-1' });
    mockMemberFindFirst.mockResolvedValue(null);
    mockOrgFindFirst.mockResolvedValue({ id: 'org_recent' });

    await expect(
      resolveActiveOrganizationId({ userId: 'usr_1', tenantId: 'tenant-1' }),
    ).resolves.toBeNull();
    expect(mockOrgFindFirst).not.toHaveBeenCalled();
  });

  it('uses most-recent when no tenant id is given (legacy path)', async () => {
    mockOrgFindFirst.mockResolvedValue({ id: 'org_recent' });

    await expect(
      resolveActiveOrganizationId({ userId: 'usr_1' }),
    ).resolves.toBe('org_recent');
    expect(mockOrgFindUnique).not.toHaveBeenCalled();
  });
});
