import { ForbiddenException } from '@nestjs/common';
import { RolesUpdateService } from './roles-update.service';
import { RolesWriteService } from './roles-write.service';

const mockGlobalFindMany = jest.fn();
const mockTx = {
  $executeRaw: jest.fn(),
  organizationRole: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  member: { findMany: jest.fn() },
};

jest.mock('@db', () => ({
  db: {
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work(mockTx),
    organizationRole: {
      findMany: (...args: unknown[]) => mockGlobalFindMany(...args),
    },
  },
}));
jest.mock('@gideon-defender/auth', () => ({
  allRoles: { owner: {} },
  BUILT_IN_ROLE_PERMISSIONS: { owner: {} },
  BUILT_IN_ROLE_OBLIGATIONS: {},
  statement: { control: ['read', 'update'] },
}));

const role = {
  id: 'rol_1',
  organizationId: 'org_1',
  name: 'Lead',
  permissions: '{"control":["read"]}',
  obligations: '{}',
  createdAt: new Date('2026-10-16'),
  updatedAt: new Date('2026-10-16'),
};
const caller = { roles: ['Delegated Manager'] };

describe('role grant checks inside definition transactions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockGlobalFindMany.mockRejectedValue(new Error('No free pool connection'));
    mockTx.organizationRole.findMany.mockResolvedValue([role]);
    mockTx.organizationRole.findFirst.mockResolvedValue(role);
    mockTx.organizationRole.create.mockResolvedValue(role);
    mockTx.organizationRole.update.mockResolvedValue(role);
    mockTx.member.findMany.mockResolvedValue([]);
  });

  it('creates a role for a custom-role caller without a second connection', async () => {
    const created = await new RolesWriteService().createRole(
      'org_1',
      { name: 'New Lead', permissions: { control: ['read'] } },
      caller,
    );

    expect(created.id).toBe(role.id);
    expect(mockTx.organizationRole.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'New Lead',
        organizationId: 'org_1',
        permissions: role.permissions,
      }),
    });
    expect(mockTx.organizationRole.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', name: { in: caller.roles } },
      select: { permissions: true },
    });
    expect(mockGlobalFindMany).not.toHaveBeenCalled();
  });

  it('renames a role for a custom-role caller without a second connection', async () => {
    await new RolesUpdateService().updateRole(
      'org_1',
      role.id,
      { name: 'Senior Lead' },
      caller,
    );

    expect(mockTx.organizationRole.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Senior Lead' } }),
    );
    expect(mockGlobalFindMany).not.toHaveBeenCalled();
  });

  it.each(['create', 'rename'])(
    'still denies permissions absent from the transaction grant lookup on %s',
    async (operation) => {
      mockTx.organizationRole.findMany.mockResolvedValue([
        { ...role, permissions: '{}' },
      ]);
      const write =
        operation === 'create'
          ? new RolesWriteService().createRole(
              'org_1',
              { name: 'New Lead', permissions: { control: ['read'] } },
              caller,
            )
          : new RolesUpdateService().updateRole(
              'org_1',
              role.id,
              { name: 'Senior Lead' },
              caller,
            );

      await expect(write).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockTx.organizationRole.create).not.toHaveBeenCalled();
      expect(mockTx.organizationRole.update).not.toHaveBeenCalled();
      expect(mockGlobalFindMany).not.toHaveBeenCalled();
    },
  );
});
