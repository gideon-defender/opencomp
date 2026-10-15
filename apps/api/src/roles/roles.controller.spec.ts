import { Test, TestingModule } from '@nestjs/testing';
import { RolesService } from './roles.service';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';

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
    listRoles: jest.fn(),
    getRole: jest.fn(),
  };

  // Mock guards that allow all requests
  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

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
});
