import { ConflictException, NotFoundException } from '@nestjs/common';
import type { OrganizationRole, Prisma } from '@db';
import { RolesUpdateService } from './roles-update.service';
import { RolesWriteService } from './roles-write.service';

type UpdateArgs = Pick<Prisma.OrganizationRoleUpdateArgs, 'where' | 'data'>;
type DeleteArgs = Pick<Prisma.OrganizationRoleDeleteArgs, 'where'>;
const mockFindFirst = jest.fn<Promise<OrganizationRole | null>, []>();
const mockFindMany = jest.fn<Promise<OrganizationRole[]>, []>();
const mockUpdate = jest.fn<Promise<OrganizationRole>, [UpdateArgs]>();
const mockDelete = jest.fn<Promise<OrganizationRole>, [DeleteArgs]>();
const mockMembers = jest.fn<Promise<Array<{ id: string; role: string }>>, []>();

jest.mock('@db', () => ({
  db: {
    $executeRaw: jest.fn(),
    $transaction: (work: (tx: unknown) => unknown) =>
      work(jest.requireMock('@db').db),
    organizationRole: {
      findFirst: () => mockFindFirst(),
      findMany: () => mockFindMany(),
      update: (args: UpdateArgs) => mockUpdate(args),
      delete: (args: DeleteArgs) => mockDelete(args),
    },
    member: { findMany: () => mockMembers() },
  },
}));
jest.mock('@gideon-defender/auth', () => ({
  allRoles: { owner: {} },
  BUILT_IN_ROLE_PERMISSIONS: {},
  BUILT_IN_ROLE_OBLIGATIONS: {},
  statement: { control: ['read', 'update'], portal: ['read', 'update'] },
}));

const roles = {
  findFirst: mockFindFirst,
  findMany: mockFindMany,
  update: mockUpdate,
  delete: mockDelete,
};
const members = { findMany: mockMembers };
const original: OrganizationRole = {
  id: 'rol_1',
  organizationId: 'org_1',
  name: 'Lead',
  permissions: '{"control":["read","update"]}',
  obligations: '{}',
  createdAt: new Date('2026-10-16'),
  updatedAt: new Date('2026-10-16'),
};
const caller = {
  roles: null,
  apiKeyScopes: ['control:read', 'control:update'],
};

describe('role rollback and delete concurrency', () => {
  let stored: OrganizationRole;

  beforeEach(() => {
    jest.resetAllMocks();
    stored = { ...original };
    roles.findFirst.mockImplementation(async () => ({ ...stored }));
    roles.findMany.mockResolvedValue([]);
    members.findMany.mockResolvedValue([]);
    roles.update.mockImplementation(async ({ where, data }) => {
      const matches = Object.entries(where).every(
        ([key, value]) => stored[key as keyof OrganizationRole] === value,
      );
      if (!matches)
        throw Object.assign(new Error('Stale role'), { code: 'P2025' });
      stored = {
        ...stored,
        ...(typeof data.name === 'string' ? { name: data.name } : {}),
        ...(typeof data.permissions === 'string'
          ? { permissions: data.permissions }
          : {}),
        ...(typeof data.obligations === 'string'
          ? { obligations: data.obligations }
          : {}),
      };
      return { ...stored };
    });
  });

  it('does not undo a permission revocation after a rename collision', async () => {
    roles.findMany
      .mockResolvedValueOnce([original])
      .mockImplementationOnce(async () => {
        // The rename is visible; another PATCH now revokes control:update.
        stored = { ...stored, permissions: '{"control":["read"]}' };
        return [stored, { ...original, id: 'rol_2', name: 'senior lead' }];
      });

    await expect(
      new RolesUpdateService().updateRole(
        'org_1',
        'rol_1',
        { name: 'Senior Lead' },
        caller,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(stored.permissions).toBe('{"control":["read"]}');
    expect(roles.update).toHaveBeenCalledTimes(2);
  });

  it('still restores the previous state when no PATCH intervenes', async () => {
    roles.findMany
      .mockResolvedValueOnce([original])
      .mockImplementationOnce(async () => [
        stored,
        { ...original, id: 'rol_2', name: 'senior lead' },
      ]);

    await expect(
      new RolesUpdateService().updateRole(
        'org_1',
        'rol_1',
        { name: 'Senior Lead', permissions: { control: ['read'] } },
        caller,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(stored).toEqual(original);
  });

  it('rejects DELETE if a rename binds the role to existing assignments', async () => {
    members.findMany.mockImplementationOnce(async () => {
      stored = { ...stored, name: 'Assigned Lead' };
      return [{ id: 'mem_1', role: 'Assigned Lead' }];
    });
    let deleted = false;
    roles.delete.mockImplementation(async ({ where }) => {
      const matches = Object.entries(where).every(
        ([key, value]) => stored[key as keyof OrganizationRole] === value,
      );
      if (!matches)
        throw Object.assign(new Error('Stale role'), { code: 'P2025' });
      deleted = true;
      return stored;
    });

    await expect(
      new RolesWriteService().deleteRole('org_1', 'rol_1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(deleted).toBe(false);
    expect(stored.name).toBe('Assigned Lead');
  });

  it('still returns 404 when another request already deleted the role', async () => {
    roles.findFirst.mockResolvedValueOnce(original).mockResolvedValueOnce(null);
    roles.delete.mockRejectedValue(
      Object.assign(new Error('Deleted'), { code: 'P2025' }),
    );

    await expect(
      new RolesWriteService().deleteRole('org_1', 'rol_1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
