import { Test, TestingModule } from '@nestjs/testing';
import { GoneException } from '@nestjs/common';
import { RolesService } from './roles.service';
import type { AuthContext } from '../auth/types';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PERMISSIONS_KEY, PermissionGuard } from '../auth/permission.guard';

import { RolesController } from './roles.controller';

// Mock @gideon-defender/auth and auth.server to avoid importing better-auth ESM in Jest
jest.mock('@gideon-defender/auth', () => ({
  statement: {},
  allRoles: { owner: {}, admin: {}, auditor: {}, employee: {}, contractor: {} },
  BUILT_IN_ROLE_PERMISSIONS: {},
  RESTRICTED_ROLES: ['employee', 'contractor'],
  PRIVILEGED_ROLES: ['owner', 'admin', 'auditor'],
}));

jest.mock('../auth/auth.server', () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
}));

describe('RolesController', () => {
  let controller: RolesController;
  let rolesService: jest.Mocked<RolesService>;

  const mockRolesService = {
    createRole: jest.fn(),
    listRoles: jest.fn(),
    getRole: jest.fn(),
    updateRole: jest.fn(),
    deleteRole: jest.fn(),
    updateBuiltInObligations: jest.fn(),
  };

  // Mock guards that allow all requests
  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  const mockAuthContext: AuthContext = {
    organizationId: 'org_123',
    authType: 'session',
    isApiKey: false,
    userId: 'usr_123',
    userEmail: 'test@example.com',
    userRoles: ['owner'],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [{ provide: RolesService, useValue: mockRolesService }],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(PermissionGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<RolesController>(RolesController);
    rolesService = module.get(RolesService);

    jest.clearAllMocks();
  });

  describe('createRole', () => {
    it('returns 410 without creating (IdP owns roles)', async () => {
      await expect(
        controller.createRole('org_123', mockAuthContext, {
          name: 'custom-role',
          permissions: { control: ['read'] },
        }),
      ).rejects.toThrow(GoneException);
      expect(mockRolesService.createRole).not.toHaveBeenCalled();
    });

    it('keeps @RequirePermission(ac, create) so 401/403 still precede the 410', () => {
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          RolesController.prototype.createRole,
        ),
      ).toEqual([{ resource: 'ac', actions: ['create'] }]);
    });
  });

  describe('listRoles', () => {
    it('should return list of roles', async () => {
      const expectedResult = {
        builtInRoles: [
          { name: 'owner', isBuiltIn: true, description: 'Full access' },
        ],
        customRoles: [{ id: 'rol_123', name: 'custom', isBuiltIn: false }],
      };

      mockRolesService.listRoles.mockResolvedValue(expectedResult);

      const result = await controller.listRoles('org_123');

      expect(result).toEqual(expectedResult);
      expect(rolesService.listRoles).toHaveBeenCalledWith('org_123');
    });
  });

  describe('getRole', () => {
    it('should return a single role', async () => {
      const expectedRole = {
        id: 'rol_123',
        name: 'custom-role',
        permissions: { control: ['read'] },
        isBuiltIn: false,
      };

      mockRolesService.getRole.mockResolvedValue(expectedRole);

      const result = await controller.getRole('org_123', 'rol_123');

      expect(result).toEqual(expectedRole);
      expect(rolesService.getRole).toHaveBeenCalledWith('org_123', 'rol_123');
    });
  });

  describe('updateRole', () => {
    it('returns 410 without updating (IdP owns roles)', async () => {
      await expect(
        controller.updateRole('org_123', mockAuthContext, 'rol_123', {
          name: 'updated-name',
        }),
      ).rejects.toThrow(GoneException);
      expect(mockRolesService.updateRole).not.toHaveBeenCalled();
    });
  });

  describe('deleteRole', () => {
    it('returns 410 without deleting (IdP owns roles)', async () => {
      await expect(controller.deleteRole('org_123', 'rol_123')).rejects.toThrow(
        GoneException,
      );
      expect(mockRolesService.deleteRole).not.toHaveBeenCalled();
    });
  });

  describe('updateBuiltInObligations', () => {
    it('returns 410 without updating (obligations ship as code)', async () => {
      await expect(
        controller.updateBuiltInObligations('org_123', 'owner', {
          obligations: {},
        }),
      ).rejects.toThrow(GoneException);
      expect(mockRolesService.updateBuiltInObligations).not.toHaveBeenCalled();
    });
  });
});
