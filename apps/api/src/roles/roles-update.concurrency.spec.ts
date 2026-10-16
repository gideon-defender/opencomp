import { ConflictException } from '@nestjs/common';
import { db } from '@db';
import type { OrganizationRole, Prisma } from '@db';
import { RolesUpdateService } from './roles-update.service';
import type { UpdateRoleDto } from './dto/update-role.dto';

type UpdateArgs = Pick<Prisma.OrganizationRoleUpdateArgs, 'where' | 'data'>;
const mockFindFirst = jest.fn<Promise<OrganizationRole | null>, []>();
const mockUpdate = jest.fn<Promise<OrganizationRole>, [UpdateArgs]>();

jest.mock('@db', () => ({
  db: {
    organizationRole: {
      findFirst: () => mockFindFirst(),
      findMany: jest.fn(),
      update: (args: UpdateArgs) => mockUpdate(args),
    },
    member: { findMany: jest.fn() },
  },
}));

jest.mock('@gideon-defender/auth', () => ({
  allRoles: { owner: {} },
  BUILT_IN_ROLE_PERMISSIONS: {},
  BUILT_IN_ROLE_OBLIGATIONS: {},
  statement: { control: ['read', 'update'], portal: ['read', 'update'] },
}));

describe('concurrent role patches', () => {
  const service = new RolesUpdateService();
  const caller = {
    roles: null,
    apiKeyScopes: [
      'control:read',
      'control:update',
      'portal:read',
      'portal:update',
    ],
  };
  const compliancePatch: UpdateRoleDto = { obligations: { compliance: true } };
  const permissionsPatch: UpdateRoleDto = {
    permissions: { control: ['read', 'update'] },
  };

  beforeEach(() => jest.resetAllMocks());

  it.each([
    [compliancePatch, permissionsPatch],
    [permissionsPatch, compliancePatch],
  ])(
    'rejects stale writes and preserves both edits after retry: %j then %j',
    async (first, second) => {
      let stored = {
        id: 'rol_1',
        organizationId: 'org_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      let reads = 0;
      let releaseReads: () => void = () => {};
      const bothRead = new Promise<void>((resolve) => {
        releaseReads = resolve;
      });
      mockFindFirst.mockImplementation(async () => {
        const snapshot = { ...stored };
        reads += 1;
        if (reads === 2) releaseReads();
        if (reads <= 2) await bothRead;
        return snapshot;
      });
      jest.mocked(db.organizationRole.findMany).mockResolvedValue([]);
      jest.mocked(db.member.findMany).mockResolvedValue([]);
      mockUpdate.mockImplementation(async ({ where, data }) => {
        const matches = Object.entries(where).every(
          ([key, value]) => stored[key as keyof typeof stored] === value,
        );
        if (!matches) {
          throw Object.assign(new Error('Record no longer matches'), {
            code: 'P2025',
          });
        }
        stored = {
          ...stored,
          ...(typeof data.permissions === 'string'
            ? { permissions: data.permissions }
            : {}),
          ...(typeof data.obligations === 'string'
            ? { obligations: data.obligations }
            : {}),
        };
        return { ...stored };
      });

      const results = await Promise.allSettled([
        service.updateRole('org_1', 'rol_1', first, caller),
        service.updateRole('org_1', 'rol_1', second, caller),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.reason).toBeInstanceOf(ConflictException);
      const failedIndex = results.findIndex(
        (result) => result.status === 'rejected',
      );
      await service.updateRole(
        'org_1',
        'rol_1',
        failedIndex === 0 ? first : second,
        caller,
      );
      expect(JSON.parse(stored.obligations)).toEqual({ compliance: true });
      expect(JSON.parse(stored.permissions)).toEqual({
        control: ['read', 'update'],
        portal: ['read', 'update'],
      });
    },
  );
});
