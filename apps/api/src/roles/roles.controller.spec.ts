import { Test, TestingModule } from '@nestjs/testing';
import { RolesService } from './roles.service';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard, PERMISSIONS_KEY } from '../auth/permission.guard';

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
    createRole: jest.fn(),
    updateRole: jest.fn(),
    deleteRole: jest.fn(),
    getPermissionsForRoles: jest.fn(),
    getObligationsForRoles: jest.fn(),
    getBuiltInObligations: jest.fn(),
    setBuiltInObligations: jest.fn(),
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

  describe('getPermissionsForRoles', () => {
    it('accepts array query values and resolves in parallel', async () => {
      mockRolesService.getPermissionsForRoles.mockResolvedValue({
        control: ['read'],
      });
      mockRolesService.getObligationsForRoles.mockResolvedValue({});

      const result = await controller.getPermissionsForRoles('org_1', [
        'admin',
        'Lead',
      ] as never);

      expect(result.permissions).toEqual({ control: ['read'] });
      expect(mockRolesService.getPermissionsForRoles).toHaveBeenCalledWith(
        'org_1',
        ['admin', 'Lead'],
      );
    });
  });

  describe('setBuiltInObligations', () => {
    it('passes org, name, obligations, and grant caller through', async () => {
      mockRolesService.setBuiltInObligations.mockResolvedValue({
        name: 'admin',
        obligations: { compliance: true },
      });
      const auth = {
        organizationId: 'org_1',
        authType: 'session',
        isApiKey: false,
        userRoles: ['owner'],
      } as never;
      const result = await controller.setBuiltInObligations(
        'org_1',
        'admin',
        { obligations: { compliance: true } },
        auth,
      );
      expect(result).toEqual({
        name: 'admin',
        obligations: { compliance: true },
      });
      expect(mockRolesService.setBuiltInObligations).toHaveBeenCalledWith(
        'org_1',
        'admin',
        { compliance: true },
        expect.objectContaining({ roles: ['owner'] }),
      );
    });
  });

  describe('getPermissionsForRoles limits', () => {
    it('rejects more than 100 role names instead of truncating', async () => {
      const many = Array.from({ length: 101 }, (_, i) => `role${i}`).join(',');
      await expect(
        controller.getPermissionsForRoles('org_1', many as never),
      ).rejects.toThrow('max 100');
      expect(mockRolesService.getPermissionsForRoles).not.toHaveBeenCalled();
    });

    it('rejects oversized role query strings before resolving', async () => {
      await expect(
        controller.getPermissionsForRoles('org_1', 'x'.repeat(5001) as never),
      ).rejects.toThrow('Too many roles requested');
      expect(mockRolesService.getPermissionsForRoles).not.toHaveBeenCalled();
      expect(mockRolesService.getObligationsForRoles).not.toHaveBeenCalled();
    });
  });

  describe('updateRole grant caller', () => {
    it('maps API-key scopes into the update grant check', async () => {
      mockRolesService.updateRole.mockResolvedValue({ id: 'rol_1' });
      const apiKeyAuth = {
        organizationId: 'org_1',
        authType: 'api-key',
        isApiKey: true,
        userRoles: null,
        apiKeyScopes: ['ac:update', 'control:read'],
      } as never;
      await controller.updateRole(
        'org_1',
        'rol_1',
        { permissions: { control: ['read'] } },
        apiKeyAuth,
      );
      expect(mockRolesService.updateRole).toHaveBeenCalledWith(
        'org_1',
        'rol_1',
        expect.objectContaining({ permissions: { control: ['read'] } }),
        expect.objectContaining({
          roles: null,
          apiKeyScopes: ['ac:update', 'control:read'],
        }),
      );
    });
  });

  describe('RBAC - permission decorators', () => {
    it.each([
      ['listRoles', 'ac', 'read'],
      ['getPermissionsForRoles', 'app', 'read'],
      ['getBuiltInObligations', 'ac', 'read'],
      ['setBuiltInObligations', 'ac', 'update'],
      ['getRole', 'ac', 'read'],
      ['createRole', 'ac', 'create'],
      ['updateRole', 'ac', 'update'],
      ['deleteRole', 'ac', 'delete'],
    ])('%s should require %s:%s', (method, resource, action) => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller[method as keyof RolesController],
      );
      expect(permissions).toEqual([{ resource, actions: [action] }]);
    });
  });

  describe('writers', () => {
    const auth = {
      organizationId: 'org_1',
      authType: 'session',
      isApiKey: false,
      userRoles: ['admin'],
    } as never;

    it('maps API-key scopes and service names into the grant caller', async () => {
      mockRolesService.createRole.mockResolvedValue({ id: 'rol_new' });
      const apiKeyAuth = {
        organizationId: 'org_1',
        authType: 'api-key',
        isApiKey: true,
        userRoles: null,
        apiKeyScopes: ['ac:create', 'control:read'],
      } as never;
      await controller.createRole(
        'org_1',
        { name: 'Lead', permissions: { control: ['read'] } },
        apiKeyAuth,
      );
      expect(mockRolesService.createRole).toHaveBeenCalledWith(
        'org_1',
        expect.objectContaining({ name: 'Lead' }),
        expect.objectContaining({
          roles: null,
          apiKeyScopes: ['ac:create', 'control:read'],
        }),
      );
    });

    it('passes create/update/delete through with org scoping', async () => {
      mockRolesService.createRole.mockResolvedValue({ id: 'rol_new' });
      mockRolesService.updateRole.mockResolvedValue({ id: 'rol_1' });
      mockRolesService.deleteRole.mockResolvedValue({
        id: 'rol_1',
        deleted: true,
      });

      await controller.createRole(
        'org_1',
        {
          name: 'Lead',
          permissions: { control: ['read'] },
        },
        auth,
      );
      expect(rolesService.createRole).toHaveBeenCalledWith(
        'org_1',
        expect.objectContaining({ name: 'Lead' }),
        expect.objectContaining({ roles: ['admin'] }),
      );
      await controller.updateRole(
        'org_1',
        'rol_1',
        { name: 'Senior Lead' },
        auth,
      );
      expect(rolesService.updateRole).toHaveBeenCalledWith(
        'org_1',
        'rol_1',
        expect.objectContaining({ name: 'Senior Lead' }),
        expect.objectContaining({ roles: ['admin'] }),
      );
      await controller.deleteRole('org_1', 'rol_1');
      expect(rolesService.deleteRole).toHaveBeenCalledWith('org_1', 'rol_1');
    });
  });
});
