jest.mock('@db', () => ({
  db: {},
}));

// Both guards import ./auth.server, which validates SECRET_KEY and pulls in
// better-auth/redis at module load. Stub them so importing the controller is
// hermetic — the test calls methods directly and never runs the guards.
// PERMISSIONS_KEY must match the real value ('required_permissions') because
// RequirePermission sets metadata under that key and the gating test below
// reads it back via Reflector.
jest.mock('../auth/hybrid-auth.guard', () => ({ HybridAuthGuard: class {} }));
jest.mock('../auth/permission.guard', () => ({
  PermissionGuard: class {},
  PERMISSIONS_KEY: 'required_permissions',
}));

import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { FindingTemplateController } from './finding-template.controller';
import { FindingTemplateService } from './finding-template.service';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard, PERMISSIONS_KEY } from '../auth/permission.guard';

describe('FindingTemplateController', () => {
  let controller: FindingTemplateController;

  const mockFindingTemplateService = {
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    updateById: jest.fn(),
    deleteById: jest.fn(),
  };

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FindingTemplateController],
      providers: [
        {
          provide: FindingTemplateService,
          useValue: mockFindingTemplateService,
        },
      ],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(PermissionGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<FindingTemplateController>(
      FindingTemplateController,
    );
  });

  it('lists templates scoped to the organization', async () => {
    mockFindingTemplateService.findAll.mockResolvedValue([{ id: 'fnd_t_1' }]);

    await expect(controller.getAllFindingTemplates('org_123')).resolves.toEqual(
      [{ id: 'fnd_t_1' }],
    );
    expect(mockFindingTemplateService.findAll).toHaveBeenCalledWith({
      organizationId: 'org_123',
    });
  });

  it('gets one template scoped to the organization', async () => {
    mockFindingTemplateService.findById.mockResolvedValue({ id: 'fnd_t_1' });

    await controller.getFindingTemplateById('fnd_t_1', 'org_123');

    expect(mockFindingTemplateService.findById).toHaveBeenCalledWith({
      id: 'fnd_t_1',
      organizationId: 'org_123',
    });
  });

  it('creates a template in the caller\u2019s organization', async () => {
    const dto = {
      category: 'evidence_issue',
      title: 'Title',
      content: 'Content',
    };
    mockFindingTemplateService.create.mockResolvedValue({ id: 'fnd_t_1' });

    await controller.createFindingTemplate(dto, 'org_123');

    expect(mockFindingTemplateService.create).toHaveBeenCalledWith({
      organizationId: 'org_123',
      createDto: dto,
    });
  });

  it('updates a template in the caller\u2019s organization', async () => {
    mockFindingTemplateService.updateById.mockResolvedValue({ id: 'fnd_t_1' });

    await controller.updateFindingTemplate(
      'fnd_t_1',
      { title: 'New title' },
      'org_123',
    );

    expect(mockFindingTemplateService.updateById).toHaveBeenCalledWith({
      id: 'fnd_t_1',
      organizationId: 'org_123',
      updateDto: { title: 'New title' },
    });
  });

  it('deletes a template in the caller\u2019s organization', async () => {
    mockFindingTemplateService.deleteById.mockResolvedValue({ message: 'ok' });

    await controller.deleteFindingTemplate('fnd_t_1', 'org_123');

    expect(mockFindingTemplateService.deleteById).toHaveBeenCalledWith({
      id: 'fnd_t_1',
      organizationId: 'org_123',
    });
  });

  it('gates reads on finding:read and writes on finding:update', () => {
    const reflector = new Reflector();
    const required = (method: keyof FindingTemplateController) =>
      reflector.getAllAndOverride(PERMISSIONS_KEY, [
        controller[method],
        FindingTemplateController,
      ]);
    expect(required('getAllFindingTemplates')).toEqual([
      { resource: 'finding', actions: ['read'] },
    ]);
    expect(required('getFindingTemplateById')).toEqual([
      { resource: 'finding', actions: ['read'] },
    ]);
    expect(required('createFindingTemplate')).toEqual([
      { resource: 'finding', actions: ['update'] },
    ]);
    expect(required('updateFindingTemplate')).toEqual([
      { resource: 'finding', actions: ['update'] },
    ]);
    expect(required('deleteFindingTemplate')).toEqual([
      { resource: 'finding', actions: ['update'] },
    ]);
  });
});
