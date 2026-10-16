import { ForbiddenException } from '@nestjs/common';
import { db } from '@db';
import { RolesUpdateService } from './roles-update.service';

jest.mock('@db', () => ({
  db: {
    $executeRaw: jest.fn(),
    $transaction: (work: (tx: unknown) => unknown) =>
      work(jest.requireMock('@db').db),
    organizationRole: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    member: { findMany: jest.fn() },
  },
}));

jest.mock('@gideon-defender/auth', () => {
  const permissions = {
    owner: {
      organization: ['read', 'update', 'delete'],
      control: ['read'],
      portal: ['read', 'update'],
    },
    admin: {
      organization: ['read', 'update'],
      control: ['read'],
    },
  };
  return {
    allRoles: { owner: {}, admin: {} },
    BUILT_IN_ROLE_PERMISSIONS: permissions,
    BUILT_IN_ROLE_OBLIGATIONS: {},
    statement: permissions.owner,
  };
});

describe('role update regressions', () => {
  const service = new RolesUpdateService();
  const organizationId = 'org_1';
  const role = {
    id: 'rol_1',
    organizationId,
    name: 'Strong',
    permissions: JSON.stringify({ organization: ['delete'] }),
    obligations: '{}',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const findFirst = jest.mocked(db.organizationRole.findFirst);
  const findMany = jest.mocked(db.organizationRole.findMany);
  const update = jest.mocked(db.organizationRole.update);

  beforeEach(() => {
    jest.resetAllMocks();
    findFirst.mockResolvedValue(role);
    findMany.mockResolvedValue([role]);
    jest.mocked(db.member.findMany).mockResolvedValue([]);
    update.mockResolvedValue(role);
  });

  it.each([
    { roles: ['admin'] },
    { roles: null, apiKeyScopes: ['ac:update'] },
    undefined,
  ])(
    'rejects name-only transfer above the caller grant: %j',
    async (caller) => {
      await expect(
        service.updateRole(organizationId, role.id, { name: 'Weak' }, caller),
      ).rejects.toThrow(ForbiddenException);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('permits a name-only rename when the caller holds the retained permissions', async () => {
    const renamed = { ...role, name: 'Weak' };
    findFirst.mockResolvedValueOnce(role).mockResolvedValueOnce(renamed);
    findMany.mockResolvedValueOnce([role]).mockResolvedValueOnce([renamed]);

    const result = await service.updateRole(
      organizationId,
      role.id,
      { name: 'Weak' },
      { roles: ['owner'] },
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        id: role.id,
        organizationId,
        name: role.name,
        permissions: role.permissions,
        obligations: role.obligations,
      },
      data: { name: 'Weak' },
    });
    expect(result.name).toBe('Weak');
  });

  it('permits a rename that also reduces permissions to the caller grant', async () => {
    const permissions = { organization: ['read'] };
    const renamed = {
      ...role,
      name: 'Weak',
      permissions: JSON.stringify(permissions),
    };
    findFirst.mockResolvedValueOnce(role).mockResolvedValueOnce(renamed);
    findMany.mockResolvedValueOnce([role]).mockResolvedValueOnce([renamed]);

    await service.updateRole(
      organizationId,
      role.id,
      { name: 'Weak', permissions },
      { roles: ['admin'] },
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        id: role.id,
        organizationId,
        name: role.name,
        permissions: role.permissions,
        obligations: role.obligations,
      },
      data: { name: 'Weak', permissions: JSON.stringify(permissions) },
    });
  });

  it.each(['permissions', 'obligations'] as const)(
    'persists missing portal access on a legacy compliance role via %s',
    async (field) => {
      const legacy = {
        ...role,
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: JSON.stringify({ compliance: true }),
      };
      const permissions = { control: ['read'], portal: ['read', 'update'] };
      findFirst.mockResolvedValueOnce(legacy).mockResolvedValueOnce({
        ...legacy,
        permissions: JSON.stringify(permissions),
      });

      const result = await service.updateRole(
        organizationId,
        role.id,
        field === 'permissions'
          ? { permissions }
          : { obligations: { compliance: true } },
        { roles: ['owner'] },
      );

      expect(update).toHaveBeenCalledWith({
        where: {
          id: role.id,
          organizationId,
          name: legacy.name,
          permissions: legacy.permissions,
          obligations: legacy.obligations,
        },
        data: { permissions: JSON.stringify(permissions) },
      });
      expect(result.permissions).toEqual(permissions);
    },
  );
});
