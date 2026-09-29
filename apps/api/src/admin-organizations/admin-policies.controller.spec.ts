import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AdminPoliciesController } from './admin-policies.controller';
import { PoliciesService } from '../policies/policies.service';

jest.mock('../auth/platform-admin.guard', () => ({
  PlatformAdminGuard: class {
    canActivate() {
      return true;
    }
  },
}));

jest.mock('../auth/auth.server', () => ({
  auth: { api: {} },
}));

jest.mock('@db', () => ({
  db: {
    frameworkInstance: { findMany: jest.fn().mockResolvedValue([]) },
    context: { findMany: jest.fn().mockResolvedValue([]) },
  },
  AuditLogEntityType: {
    organization: 'organization',
    framework: 'framework',
    requirement: 'requirement',
    control: 'control',
    policy: 'policy',
    task: 'task',
    people: 'people',
    risk: 'risk',
    vendor: 'vendor',
    tests: 'tests',
    integration: 'integration',
    trust: 'trust',
    finding: 'finding',
    pentest: 'pentest',
  },
  CommentEntityType: {
    task: 'task',
    vendor: 'vendor',
    risk: 'risk',
    policy: 'policy',
    finding: 'finding',
  },
  FindingType: {
    soc2: 'soc2',
    iso27001: 'iso27001',
  },
  BackgroundCheckStatus: {
    invited: 'invited',
    in_progress: 'in_progress',
    in_review: 'in_review',
    completed: 'completed',
    completed_with_flags: 'completed_with_flags',
    failed: 'failed',
    cancelled: 'cancelled',
  },
  PolicyStatus: {
    draft: 'draft',
    published: 'published',
    needs_review: 'needs_review',
  },
}));

jest.mock('@gideon-defender/trigger-local', () => ({
  auth: {
    createPublicToken: jest.fn().mockResolvedValue('mock-public-access-token'),
  },
  tasks: {
    trigger: jest.fn().mockResolvedValue({ id: 'run_123' }),
  },
}));

describe('AdminPoliciesController', () => {
  let controller: AdminPoliciesController;

  const mockService = {
    findAll: jest.fn(),
    updateById: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminPoliciesController],
      providers: [{ provide: PoliciesService, useValue: mockService }],
    }).compile();

    controller = module.get<AdminPoliciesController>(AdminPoliciesController);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('should list policies for an organization', async () => {
      const policies = [{ id: 'pol_1', name: 'Test Policy' }];
      mockService.findAll.mockResolvedValue(policies);

      const result = await controller.list('org_1');

      expect(mockService.findAll).toHaveBeenCalledWith({
        organizationId: 'org_1',
      });
      expect(result).toEqual(policies);
    });
  });

  describe('update', () => {
    it('should update policy status', async () => {
      const updated = { id: 'pol_1', status: 'published' };
      mockService.updateById.mockResolvedValue(updated);

      const result = await controller.update('org_1', 'pol_1', {
        status: 'published',
      });

      expect(mockService.updateById).toHaveBeenCalledWith('pol_1', 'org_1', {
        status: 'published',
      });
      expect(result).toEqual(updated);
    });

    it('should reject missing status', async () => {
      await expect(controller.update('org_1', 'pol_1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject invalid status', async () => {
      await expect(
        controller.update('org_1', 'pol_1', { status: 'invalid' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    it('should create a policy with name and defaults', async () => {
      const created = { id: 'pol_new', name: 'New Policy', status: 'draft' };
      mockService.create.mockResolvedValue(created);

      const result = await controller.create('org_1', {
        name: 'New Policy',
      });

      expect(mockService.create).toHaveBeenCalledWith('org_1', {
        name: 'New Policy',
        content: [],
        description: undefined,
        status: undefined,
        frequency: undefined,
        department: undefined,
      });
      expect(result).toEqual(created);
    });

    it('should create a policy with all optional fields', async () => {
      const created = {
        id: 'pol_new',
        name: 'Full Policy',
        status: 'published',
      };
      mockService.create.mockResolvedValue(created);

      const result = await controller.create('org_1', {
        name: 'Full Policy',
        description: 'A test policy',
        status: 'published' as never,
        frequency: 'yearly' as never,
        department: 'it',
      });

      expect(mockService.create).toHaveBeenCalledWith('org_1', {
        name: 'Full Policy',
        content: [],
        description: 'A test policy',
        status: 'published',
        frequency: 'yearly',
        department: 'it',
      });
      expect(result).toEqual(created);
    });
  });

  describe('regenerate', () => {
    it('should trigger policy regeneration', async () => {
      const result = await controller.regenerate('org_1', 'pol_1');

      expect(result).toEqual({
        data: {
          runId: 'run_123',
          publicAccessToken: 'mock-public-access-token',
        },
      });
    });
  });
});
