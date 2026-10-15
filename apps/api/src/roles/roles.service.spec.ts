import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RolesService } from './roles.service';

// Mock @gideon-defender/auth to avoid ESM import issues with better-auth in Jest
jest.mock('@gideon-defender/auth', () => {
  const statement = {
    organization: ['read', 'update', 'delete'],
    member: ['create', 'read', 'update', 'delete'],
    invitation: ['create', 'read', 'delete'],
    team: ['create', 'read', 'update', 'delete'],
    ac: ['create', 'read', 'update', 'delete'],
    control: ['create', 'read', 'update', 'delete'],
    evidence: ['create', 'read', 'update', 'delete'],
    policy: ['create', 'read', 'update', 'delete'],
    risk: ['create', 'read', 'update', 'delete'],
    vendor: ['create', 'read', 'update', 'delete'],
    task: ['create', 'read', 'update', 'delete'],
    framework: ['create', 'read', 'update', 'delete'],
    audit: ['create', 'read', 'update'],
    finding: ['create', 'read', 'update', 'delete'],
    questionnaire: ['create', 'read', 'update', 'delete'],
    integration: ['create', 'read', 'update', 'delete'],
    apiKey: ['create', 'read', 'delete'],
    app: ['read'],
    trust: ['read', 'update'],
    portal: ['read', 'update'],
  };

  const BUILT_IN_ROLE_PERMISSIONS: Record<string, Record<string, string[]>> = {
    owner: {
      ...Object.fromEntries(
        Object.entries(statement).map(([k, v]) => [k, [...v]]),
      ),
    },
    admin: {
      ...Object.fromEntries(
        Object.entries(statement).map(([k, v]) => [k, [...v]]),
      ),
      organization: ['read', 'update'],
    },
    auditor: {
      organization: ['read'],
      member: ['create', 'read'],
      invitation: ['create', 'read'],
      control: ['read'],
      evidence: ['read'],
      policy: ['read'],
      risk: ['read'],
      vendor: ['read'],
      task: ['read'],
      framework: ['read'],
      audit: ['read'],
      finding: ['create', 'read', 'update'],
      questionnaire: ['read'],
      integration: ['read'],
      app: ['read'],
      trust: ['read'],
    },
    employee: { policy: ['read'] },
    contractor: { policy: ['read'] },
  };

  const allRoles = {
    owner: { statements: BUILT_IN_ROLE_PERMISSIONS.owner },
    admin: { statements: BUILT_IN_ROLE_PERMISSIONS.admin },
    auditor: { statements: BUILT_IN_ROLE_PERMISSIONS.auditor },
    employee: { statements: BUILT_IN_ROLE_PERMISSIONS.employee },
    contractor: { statements: BUILT_IN_ROLE_PERMISSIONS.contractor },
  };

  const BUILT_IN_ROLE_OBLIGATIONS: Record<string, Record<string, boolean>> = {
    owner: { compliance: true },
    admin: {},
    auditor: {},
    employee: { compliance: true },
    contractor: { compliance: true },
  };

  return {
    statement,
    allRoles,
    BUILT_IN_ROLE_PERMISSIONS,
    BUILT_IN_ROLE_OBLIGATIONS,
  };
});

// Mock the database
jest.mock('@db', () => ({
  db: {
    organizationRole: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    member: {
      count: jest.fn(),
    },
  },
}));

import { db } from '@db';

describe('RolesService', () => {
  let service: RolesService;
  const mockDb = db as jest.Mocked<typeof db>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesService],
    }).compile();

    service = module.get<RolesService>(RolesService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('listRoles', () => {
    it('should return both built-in and custom roles', async () => {
      const customRoles = [
        {
          id: 'rol_1',
          name: 'custom-role-1',
          permissions: JSON.stringify({ control: ['read'] }),
          obligations: '{}',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue(
        customRoles,
      );

      const result = await service.listRoles('org_123');

      expect(result.builtInRoles).toHaveLength(5); // owner, admin, auditor, employee, contractor
      expect(result.builtInRoles.map((r) => r.name)).toEqual([
        'owner',
        'admin',
        'auditor',
        'employee',
        'contractor',
      ]);
      expect(result.customRoles).toHaveLength(1);
      expect(result.customRoles[0].isBuiltIn).toBe(false);
    });
  });

  describe('getRole', () => {
    it('should return a role by ID', async () => {
      const mockRole = {
        id: 'rol_123',
        name: 'custom-role',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        mockRole,
      );

      const result = await service.getRole('org_123', 'rol_123');

      expect(result.id).toBe('rol_123');
      expect(result.isBuiltIn).toBe(false);
    });

    it('should throw NotFoundException for non-existent role', async () => {
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getRole('org_123', 'rol_nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('filterMembersWithPermission', () => {
    const organizationId = 'org_1';

    it('returns empty array when members list is empty', async () => {
      const result = await service.filterMembersWithPermission(
        organizationId,
        [],
        'task',
        'update',
      );
      expect(result).toEqual([]);
      expect(mockDb.organizationRole.findMany).not.toHaveBeenCalled();
    });

    it('keeps built-in roles that grant the permission (owner has task:update)', async () => {
      const members = [
        { id: 'm1', role: 'owner' },
        { id: 'm2', role: 'admin' },
      ];
      const result = await service.filterMembersWithPermission(
        organizationId,
        members,
        'task',
        'update',
      );
      expect(result.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
    });

    it('excludes built-in roles that lack the permission (employee has no task perms)', async () => {
      const members = [
        { id: 'm1', role: 'employee' },
        { id: 'm2', role: 'contractor' },
        { id: 'm3', role: 'owner' },
      ];
      const result = await service.filterMembersWithPermission(
        organizationId,
        members,
        'task',
        'update',
      );
      expect(result.map((m) => m.id)).toEqual(['m3']);
    });

    it('excludes auditor for task:update but keeps them for task:read', async () => {
      const members = [{ id: 'm1', role: 'auditor' }];

      const forUpdate = await service.filterMembersWithPermission(
        organizationId,
        members,
        'task',
        'update',
      );
      expect(forUpdate).toEqual([]);

      const forRead = await service.filterMembersWithPermission(
        organizationId,
        members,
        'task',
        'read',
      );
      expect(forRead.map((m) => m.id)).toEqual(['m1']);
    });

    it('treats comma-separated roles as a union (employee,admin gets included)', async () => {
      const members = [{ id: 'm1', role: 'employee,admin' }];
      const result = await service.filterMembersWithPermission(
        organizationId,
        members,
        'task',
        'update',
      );
      expect(result.map((m) => m.id)).toEqual(['m1']);
    });

    it('includes a member whose custom role grants the permission', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        {
          name: 'compliance-lead',
          permissions: JSON.stringify({
            task: ['read', 'update'],
            app: ['read'],
          }),
        },
      ]);
      const members = [{ id: 'm1', role: 'compliance-lead' }];
      const result = await service.filterMembersWithPermission(
        organizationId,
        members,
        'task',
        'update',
      );
      expect(result.map((m) => m.id)).toEqual(['m1']);
      expect(mockDb.organizationRole.findMany).toHaveBeenCalledTimes(1);
    });

    it('excludes a member whose custom role lacks the permission', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        {
          name: 'readonly',
          permissions: JSON.stringify({ task: ['read'] }),
        },
      ]);
      const members = [{ id: 'm1', role: 'readonly' }];
      const result = await service.filterMembersWithPermission(
        organizationId,
        members,
        'task',
        'update',
      );
      expect(result).toEqual([]);
    });

    it('excludes members with null, empty, or unknown roles', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      const members = [
        { id: 'm1', role: null },
        { id: 'm2', role: '' },
        { id: 'm3', role: 'nonexistent-role' },
      ];
      const result = await service.filterMembersWithPermission(
        organizationId,
        members,
        'task',
        'update',
      );
      expect(result).toEqual([]);
    });

    it('makes exactly one DB query regardless of member count', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        {
          name: 'custom-a',
          permissions: JSON.stringify({ task: ['update'] }),
        },
      ]);
      const members = Array.from({ length: 25 }, (_, i) => ({
        id: `m${i}`,
        role: i % 2 === 0 ? 'custom-a' : 'employee',
      }));
      const result = await service.filterMembersWithPermission(
        organizationId,
        members,
        'task',
        'update',
      );
      expect(result.length).toBe(13); // 0,2,4,...,24 → 13 members
      expect(mockDb.organizationRole.findMany).toHaveBeenCalledTimes(1);
    });

    it('skips the DB query when all roles are built-in', async () => {
      const members = [
        { id: 'm1', role: 'owner' },
        { id: 'm2', role: 'admin,auditor' },
        { id: 'm3', role: 'employee' },
      ];
      await service.filterMembersWithPermission(
        organizationId,
        members,
        'app',
        'read',
      );
      expect(mockDb.organizationRole.findMany).not.toHaveBeenCalled();
    });

    it('parses permissions that are already objects (not strings)', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        {
          name: 'object-role',
          permissions: { task: ['update'] },
        },
      ]);
      const members = [{ id: 'm1', role: 'object-role' }];
      const result = await service.filterMembersWithPermission(
        organizationId,
        members,
        'task',
        'update',
      );
      expect(result.map((m) => m.id)).toEqual(['m1']);
    });

    it('trims whitespace around comma-separated role names', async () => {
      const members = [{ id: 'm1', role: 'employee ,  admin' }];
      const result = await service.filterMembersWithPermission(
        organizationId,
        members,
        'task',
        'update',
      );
      expect(result.map((m) => m.id)).toEqual(['m1']);
    });
  });

  describe('getBuiltInObligations', () => {
    const organizationId = 'org_1';

    it('returns the hardcoded default when no override row exists', async () => {
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.getBuiltInObligations(
        organizationId,
        'owner',
      );
      expect(result).toEqual({ compliance: true });
    });

    it('returns the DB override when one exists (string JSON)', async () => {
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue({
        obligations: JSON.stringify({ compliance: false }),
      });
      const result = await service.getBuiltInObligations(
        organizationId,
        'owner',
      );
      expect(result).toEqual({ compliance: false });
    });

    it('returns the DB override when one exists (object JSON)', async () => {
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue({
        obligations: { compliance: false },
      });
      const result = await service.getBuiltInObligations(
        organizationId,
        'owner',
      );
      expect(result).toEqual({ compliance: false });
    });

    it('returns empty for admin (no default compliance, no override)', async () => {
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.getBuiltInObligations(
        organizationId,
        'admin',
      );
      expect(result).toEqual({});
    });

    it('rejects unknown role names', async () => {
      await expect(
        service.getBuiltInObligations(organizationId, 'not-a-built-in'),
      ).rejects.toThrow(BadRequestException);
    });

    it('falls back to built-in default when override row exists but has no compliance key', async () => {
      // Override row with `{}` should be treated as "no override on compliance"
      // — UI must show the built-in default to match what enforcement does.
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue({
        obligations: '{}',
      });
      const result = await service.getBuiltInObligations(
        organizationId,
        'owner',
      );
      expect(result).toEqual({ compliance: true });
    });
  });

  describe('getObligationsForRoles with built-in overrides', () => {
    const organizationId = 'org_1';

    it('returns hardcoded defaults when no DB rows match', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getObligationsForRoles(organizationId, [
        'owner',
        'admin',
      ]);
      // owner has compliance:true by default, admin has none — union is true
      expect(result).toEqual({ compliance: true });
    });

    it('DB override beats the hardcoded default (owner override → no compliance)', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        { name: 'owner', obligations: JSON.stringify({ compliance: false }) },
      ]);
      const result = await service.getObligationsForRoles(organizationId, [
        'owner',
      ]);
      expect(result).toEqual({});
    });

    it('admin override can opt INTO compliance even though default is none', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        { name: 'admin', obligations: JSON.stringify({ compliance: true }) },
      ]);
      const result = await service.getObligationsForRoles(organizationId, [
        'admin',
      ]);
      expect(result).toEqual({ compliance: true });
    });

    it('falls back to built-in default when override JSON has no compliance key', async () => {
      // A row with `{}` should not silently disable the owner default.
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        { name: 'owner', obligations: '{}' },
      ]);
      const result = await service.getObligationsForRoles(organizationId, [
        'owner',
      ]);
      expect(result).toEqual({ compliance: true });
    });
  });

  describe('listRoles built-in overrides', () => {
    const organizationId = 'org_1';

    it('hides override rows from customRoles and reflects them on builtInRoles', async () => {
      const ownerOverride = {
        id: 'rol_owner_override',
        name: 'owner',
        permissions: '{}',
        obligations: JSON.stringify({ compliance: false }),
        organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const customRole = {
        id: 'rol_custom_1',
        name: 'compliance-lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        ownerOverride,
        customRole,
      ]);
      (mockDb.member.count as jest.Mock).mockResolvedValue(0);

      const result = await service.listRoles(organizationId);
      // Override row must not appear as a custom role
      expect(result.customRoles.map((r) => r.name)).toEqual([
        'compliance-lead',
      ]);
      // Built-in entries carry effective obligations — owner reflects the override
      const ownerEntry = result.builtInRoles.find((r) => r.name === 'owner');
      expect(ownerEntry?.obligations).toEqual({ compliance: false });
      // Other built-ins still show their hardcoded defaults
      const adminEntry = result.builtInRoles.find((r) => r.name === 'admin');
      expect(adminEntry?.obligations).toEqual({});
      const employeeEntry = result.builtInRoles.find(
        (r) => r.name === 'employee',
      );
      expect(employeeEntry?.obligations).toEqual({ compliance: true });
    });

    it('shows the built-in default when override row exists with no compliance key', async () => {
      // Override row with `{}` should not silently flip the built-in entry off.
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'rol_owner_override',
          name: 'owner',
          permissions: '{}',
          obligations: '{}',
          organizationId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      (mockDb.member.count as jest.Mock).mockResolvedValue(0);

      const result = await service.listRoles(organizationId);
      const ownerEntry = result.builtInRoles.find((r) => r.name === 'owner');
      expect(ownerEntry?.obligations).toEqual({ compliance: true });
    });
  });
});
