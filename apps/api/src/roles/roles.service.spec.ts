import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { RolesReadService } from './roles-read.service';
import { RolesResolutionService } from './roles-resolution.service';
import { RolesUpdateService } from './roles-update.service';
import { RolesWriteService } from './roles-write.service';

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
    $executeRaw: jest.fn(),
    $transaction: (work: (tx: unknown) => unknown) =>
      work(jest.requireMock('@db').db),
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
      findMany: jest.fn(),
    },
  },
}));

import { db } from '@db';

describe('RolesService', () => {
  let service: RolesService;
  const mockDb = db as jest.Mocked<typeof db>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        RolesReadService,
        RolesResolutionService,
        RolesUpdateService,
        RolesWriteService,
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);

    // Reset all mocks
    jest.resetAllMocks();
    (mockDb.member.findMany as jest.Mock).mockResolvedValue([]);
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

    it('hides built-in override rows (matches listRoles)', async () => {
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue({
        id: 'rol_override',
        name: 'admin',
        permissions: '{}',
        obligations: '{}',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await expect(service.getRole('org_1', 'rol_override')).rejects.toThrow(
        NotFoundException,
      );
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
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([]);

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
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listRoles(organizationId);
      const ownerEntry = result.builtInRoles.find((r) => r.name === 'owner');
      expect(ownerEntry?.obligations).toEqual({ compliance: true });
    });
  });

  describe('exact holder counting', () => {
    const exactOrgId = 'org_1';

    it('does not count substring matches (Lead vs Compliance Lead)', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'rol_lead',
          name: 'Lead',
          permissions: JSON.stringify({ control: ['read'] }),
          obligations: '{}',
          organizationId: exactOrgId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'rol_compliance',
          name: 'Compliance Lead',
          permissions: JSON.stringify({ control: ['read'] }),
          obligations: '{}',
          organizationId: exactOrgId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([
        { role: 'Lead' },
        { role: 'Compliance Lead' },
        { role: 'Lead, admin' },
        { role: 'admin' },
        { role: null },
      ]);

      const result = await service.listRoles(exactOrgId);
      const byName = new Map(result.customRoles.map((r) => [r.name, r]));
      expect(byName.get('Lead')?._count.members).toBe(2);
      expect(byName.get('Compliance Lead')?._count.members).toBe(1);
      // One member query total — no per-role count fan-out.
      expect(mockDb.member.findMany).toHaveBeenCalledTimes(1);
    });

    it('counts a single role exactly on getRole', async () => {
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue({
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([
        { role: 'Lead' },
        { role: 'Compliance Lead' },
        { role: 'Lead,admin' },
      ]);

      const result = await service.getRole('org_1', 'rol_1');
      expect(result._count.members).toBe(2);
    });
  });

  describe('createRole', () => {
    const orgId = 'org_1';

    it('creates with trimmed exact-case name', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      const created = {
        id: 'rol_new',
        name: 'Compliance Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.create as jest.Mock).mockResolvedValue(created);
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        created,
      );
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.createRole(
        orgId,
        {
          name: 'Compliance Lead',
          permissions: { control: ['read'] },
        },
        { roles: ['owner'] },
      );
      expect(result.name).toBe('Compliance Lead');
      expect(mockDb.organizationRole.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Compliance Lead',
          organizationId: orgId,
        }),
      });
    });

    it('409 on exact duplicate and on case-only duplicate', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        { name: 'Lead' },
      ]);
      await expect(
        service.createRole(
          orgId,
          {
            name: 'Lead',
            permissions: { control: ['read'] },
          },
          { roles: ['owner'] },
        ),
      ).rejects.toThrow('already exists');
      await expect(
        service.createRole(
          orgId,
          {
            name: 'lead',
            permissions: { control: ['read'] },
          },
          { roles: ['owner'] },
        ),
      ).rejects.toThrow('differs only by case');
    });

    it('rejects built-in names (exact and case variants)', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      await expect(
        service.createRole(orgId, {
          name: 'admin',
          permissions: { control: ['read'] },
        }),
      ).rejects.toThrow('built-in role');
      await expect(
        service.createRole(orgId, {
          name: 'Admin',
          permissions: { control: ['read'] },
        }),
      ).rejects.toThrow('built-in role');
    });

    it('maps P2002 to 409 (race-safe)', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.organizationRole.create as jest.Mock).mockRejectedValue({
        code: 'P2002',
      });
      await expect(
        service.createRole(
          orgId,
          {
            name: 'Fresh',
            permissions: { control: ['read'] },
          },
          { roles: ['owner'] },
        ),
      ).rejects.toThrow('already exists');
    });

    it('denies granting permissions the caller does not hold', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      // Mock admin holds organization read/update only — not delete.
      await expect(
        service.createRole(
          orgId,
          {
            name: 'Escalated',
            permissions: { organization: ['delete'] },
          },
          { roles: ['admin'] },
        ),
      ).rejects.toThrow('does not hold it');
      expect(mockDb.organizationRole.create).not.toHaveBeenCalled();
    });

    it('allows granting permissions the caller holds', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      const created = {
        id: 'rol_new',
        name: 'Reader',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.create as jest.Mock).mockResolvedValue(created);
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        created,
      );
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.createRole(
        orgId,
        { name: 'Reader', permissions: { control: ['read'] } },
        { roles: ['admin'] },
      );
      expect(result.name).toBe('Reader');
    });

    it('enforces the grant check against API-key scopes', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      await expect(
        service.createRole(
          orgId,
          {
            name: 'Escalated',
            permissions: { organization: ['delete'] },
          },
          { roles: null, apiKeyScopes: ['ac:create', 'control:read'] },
        ),
      ).rejects.toThrow('does not hold it');
      // Legacy full-access keys (empty scopes) keep full access.
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      const created = {
        id: 'rol_new',
        name: 'Scoped',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.create as jest.Mock).mockResolvedValue(created);
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        created,
      );
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([]);
      await expect(
        service.createRole(
          orgId,
          { name: 'Scoped', permissions: { control: ['read'] } },
          { roles: null, apiKeyScopes: [] },
        ),
      ).resolves.toMatchObject({ name: 'Scoped' });
    });

    it('denies grants when caller context is missing', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      await expect(
        service.createRole(orgId, {
          name: 'NoCaller',
          permissions: { control: ['read'] },
        }),
      ).rejects.toThrow('Caller context is required');
      expect(mockDb.organizationRole.create).not.toHaveBeenCalled();
    });

    it('denies grants for unknown service tokens', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      await expect(
        service.createRole(
          orgId,
          {
            name: 'ServiceEscalated',
            permissions: { control: ['read'] },
          },
          { roles: null, isServiceToken: true, serviceName: 'Unknown' },
        ),
      ).rejects.toThrow('Unknown service');
      expect(mockDb.organizationRole.create).not.toHaveBeenCalled();
    });

    it('400 on empty permissions without touching the database', async () => {
      await expect(
        service.createRole(
          orgId,
          { name: 'Empty', permissions: {} },
          { roles: ['owner'] },
        ),
      ).rejects.toThrow('At least one permission must be granted');
      expect(mockDb.organizationRole.create).not.toHaveBeenCalled();
      expect(mockDb.organizationRole.findMany).not.toHaveBeenCalled();
    });
  });

  describe('updateRole / deleteRole', () => {
    const orgId = 'org_1';

    it('404 when role belongs to another tenant', async () => {
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.updateRole(orgId, 'rol_other', { name: 'New' }),
      ).rejects.toThrow(NotFoundException);
      await expect(service.deleteRole(orgId, 'rol_other')).rejects.toThrow(
        NotFoundException,
      );
      // Both lookups must stay tenant-scoped: an unscoped query would return
      // the foreign row instead of 404, so assert the where clause directly.
      expect(mockDb.organizationRole.findFirst).toHaveBeenNthCalledWith(1, {
        where: { id: 'rol_other', organizationId: orgId },
      });
      expect(mockDb.organizationRole.findFirst).toHaveBeenNthCalledWith(2, {
        where: { id: 'rol_other', organizationId: orgId },
      });
    });

    it('404 when getting a role from another tenant', async () => {
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.getRole(orgId, 'rol_other')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockDb.organizationRole.findFirst).toHaveBeenCalledWith({
        where: { id: 'rol_other', organizationId: orgId },
      });
    });

    it('rename with holders returns affectedMembers + warning (exact matches only)', async () => {
      const existing = {
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        existing,
      );
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        { name: 'Lead' },
      ]);
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([
        { role: 'Lead' },
        { role: 'Lead, admin' },
        { role: 'Compliance Lead' },
      ]);
      (mockDb.organizationRole.update as jest.Mock).mockResolvedValue({});
      const updated = {
        ...existing,
        name: 'Senior Lead',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated);

      const result = await service.updateRole(
        orgId,
        'rol_1',
        { name: 'Senior Lead', confirmRename: true },
        { roles: ['owner'] },
      );
      expect(result.affectedMembers).toBe(2);
      const renamed = result as typeof result & {
        warning?: string;
        previousName?: string;
        orphanedMembers?: number;
        _count?: { members: number };
      };
      expect(renamed.warning).toContain('until Gideon assignments are renamed');
      // Explicit orphan accounting: _count tracks the NEW name (0 holders
      // until Gideon is renamed), affectedMembers tracks the orphaned old name.
      expect(renamed.previousName).toBe('Lead');
      expect(renamed.orphanedMembers).toBe(2);
      expect(renamed._count?.members).toBe(0);
    });

    it('permission-only edits report affectedMembers + warning', async () => {
      const existing = {
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        existing,
      );
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([
        { role: 'Lead' },
        { role: 'Lead, admin' },
        { role: 'Compliance Lead' },
      ]);
      (mockDb.organizationRole.update as jest.Mock).mockResolvedValue({});
      const afterUpdate = {
        ...existing,
        permissions: JSON.stringify({ control: ['read', 'update'] }),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(afterUpdate);

      const result = await service.updateRole(
        orgId,
        'rol_1',
        { permissions: { control: ['read', 'update'] } },
        { roles: ['owner'] },
      );
      expect(result.affectedMembers).toBe(2);
      const edited = result as typeof result & { warning?: string };
      expect(edited.warning).toContain('effective on their next request');
    });

    it('compliance obligations imply portal — caller without portal cannot grant', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.organizationRole.create as jest.Mock).mockResolvedValue({
        id: 'rol_new',
      });
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue({
        id: 'rol_new',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: JSON.stringify({ compliance: true }),
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([]);
      // auditor holds control:read but no portal access — compliance:true
      // implies portal, so the grant must fail.
      await expect(
        service.createRole(
          orgId,
          {
            name: 'Lead',
            permissions: { control: ['read'] },
            obligations: { compliance: true },
          },
          { roles: ['auditor'] },
        ),
      ).rejects.toThrow('portal:read');
      expect(mockDb.organizationRole.create).not.toHaveBeenCalled();
    });

    it('compliance obligations store implied portal permissions', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      const created = {
        id: 'rol_new',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: JSON.stringify({ compliance: true }),
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.create as jest.Mock).mockResolvedValue(created);
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue({
        ...created,
        permissions: JSON.stringify({
          control: ['read'],
          portal: ['read', 'update'],
        }),
      });
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([]);
      await service.createRole(
        orgId,
        {
          name: 'Lead',
          permissions: { control: ['read'] },
          obligations: { compliance: true },
        },
        { roles: ['owner'] },
      );
      expect(mockDb.organizationRole.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Lead',
          obligations: JSON.stringify({ compliance: true }),
        }),
      });
      const stored = (mockDb.organizationRole.create as jest.Mock).mock
        .calls[0][0] as {
        data: { permissions: string };
      };
      expect(JSON.parse(stored.data.permissions)).toEqual({
        control: ['read'],
        portal: ['read', 'update'],
      });
    });

    it('compliance opt-out keeps independently held portal rights', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      const created = {
        id: 'rol_new',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: JSON.stringify({ compliance: false }),
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.create as jest.Mock).mockResolvedValue(created);
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        created,
      );
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([]);
      await service.createRole(
        orgId,
        {
          name: 'Lead',
          permissions: { control: ['read'], portal: ['read', 'update'] },
          obligations: { compliance: false },
        },
        { roles: ['owner'] },
      );
      const stored = (mockDb.organizationRole.create as jest.Mock).mock
        .calls[0][0] as {
        data: { permissions: string };
      };
      // Opting out never strips: the implication is one-directional add.
      expect(JSON.parse(stored.data.permissions)).toEqual({
        control: ['read'],
        portal: ['read', 'update'],
      });
    });

    it('rename with holders requires confirmRename', async () => {
      const existing = {
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        existing,
      );
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        { name: 'Lead' },
      ]);
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([
        { role: 'Lead' },
      ]);
      await expect(
        service.updateRole(orgId, 'rol_1', { name: 'Senior Lead' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDb.organizationRole.update).not.toHaveBeenCalled();
    });

    it('rename to an exact duplicate 409s without writing', async () => {
      const existing = {
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        existing,
      );
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        { name: 'Lead' },
        { name: 'Other' },
      ]);
      await expect(
        service.updateRole(orgId, 'rol_1', { name: 'Other' }),
      ).rejects.toThrow(ConflictException);
      expect(mockDb.organizationRole.update).not.toHaveBeenCalled();
    });

    it('rename to a case-only variant 409s without writing', async () => {
      const existing = {
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        existing,
      );
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        { name: 'Lead' },
        { name: 'senior lead' },
      ]);
      await expect(
        service.updateRole(orgId, 'rol_1', { name: 'Senior Lead' }),
      ).rejects.toThrow('differs only by case');
      expect(mockDb.organizationRole.update).not.toHaveBeenCalled();
    });

    it('concurrent case-variant rename reverts the name and 409s', async () => {
      const existing = {
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        existing,
      );
      // Pre-check sees no clash; the post-write re-check sees the concurrent
      // case-variant insert that landed in between.
      (mockDb.organizationRole.findMany as jest.Mock)
        .mockResolvedValueOnce([{ name: 'Lead' }])
        .mockResolvedValueOnce([{ id: 'rol_2', name: 'senior lead' }]);
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([
        { role: 'Lead' },
      ]);
      (mockDb.organizationRole.update as jest.Mock).mockResolvedValue({});
      await expect(
        service.updateRole(
          orgId,
          'rol_1',
          { name: 'Senior Lead', confirmRename: true },
          { roles: ['owner'] },
        ),
      ).rejects.toThrow('differs only by case');
      const updates = (mockDb.organizationRole.update as jest.Mock).mock.calls;
      expect(updates).toHaveLength(2);
      // The second write restores the full previous state — the row survives
      // with its old name, permissions, and obligations, so the failed
      // request leaves nothing behind.
      expect(updates[1][0]).toEqual({
        where: {
          id: 'rol_1',
          organizationId: orgId,
          name: 'Senior Lead',
          permissions: existing.permissions,
          obligations: existing.obligations,
        },
        data: {
          name: 'Lead',
          permissions: JSON.stringify({ control: ['read'] }),
          obligations: '{}',
        },
      });
    });

    it('no-op permission re-save skips the write and warns nothing', async () => {
      const existing = {
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        existing,
      );
      const result = await service.updateRole(
        orgId,
        'rol_1',
        { permissions: { control: ['read'] } },
        { roles: ['owner'] },
      );
      expect(mockDb.organizationRole.update).not.toHaveBeenCalled();
      expect(result.affectedMembers).toBe(0);
      expect(result).not.toHaveProperty('warning');
    });

    it('duplicate actions do not mask a revocation', async () => {
      const existing = {
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read', 'create'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        existing,
      );
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        { name: 'Lead' },
      ]);
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.organizationRole.update as jest.Mock).mockResolvedValue({});
      const updated = {
        ...existing,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated);
      // `{ control: ["read", "read"] }` must not compare equal to the stored
      // `{ control: ["read", "create"] }` — the write must proceed and drop
      // the revoked `create` (deduped to a single `read`).
      await service.updateRole(
        orgId,
        'rol_1',
        { permissions: { control: ['read', 'read'] } },
        { roles: ['owner'] },
      );
      expect(mockDb.organizationRole.update).toHaveBeenCalled();
      const written = (mockDb.organizationRole.update as jest.Mock).mock
        .calls[0][0];
      expect(JSON.parse(written.data.permissions)).toEqual({
        control: ['read'],
      });
    });

    it('denies compliance opt-in on update when the caller lacks portal access', async () => {
      const existing = {
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        existing,
      );
      // Auditor holds control:read but no portal access — compliance:true
      // implies portal, so the grant check must fail before any write.
      await expect(
        service.updateRole(
          orgId,
          'rol_1',
          { obligations: { compliance: true } },
          { roles: ['auditor'] },
        ),
      ).rejects.toThrow('does not hold it');
      expect(mockDb.organizationRole.update).not.toHaveBeenCalled();
    });

    it('maps P2002/P2025 races on update to 409/404', async () => {
      const existing = {
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        existing,
      );
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        { name: 'Lead' },
      ]);
      (mockDb.organizationRole.update as jest.Mock).mockRejectedValueOnce({
        code: 'P2002',
      });
      await expect(
        service.updateRole(
          orgId,
          'rol_1',
          { name: 'Senior Lead' },
          { roles: ['owner'] },
        ),
      ).rejects.toThrow(ConflictException);
      (mockDb.organizationRole.update as jest.Mock).mockRejectedValueOnce({
        code: 'P2025',
      });
      (mockDb.organizationRole.findFirst as jest.Mock)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(null);
      await expect(
        service.updateRole(
          orgId,
          'rol_1',
          { name: 'Senior Lead' },
          { roles: ['owner'] },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('delete with holders 409, delete without holders succeeds', async () => {
      const role = {
        id: 'rol_1',
        name: 'Lead',
        permissions: '{}',
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(role);
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([
        { role: 'Lead' },
        { role: 'Lead, admin' },
      ]);
      await expect(service.deleteRole(orgId, 'rol_1')).rejects.toThrow(
        'Remove assignments in Gideon first',
      );
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([
        { role: 'Compliance Lead' },
      ]);
      (mockDb.organizationRole.delete as jest.Mock).mockResolvedValue(role);
      await expect(service.deleteRole(orgId, 'rol_1')).resolves.toEqual({
        id: 'rol_1',
        deleted: true,
      });
    });

    it('denies privilege growth on update', async () => {
      const role = {
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(role);
      await expect(
        service.updateRole(
          orgId,
          'rol_1',
          { permissions: { organization: ['delete'] } },
          { roles: ['admin'] },
        ),
      ).rejects.toThrow('does not hold it');
      expect(mockDb.organizationRole.update).not.toHaveBeenCalled();
    });
  });

  describe('getPermissionsForRoles', () => {
    const orgId = 'org_1';

    it('merges built-in and custom roles in one query', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        {
          name: 'Lead',
          permissions: JSON.stringify({ control: ['read'] }),
        },
      ]);
      const result = await service.getPermissionsForRoles(orgId, [
        'admin',
        'Lead',
        'unknown-name',
      ]);
      // Built-in admin contributes its permissions alongside the custom role.
      expect(result.control).toEqual(expect.arrayContaining(['read']));
      expect(result.organization).toEqual(
        expect.arrayContaining(['read', 'update']),
      );
      expect(mockDb.organizationRole.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: orgId,
          name: { in: ['Lead', 'unknown-name'] },
        },
        select: { permissions: true },
      });
    });

    it('ignores corrupt custom rows instead of throwing', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        { name: 'Lead', permissions: 'not-json{' },
      ]);
      await expect(
        service.getPermissionsForRoles(orgId, ['Lead']),
      ).resolves.toEqual({});
    });

    it('ignores prototype keys in stored permissions instead of crashing', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        {
          name: 'Lead',
          permissions: '{"__proto__":["read"],"control":["read"]}',
        },
      ]);
      await expect(
        service.getPermissionsForRoles(orgId, ['Lead']),
      ).resolves.toEqual({ control: ['read'] });
    });
  });

  describe('setBuiltInObligations', () => {
    const orgId = 'org_1';

    it('upserts the override row when caller holds portal', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.organizationRole.upsert as jest.Mock).mockResolvedValue({
        id: 'rol_override',
      });
      const result = await service.setBuiltInObligations(
        orgId,
        'admin',
        { compliance: true },
        { roles: ['owner'] },
      );
      expect(result).toEqual({
        name: 'admin',
        obligations: { compliance: true },
      });
      expect(mockDb.organizationRole.upsert).toHaveBeenCalledWith({
        where: {
          organizationId_name: { organizationId: orgId, name: 'admin' },
        },
        create: {
          name: 'admin',
          permissions: '{}',
          obligations: JSON.stringify({ compliance: true }),
          organizationId: orgId,
        },
        update: { obligations: JSON.stringify({ compliance: true }) },
      });
    });

    it('denies compliance opt-in when caller lacks portal', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
      await expect(
        service.setBuiltInObligations(
          orgId,
          'admin',
          { compliance: true },
          { roles: ['auditor'] },
        ),
      ).rejects.toThrow('portal');
      expect(mockDb.organizationRole.upsert).not.toHaveBeenCalled();
    });

    it('denies built-in writes without caller context', async () => {
      await expect(
        service.setBuiltInObligations(orgId, 'admin', { compliance: true }),
      ).rejects.toThrow('Caller context is required');
      expect(mockDb.organizationRole.upsert).not.toHaveBeenCalled();
    });

    it('rejects non-built-in names and unknown obligations', async () => {
      await expect(
        service.setBuiltInObligations(
          orgId,
          'Lead',
          { compliance: true },
          { roles: ['owner'] },
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.setBuiltInObligations(
          orgId,
          'owner',
          { other: true },
          { roles: ['owner'] },
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockDb.organizationRole.upsert).not.toHaveBeenCalled();
    });

    it('blocks built-in edit/delete via custom paths', async () => {
      const builtInRow = {
        id: 'rol_override',
        name: 'admin',
        permissions: '{}',
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock).mockResolvedValue(
        builtInRow,
      );
      await expect(
        service.updateRole(orgId, 'rol_override', { name: 'New' }),
      ).rejects.toThrow('Built-in roles cannot be edited');
      await expect(service.deleteRole(orgId, 'rol_override')).rejects.toThrow(
        'Built-in roles cannot be deleted',
      );
    });
  });

  describe('corrupt stored rows', () => {
    const orgId = 'org_1';

    it('listRoles surfaces {} for unparseable permissions', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'rol_bad',
          name: 'Lead',
          permissions: 'not-json{',
          obligations: 'also-bad{',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.listRoles(orgId);
      expect(result.customRoles).toHaveLength(1);
      expect(result.customRoles[0].permissions).toEqual({});
      expect(result.customRoles[0].obligations).toEqual({});
    });

    it('treats non-boolean compliance flags as absent', async () => {
      (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'rol_bad',
          name: 'Lead',
          permissions: '{}',
          obligations: JSON.stringify({ compliance: 'yes' }),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.listRoles(orgId);
      expect(result.customRoles[0].obligations).toEqual({});
    });
  });

  describe('obligations-only updates', () => {
    const orgId = 'org_1';

    it('persists implied portal and warns holders', async () => {
      const existing = {
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({
          ...existing,
          permissions: JSON.stringify({
            control: ['read'],
            portal: ['read', 'update'],
          }),
          obligations: JSON.stringify({ compliance: true }),
        });
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([
        { id: 'm1', role: 'Lead' },
      ]);
      (mockDb.organizationRole.update as jest.Mock).mockResolvedValue({});

      const result = await service.updateRole(
        orgId,
        'rol_1',
        { obligations: { compliance: true } },
        { roles: ['owner'] },
      );
      const stored = (mockDb.organizationRole.update as jest.Mock).mock
        .calls[0][0] as { data: { permissions: string } };
      expect(JSON.parse(stored.data.permissions)).toEqual({
        control: ['read'],
        portal: ['read', 'update'],
      });
      expect(result.affectedMembers).toBe(1);
    });

    it('dedups duplicate tokens when counting holders', async () => {
      const existing = {
        id: 'rol_1',
        name: 'Lead',
        permissions: JSON.stringify({ control: ['read'] }),
        obligations: '{}',
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockDb.organizationRole.findFirst as jest.Mock)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing);
      (mockDb.member.findMany as jest.Mock).mockResolvedValue([
        { id: 'm1', role: 'Lead, Lead' },
      ]);
      (mockDb.organizationRole.update as jest.Mock).mockResolvedValue({});
      const result = await service.updateRole(
        orgId,
        'rol_1',
        { permissions: { control: ['read', 'update'] } },
        { roles: ['owner'] },
      );
      expect(result.affectedMembers).toBe(1);
    });
  });
});
