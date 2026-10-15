jest.mock('./hr-sync-idp', () => ({
  createHrIdentityResolver:
    () =>
    async ({ email }: { email: string }) => ({ id: 'idp_confirmed', email }),
  getHrSyncUser: ({ identity }: { identity: { email: string } }) =>
    mockUserFindUnique({ where: { email: identity.email } }),
}));

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

describe('GenericEmployeeSyncService SSO role ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({ id: 'user_1', oidcSub: 'idp_1' });
    mockMemberFindMany.mockResolvedValue([]);
    mockOrgRoleFindMany.mockResolvedValue([]);
  });

  it.each([
    { role: '', roleSource: 'sso', idpAccessRevoked: true },
    { role: 'retired-custom-role', roleSource: 'sso', idpAccessRevoked: false },
    { role: '', roleSource: 'local', idpAccessRevoked: true },
  ])('preserves IdP roles and revocation: %j', async (state) => {
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_1',
      deactivated: false,
      onboardDate: null,
      ...state,
    });
    await new GenericEmployeeSyncService().processEmployees({
      organizationId: 'org_1',
      employees: [
        {
          email: 'ada@example.com',
          name: 'Ada',
          status: 'active',
          role: 'admin',
          startDate: '2026-01-01',
        },
      ],
    });
    expect(mockMemberUpdate).toHaveBeenCalledWith({
      where: { id: 'mem_1' },
      data: { onboardDate: new Date('2026-01-01') },
    });
    expect(mockMemberCreate).not.toHaveBeenCalled();
  });

  it('preserves revocation and roles when HR reactivates an employee', async () => {
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_1',
      role: '',
      roleSource: 'sso',
      idpAccessRevoked: true,
      deactivated: true,
      onboardDate: new Date('2026-01-01'),
    });
    await new GenericEmployeeSyncService().processEmployees({
      organizationId: 'org_1',
      employees: [
        {
          email: 'ada@example.com',
          name: 'Ada',
          status: 'active',
          role: 'owner',
        },
      ],
      options: { allowReactivation: true },
    });
    expect(mockMemberUpdate).toHaveBeenCalledWith({
      where: { id: 'mem_1' },
      data: { deactivated: false, isActive: true, offboardDate: null },
    });
  });
});
