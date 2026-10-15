import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PeopleService } from './people.service';
import { FleetService } from '../lib/fleet.service';
import { MemberValidator } from './utils/member-validator';
import { MemberQueries } from './utils/member-queries';

// Mock the database. Includes a stand-in Prisma.PrismaClientKnownRequestError
// so the service's `instanceof` error-code branches can be exercised.
jest.mock('@db', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, { code }: { code: string }) {
        super(message);
        this.code = code;
        this.name = 'PrismaClientKnownRequestError';
      }
    },
  },
  db: {
    member: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    task: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    policy: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    risk: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    vendor: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    session: {
      deleteMany: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
    organizationChart: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
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

jest.mock('@gideon-defender/auth', () => ({
  BUILT_IN_ROLE_PERMISSIONS: {
    owner: {
      organization: ['read', 'update', 'delete'],
      member: ['create', 'read', 'update', 'delete'],
    },
    admin: {
      organization: ['read', 'update'],
      member: ['create', 'read', 'update', 'delete'],
    },
    auditor: { organization: ['read'], member: ['read'] },
    employee: { compliance: ['required'] },
    contractor: { compliance: ['required'] },
  },
}));

jest.mock('./utils/member-validator');
jest.mock('./utils/member-queries');

import { db } from '@db';

describe('PeopleService', () => {
  let service: PeopleService;
  let fleetService: jest.Mocked<FleetService>;

  const mockFleetService = {
    removeHostsByLabel: jest.fn(),
    getHostsByLabel: jest.fn(),
    removeHostById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeopleService,
        { provide: FleetService, useValue: mockFleetService },
      ],
    }).compile();

    service = module.get<PeopleService>(PeopleService);
    fleetService = module.get(FleetService);

    jest.clearAllMocks();
  });

  describe('findAllByOrganization', () => {
    it('should return all members for an organization', async () => {
      const mockMembers = [
        { id: 'mem_1', user: { name: 'Alice' } },
        { id: 'mem_2', user: { name: 'Bob' } },
      ];

      (MemberValidator.validateOrganization as jest.Mock).mockResolvedValue(
        undefined,
      );
      (MemberQueries.findAllByOrganization as jest.Mock).mockResolvedValue(
        mockMembers,
      );

      const result = await service.findAllByOrganization('org_123');

      expect(result).toEqual(mockMembers);
      expect(result).toHaveLength(2);
      expect(MemberValidator.validateOrganization).toHaveBeenCalledWith(
        'org_123',
      );
    });

    it('should throw NotFoundException when organization does not exist', async () => {
      (MemberValidator.validateOrganization as jest.Mock).mockRejectedValue(
        new NotFoundException('Organization not found'),
      );

      await expect(
        service.findAllByOrganization('org_nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findById', () => {
    it('should return a member by ID', async () => {
      const mockMember = {
        id: 'mem_1',
        user: { name: 'Alice', email: 'alice@test.com' },
      };

      (MemberValidator.validateOrganization as jest.Mock).mockResolvedValue(
        undefined,
      );
      (MemberQueries.findByIdInOrganization as jest.Mock).mockResolvedValue(
        mockMember,
      );

      const result = await service.findById('mem_1', 'org_123');

      expect(result).toEqual(mockMember);
      expect(MemberQueries.findByIdInOrganization).toHaveBeenCalledWith(
        'mem_1',
        'org_123',
      );
    });

    it('should throw NotFoundException when member does not exist', async () => {
      (MemberValidator.validateOrganization as jest.Mock).mockResolvedValue(
        undefined,
      );
      (MemberQueries.findByIdInOrganization as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(service.findById('mem_none', 'org_123')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('unlinkDevice', () => {
    it('should unlink a device from a member', async () => {
      const member = {
        id: 'mem_1',
        fleetDmLabelId: 42,
        user: { name: 'Alice' },
      };
      const unlinked = {
        id: 'mem_1',
        fleetDmLabelId: null,
        user: { name: 'Alice' },
      };

      (MemberValidator.validateOrganization as jest.Mock).mockResolvedValue(
        undefined,
      );
      (MemberQueries.findByIdInOrganization as jest.Mock).mockResolvedValue(
        member,
      );
      (MemberQueries.unlinkDevice as jest.Mock).mockResolvedValue(unlinked);
      mockFleetService.removeHostsByLabel.mockResolvedValue({
        deletedCount: 1,
        failedCount: 0,
      });

      const result = await service.unlinkDevice('mem_1', 'org_123');

      expect(result.fleetDmLabelId).toBeNull();
      expect(fleetService.removeHostsByLabel).toHaveBeenCalledWith(42);
      expect(MemberQueries.unlinkDevice).toHaveBeenCalledWith(
        'mem_1',
        'org_123',
      );
    });

    it('should skip fleet removal when no label exists', async () => {
      const member = {
        id: 'mem_1',
        fleetDmLabelId: null,
        user: { name: 'Alice' },
      };
      const unlinked = { ...member };

      (MemberValidator.validateOrganization as jest.Mock).mockResolvedValue(
        undefined,
      );
      (MemberQueries.findByIdInOrganization as jest.Mock).mockResolvedValue(
        member,
      );
      (MemberQueries.unlinkDevice as jest.Mock).mockResolvedValue(unlinked);

      await service.unlinkDevice('mem_1', 'org_123');

      expect(fleetService.removeHostsByLabel).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when member not found', async () => {
      (MemberValidator.validateOrganization as jest.Mock).mockResolvedValue(
        undefined,
      );
      (MemberQueries.findByIdInOrganization as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(service.unlinkDevice('mem_none', 'org_123')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeHostById', () => {
    it('should remove a specific host', async () => {
      const member = {
        id: 'mem_1',
        fleetDmLabelId: 42,
        user: { name: 'Alice' },
      };

      (MemberValidator.validateOrganization as jest.Mock).mockResolvedValue(
        undefined,
      );
      (MemberQueries.findByIdInOrganization as jest.Mock).mockResolvedValue(
        member,
      );
      mockFleetService.getHostsByLabel.mockResolvedValue({
        hosts: [{ id: 100 }, { id: 200 }],
      });
      mockFleetService.removeHostById.mockResolvedValue(undefined);

      const result = await service.removeHostById('mem_1', 'org_123', 100);

      expect(result).toEqual({ success: true });
      expect(fleetService.removeHostById).toHaveBeenCalledWith(100);
    });

    it('should throw NotFoundException when host not found for member', async () => {
      const member = {
        id: 'mem_1',
        fleetDmLabelId: 42,
        user: { name: 'Alice' },
      };

      (MemberValidator.validateOrganization as jest.Mock).mockResolvedValue(
        undefined,
      );
      (MemberQueries.findByIdInOrganization as jest.Mock).mockResolvedValue(
        member,
      );
      mockFleetService.getHostsByLabel.mockResolvedValue({
        hosts: [{ id: 100 }],
      });

      await expect(
        service.removeHostById('mem_1', 'org_123', 999),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when member has no fleet label', async () => {
      const member = {
        id: 'mem_1',
        fleetDmLabelId: null,
        user: { name: 'Alice' },
      };

      (MemberValidator.validateOrganization as jest.Mock).mockResolvedValue(
        undefined,
      );
      (MemberQueries.findByIdInOrganization as jest.Mock).mockResolvedValue(
        member,
      );

      await expect(
        service.removeHostById('mem_1', 'org_123', 100),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateEmailPreferences', () => {
    it('should update preferences and set unsubscribed to false when any enabled', async () => {
      const prefs = {
        policyNotifications: true,
        taskReminders: false,
        weeklyTaskDigest: true,
        unassignedItemsNotifications: false,
        taskMentions: true,
        taskAssignments: true,
        findingNotifications: true,
      };

      (db.user.update as jest.Mock).mockResolvedValue({});

      const result = await service.updateEmailPreferences('usr_1', prefs);

      expect(result).toEqual({ success: true });
      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
        data: {
          emailPreferences: prefs,
          emailNotificationsUnsubscribed: false,
        },
      });
    });

    it('should set unsubscribed to true when all preferences disabled', async () => {
      const prefs = {
        policyNotifications: false,
        taskReminders: false,
        weeklyTaskDigest: false,
        unassignedItemsNotifications: false,
        taskMentions: false,
        taskAssignments: false,
        findingNotifications: false,
      };

      (db.user.update as jest.Mock).mockResolvedValue({});

      await service.updateEmailPreferences('usr_1', prefs);

      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
        data: {
          emailPreferences: prefs,
          emailNotificationsUnsubscribed: true,
        },
      });
    });
  });
});
