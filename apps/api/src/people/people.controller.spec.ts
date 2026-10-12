import { Test, TestingModule } from '@nestjs/testing';
import { PeopleService } from './people.service';
import { PeopleInviteService } from './people-invite.service';
import { PeopleAccessService } from './people-access.service';
import { AttachmentsService } from '../attachments/attachments.service';
import type { AuthContext } from '../auth/types';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PERMISSIONS_KEY, PermissionGuard } from '../auth/permission.guard';
import { PeopleController } from './people.controller';
import { BadRequestException, GoneException } from '@nestjs/common';

// Mock @db to avoid PrismaClient initialization in controller tests
jest.mock('@db', () => ({
  db: {
    member: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createMany: jest.fn(),
    },
    user: { update: jest.fn() },
    organization: { findUnique: jest.fn() },
    session: { deleteMany: jest.fn() },
    task: { findMany: jest.fn(), updateMany: jest.fn() },
    policy: { findMany: jest.fn(), updateMany: jest.fn() },
    risk: { findMany: jest.fn(), updateMany: jest.fn() },
    vendor: { findMany: jest.fn(), updateMany: jest.fn() },
    organizationChart: { findUnique: jest.fn(), update: jest.fn() },
  },
  BackgroundCheckStatus: {
    pending: 'pending',
    in_progress: 'in_progress',
    completed: 'completed',
    completed_with_flags: 'completed_with_flags',
    cancelled: 'cancelled',
  },
  FindingType: { soc2: 'soc2', iso27001: 'iso27001' },
  FindingStatus: { open: 'open', closed: 'closed' },
  PhaseCompletionType: { manual: 'manual', auto: 'auto' },
  TimelinePhaseStatus: { pending: 'pending', completed: 'completed' },
  TimelineStatus: { draft: 'draft', active: 'active' },
  Departments: { it: 'it', none: 'none' },
}));

// Mock auth.server to avoid importing better-auth ESM in Jest
jest.mock('../auth/auth.server', () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
}));

jest.mock('@gideon-defender/auth', () => ({
  statement: {
    organization: ['read', 'update', 'delete'],
    member: ['create', 'read', 'update', 'delete'],
    risk: ['create', 'read', 'update', 'delete'],
    control: ['create', 'read', 'update', 'delete'],
  },
  BUILT_IN_ROLE_PERMISSIONS: {},
}));

describe('PeopleController', () => {
  let controller: PeopleController;
  let peopleService: jest.Mocked<PeopleService>;

  const mockPeopleService = {
    findAllByOrganization: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    bulkCreate: jest.fn(),
    updateById: jest.fn(),
    deleteById: jest.fn(),
    reactivateById: jest.fn(),
    unlinkDevice: jest.fn(),
    removeHostById: jest.fn(),
    updateEmailPreferences: jest.fn(),
    findMentionableMembers: jest.fn(),
  };

  const mockPeopleInviteService = {
    inviteMembers: jest.fn(),
    resendPortalInvite: jest.fn(),
  };

  const mockAttachmentsService = {
    getAttachments: jest.fn(),
    uploadAttachment: jest.fn(),
    deleteAttachment: jest.fn(),
  };

  const mockPeopleAccessService = {
    getMemberAccess: jest.fn(),
  };

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
      controllers: [PeopleController],
      providers: [
        { provide: PeopleService, useValue: mockPeopleService },
        { provide: PeopleInviteService, useValue: mockPeopleInviteService },
        { provide: PeopleAccessService, useValue: mockPeopleAccessService },
        { provide: AttachmentsService, useValue: mockAttachmentsService },
      ],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(PermissionGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<PeopleController>(PeopleController);
    peopleService = module.get(PeopleService);

    jest.clearAllMocks();
  });

  describe('getAllPeople', () => {
    it('should return people with auth context', async () => {
      const mockPeople = [
        { id: 'mem_1', user: { name: 'Alice' } },
        { id: 'mem_2', user: { name: 'Bob' } },
      ];

      mockPeopleService.findAllByOrganization.mockResolvedValue(mockPeople);

      const result = await controller.getAllPeople('org_123', mockAuthContext);

      expect(result.data).toEqual(mockPeople);
      expect(result.count).toBe(2);
      expect(result.authType).toBe('session');
      expect(result.authenticatedUser).toEqual({
        id: 'usr_123',
        email: 'test@example.com',
      });
      expect(peopleService.findAllByOrganization).toHaveBeenCalledWith(
        'org_123',
        false,
        undefined,
      );
    });

    it('should pass includeDeactivated=true to the service', async () => {
      mockPeopleService.findAllByOrganization.mockResolvedValue([]);

      await controller.getAllPeople('org_123', mockAuthContext, 'true');

      expect(peopleService.findAllByOrganization).toHaveBeenCalledWith(
        'org_123',
        true,
        undefined,
      );
    });

    it('should not include authenticatedUser when userId is missing', async () => {
      const apiKeyContext: AuthContext = {
        ...mockAuthContext,
        userId: undefined,
        userEmail: undefined,
        authType: 'api-key',
        isApiKey: true,
      };
      mockPeopleService.findAllByOrganization.mockResolvedValue([]);

      const result = await controller.getAllPeople('org_123', apiKeyContext);

      expect(result.authenticatedUser).toBeUndefined();
      expect(result.authType).toBe('api-key');
    });
  });

  // IdP-owned user management (Phase 3-server): legacy membership writes
  // return 410 Gone without touching the DB. Guards + @RequirePermission
  // metadata stay intact, so unauthenticated callers still get 401 and
  // unauthorized callers still get 403 before the fence runs.
  describe('IdP-ownership fences (410 Gone)', () => {
    it.each([
      ['inviteMembers', ['member', 'create']] as const,
      ['createMember', ['member', 'create']] as const,
      ['bulkCreateMembers', ['member', 'create']] as const,
      ['reactivateMember', ['member', 'update']] as const,
      ['updateMember', ['member', 'update']] as const,
      ['resendPortalInvite', ['member', 'update']] as const,
      ['deleteMember', ['member', 'delete']] as const,
    ])(
      '%s keeps its @RequirePermission so 401/403 still precede the 410',
      (method, [resource, action]) => {
        expect(
          Reflect.getMetadata(
            PERMISSIONS_KEY,
            PeopleController.prototype[method],
          ),
        ).toEqual([{ resource, actions: [action] }]);
      },
    );

    it('inviteMembers returns 410 without inviting', async () => {
      await expect(
        controller.inviteMembers({ invites: [] }, 'org_123', mockAuthContext),
      ).rejects.toThrow(GoneException);
      expect(mockPeopleInviteService.inviteMembers).not.toHaveBeenCalled();
    });

    it('createMember returns 410 with a Gideon-managed message', async () => {
      const error: unknown = await controller
        .createMember(
          { userId: 'usr_new', role: 'employee' },
          'org_123',
          mockAuthContext,
        )
        .catch((err: unknown) => err);
      if (!(error instanceof GoneException)) {
        throw new Error('expected GoneException');
      }
      expect(error.getStatus()).toBe(410);
      expect(error.message).toContain('Gideon');
      expect(mockPeopleService.create).not.toHaveBeenCalled();
    });

    it('bulkCreateMembers returns 410 without creating', async () => {
      await expect(
        controller.bulkCreateMembers(
          { members: [] },
          'org_123',
          mockAuthContext,
        ),
      ).rejects.toThrow(GoneException);
      expect(mockPeopleService.bulkCreate).not.toHaveBeenCalled();
    });

    it('reactivateMember returns 410 without reactivating', async () => {
      await expect(
        controller.reactivateMember('mem_1', 'org_123', mockAuthContext),
      ).rejects.toThrow(GoneException);
      expect(mockPeopleService.reactivateById).not.toHaveBeenCalled();
    });

    it('updateMember returns 410 without updating', async () => {
      await expect(
        controller.updateMember(
          'mem_1',
          { role: 'admin' },
          'org_123',
          mockAuthContext,
        ),
      ).rejects.toThrow(GoneException);
      expect(mockPeopleService.updateById).not.toHaveBeenCalled();
    });

    it('resendPortalInvite returns 410 without sending', async () => {
      await expect(
        controller.resendPortalInvite('mem_1', 'org_123'),
      ).rejects.toThrow(GoneException);
      expect(mockPeopleInviteService.resendPortalInvite).not.toHaveBeenCalled();
    });

    it('deleteMember returns 410 without deleting', async () => {
      await expect(
        controller.deleteMember('mem_1', 'org_123', mockAuthContext),
      ).rejects.toThrow(GoneException);
      expect(mockPeopleService.deleteById).not.toHaveBeenCalled();
    });
  });

  describe('getPersonById', () => {
    it('should return a single person with auth context', async () => {
      const person = {
        id: 'mem_1',
        user: { name: 'Alice', email: 'alice@test.com' },
      };
      mockPeopleService.findById.mockResolvedValue(person);

      const result = await controller.getPersonById(
        'mem_1',
        'org_123',
        mockAuthContext,
      );

      expect(result).toMatchObject(person);
      expect(result.authType).toBe('session');
      expect(peopleService.findById).toHaveBeenCalledWith('mem_1', 'org_123');
    });
  });

  describe('updateMember', () => {
    it('is fenced: covered by the 410 block above (no local role edits)', async () => {
      await expect(
        controller.updateMember(
          'mem_1',
          { backgroundCheckExempt: true },
          'org_123',
          mockAuthContext,
        ),
      ).rejects.toThrow(GoneException);
      expect(mockPeopleService.updateById).not.toHaveBeenCalled();
    });
  });

  describe('deleteMember', () => {
    it('is fenced: covered by the 410 block above (no local removals)', async () => {
      await expect(
        controller.deleteMember('mem_1', 'org_123', mockAuthContext, 'true'),
      ).rejects.toThrow(GoneException);
      expect(mockPeopleService.deleteById).not.toHaveBeenCalled();
    });
  });

  describe('unlinkDevice', () => {
    it('should unlink device for a member', async () => {
      const updated = {
        id: 'mem_1',
        user: { name: 'Alice' },
        fleetDmLabelId: null,
      };
      mockPeopleService.unlinkDevice.mockResolvedValue(updated);

      const result = await controller.unlinkDevice(
        'mem_1',
        'org_123',
        mockAuthContext,
      );

      expect(result).toMatchObject(updated);
      expect(peopleService.unlinkDevice).toHaveBeenCalledWith(
        'mem_1',
        'org_123',
      );
    });
  });

  describe('removeHost', () => {
    it('should remove a host by ID', async () => {
      mockPeopleService.removeHostById.mockResolvedValue({ success: true });

      const result = await controller.removeHost(
        'mem_1',
        42,
        'org_123',
        mockAuthContext,
      );

      expect(result.success).toBe(true);
      expect(peopleService.removeHostById).toHaveBeenCalledWith(
        'mem_1',
        'org_123',
        42,
      );
    });
  });

  describe('updateEmailPreferences', () => {
    it('should update email preferences for the current user', async () => {
      const prefs = {
        policyNotifications: true,
        taskReminders: false,
        weeklyTaskDigest: true,
        unassignedItemsNotifications: false,
        taskMentions: true,
        taskAssignments: true,
      };
      mockPeopleService.updateEmailPreferences.mockResolvedValue({
        success: true,
      });

      const result = await controller.updateEmailPreferences(mockAuthContext, {
        preferences: prefs,
      });

      expect(result).toEqual({ success: true });
      expect(peopleService.updateEmailPreferences).toHaveBeenCalledWith(
        'usr_123',
        prefs,
      );
    });

    it('should throw BadRequestException when userId is missing', async () => {
      const noUserContext: AuthContext = {
        ...mockAuthContext,
        userId: undefined,
      };

      await expect(
        controller.updateEmailPreferences(noUserContext, {
          preferences: {
            policyNotifications: true,
            taskReminders: true,
            weeklyTaskDigest: true,
            unassignedItemsNotifications: true,
            taskMentions: true,
            taskAssignments: true,
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
