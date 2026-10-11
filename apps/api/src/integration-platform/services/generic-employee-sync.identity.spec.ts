const mockResolveHrIdentity = jest.fn();
const mockGetHrSyncUser = jest.fn();
jest.mock('./hr-sync-idp', () => ({
  createHrIdentityResolver: () => mockResolveHrIdentity,
  getHrSyncUser: (...args: unknown[]) => mockGetHrSyncUser(...args),
}));

import type { SyncEmployee } from '@gideon-defender/integration-platform';

const mockUserFindUnique = jest.fn();
const mockUserCreate = jest.fn();
const mockMemberFindFirst = jest.fn();
const mockMemberCreate = jest.fn();
const mockMemberFindMany = jest.fn();
const mockMemberUpdate = jest.fn();
const mockOrgRoleFindMany = jest.fn();

jest.mock('@gideon-defender/auth', () => ({
  BUILT_IN_ROLE_PERMISSIONS: {
    owner: {},
    admin: {},
    auditor: {},
    employee: {},
    contractor: {},
  },
}));

jest.mock('@db', () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      create: (...args: unknown[]) => mockUserCreate(...args),
    },
    member: {
      findFirst: (...args: unknown[]) => mockMemberFindFirst(...args),
      create: (...args: unknown[]) => mockMemberCreate(...args),
      findMany: (...args: unknown[]) => mockMemberFindMany(...args),
      update: (...args: unknown[]) => mockMemberUpdate(...args),
    },
    organizationRole: {
      findMany: (...args: unknown[]) => mockOrgRoleFindMany(...args),
    },
  },
}));

import { GenericEmployeeSyncService } from './generic-employee-sync.service';

import { Logger } from '@nestjs/common';
import { HR_SYNC_IDENTITY_SKIP_REASON } from './hr-sync-identity';

describe('Generic employee sync IdP identity gate', () => {
  const email = 'employee@example.com';
  const service = new GenericEmployeeSyncService();
  const employee: SyncEmployee = { email, status: 'active', role: 'admin' };

  beforeEach(() => {
    jest.resetAllMocks();
    mockResolveHrIdentity.mockResolvedValue(null);
    mockOrgRoleFindMany.mockResolvedValue([]);
    mockMemberFindMany.mockResolvedValue([]);
    mockMemberFindFirst.mockResolvedValue(null);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    null,
    { id: 'user_1', gideonSub: null },
    { id: 'user_1', gideonSub: ' ' },
    { id: 'user_1', gideonSub: 'old_idp_sub' },
  ])(
    'skips an employee absent from the IdP without creating or changing access: %p',
    async (user) => {
      mockUserFindUnique.mockResolvedValue(user);
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const result = await service.processEmployees({
        organizationId: 'org_1',
        employees: [employee],
      });
      expect(result.skipped).toBe(1);
      expect(result.details).toEqual([
        { email, status: 'skipped', reason: HR_SYNC_IDENTITY_SKIP_REASON },
      ]);
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'missing_idp_identity',
          organizationId: 'org_1',
          email,
        }),
      );
      expect(mockUserCreate).not.toHaveBeenCalled();
      expect(mockMemberFindFirst).not.toHaveBeenCalled();
      expect(mockMemberCreate).not.toHaveBeenCalled();
      expect(mockMemberUpdate).not.toHaveBeenCalled();
    },
  );

  it.each(['active', 'inactive'] as const)(
    'leaves %s members absent from the IdP unchanged during directory sync',
    async (status) => {
      mockUserFindUnique.mockResolvedValue({ id: 'user_1', gideonSub: null });
      mockMemberFindMany.mockResolvedValue([
        { id: 'member_1', role: 'employee', user: { email, gideonSub: null } },
      ]);
      const result = await service.processEmployees({
        organizationId: 'org_1',
        employees: [{ ...employee, status }],
        options: { isDirectorySource: true, allowReactivation: true },
      });
      expect(result.skipped).toBe(1);
      expect(mockMemberUpdate).not.toHaveBeenCalled();
      expect(mockMemberCreate).not.toHaveBeenCalled();
    },
  );

  it('syncs a confirmed IdP employee before their first login', async () => {
    mockResolveHrIdentity.mockResolvedValue({ id: 'idp_1', email });
    mockGetHrSyncUser.mockResolvedValue({ id: 'user_1', gideonSub: 'idp_1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user_1', gideonSub: 'idp_1' });
    const result = await service.processEmployees({
      organizationId: 'org_1',
      employees: [employee],
    });
    expect(result.imported).toBe(1);
    expect(mockMemberCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user_1' }),
      }),
    );
    expect(mockUserCreate).not.toHaveBeenCalled();
  });
  it('records a failed offboarding lookup and continues with later linked members', async () => {
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'member_failed',
        role: 'employee',
        user: { email, gideonSub: null },
      },
      {
        id: 'member_linked',
        role: 'employee',
        user: { email: 'linked@example.com', gideonSub: 'idp_linked' },
      },
    ]);
    mockResolveHrIdentity
      .mockRejectedValueOnce(new Error('IdP unavailable'))
      .mockResolvedValueOnce({ id: 'idp_linked', email: 'linked@example.com' });
    const result = await service.processEmployees({
      organizationId: 'org_1',
      employees: [{ ...employee, status: 'inactive' }],
      options: { isDirectorySource: true },
    });
    expect(result.success).toBe(false);
    expect(result.errors).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.deactivated).toBe(1);
    expect(result.details).toContainEqual({
      email,
      status: 'error',
      reason: 'IdP unavailable',
    });
    expect(mockMemberUpdate).toHaveBeenCalledTimes(1);
    expect(mockMemberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'member_linked' } }),
    );
  });
});
