jest.mock('./legacy-shared-user', () => ({
  findLegacySharedUser: jest.fn().mockResolvedValue(undefined),
}));
import type { Prisma } from '@db';
import { findLegacySharedUser } from './legacy-shared-user';
import { refreshSsoLoginRoles } from './sso-entitlement-roles';

const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockFindRoles = jest.fn();
const mockSnapshot = jest.fn();

jest.mock('@gideon-defender/auth', () => ({
  BUILT_IN_ROLE_PERMISSIONS: { owner: {}, admin: {}, auditor: {} },
}));
jest.mock('./entitlement-snapshot', () => ({
  fetchEntitlementSnapshot: (...args: unknown[]) => mockSnapshot(...args),
}));

const organizationId = '00000000-0000-0000-0000-000000000001';
const config = {
  readerUrl: 'https://identity.example.com',
  readerToken: 'secret',
  clientId: 'opencomp',
  pagerDutyKey: 'key',
  tenantIds: [organizationId],
};
const tx = {
  user: {
    findUnique: (...args: unknown[]) => mockFindUnique(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
  organizationRole: {
    findMany: (...args: unknown[]) => mockFindRoles(...args),
  },
} as unknown as Prisma.TransactionClient;

beforeEach(() => {
  jest.clearAllMocks();
  mockFindRoles.mockResolvedValue([]);
  mockUpdate.mockResolvedValue({ id: 'usr_1', tenantId: organizationId });
  mockSnapshot.mockResolvedValue({
    entitlements: ['admin'],
    user_status: 'active',
    observed_at: new Date().toISOString(),
  });
});

function refresh(userId = 'usr_1') {
  return refreshSsoLoginRoles({ tx, userId, organizationId, config });
}

describe('refreshSsoLoginRoles', () => {
  it('claims an expand-window null-tenant row for the login tenant', async () => {
    mockFindUnique.mockResolvedValue({
      gideonSub: 'sub-1',
      tenantId: null,
      email: 'person@example.com',
    });

    await expect(refresh()).resolves.toEqual(['admin']);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_1' },
      data: { tenantId: organizationId },
    });
  });

  it('rejects a row owned by another tenant without writing', async () => {
    mockFindUnique.mockResolvedValue({
      gideonSub: 'sub-1',
      tenantId: 'foreign-tenant',
      email: 'person@example.com',
    });

    await expect(refresh()).rejects.toThrow('tenant-linked');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it('refreshes a shared membership with the verified secondary login subject', async () => {
    mockFindUnique.mockResolvedValue({
      gideonSub: 'primary-sub',
      tenantId: 'primary',
      email: 'person@example.com',
    });
    jest
      .mocked(findLegacySharedUser)
      .mockResolvedValueOnce({ id: 'usr_1' } as Awaited<
        ReturnType<typeof findLegacySharedUser>
      >);
    await expect(
      refreshSsoLoginRoles({
        tx,
        userId: 'usr_1',
        organizationId,
        config,
        subject: 'secondary-sub',
      }),
    ).resolves.toEqual(['admin']);
    expect(mockSnapshot).toHaveBeenCalledWith({
      config,
      tenantId: organizationId,
      subject: 'secondary-sub',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects a row with no linked subject', async () => {
    mockFindUnique.mockResolvedValue({
      gideonSub: null,
      tenantId: organizationId,
      email: 'person@example.com',
    });

    await expect(refresh()).rejects.toThrow('tenant-linked');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('surfaces a descriptive conflict when the ownership claim collides (P2002)', async () => {
    mockFindUnique.mockResolvedValue({
      gideonSub: 'sub-1',
      tenantId: null,
      email: 'person@example.com',
    });
    mockUpdate.mockRejectedValueOnce({ code: 'P2002' });

    await expect(refresh()).rejects.toThrow('conflicts within tenant');
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it('rethrows non-unique errors from the ownership claim', async () => {
    mockFindUnique.mockResolvedValue({
      gideonSub: 'sub-1',
      tenantId: null,
      email: 'person@example.com',
    });
    const boom = new Error('connection reset');
    mockUpdate.mockRejectedValueOnce(boom);

    await expect(refresh()).rejects.toBe(boom);
    expect(mockSnapshot).not.toHaveBeenCalled();
  });
});
