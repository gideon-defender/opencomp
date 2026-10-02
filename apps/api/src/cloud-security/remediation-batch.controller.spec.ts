import { Test, TestingModule } from '@nestjs/testing';
import { RemediationBatchController } from './remediation-batch.controller';
import { RemediationBatchService } from './remediation-batch.service';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';

jest.mock('./cloud-security-audit', () => ({
  logCloudSecurityActivity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('@gideon-defender/auth', () => ({
  statement: {},
  BUILT_IN_ROLE_PERMISSIONS: {},
}));

describe('RemediationBatchController', () => {
  let controller: RemediationBatchController;
  let batchService: jest.Mocked<RemediationBatchService>;

  const mockBatchService = {
    getActiveBatch: jest.fn(),
    createBatch: jest.fn(),
    updateBatch: jest.fn(),
    skipFinding: jest.fn(),
  };

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  const orgId = 'org_123';
  const userId = 'usr_456';
  const connectionId = 'conn_789';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RemediationBatchController],
      providers: [
        { provide: RemediationBatchService, useValue: mockBatchService },
      ],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(PermissionGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<RemediationBatchController>(
      RemediationBatchController,
    );
    batchService = module.get(RemediationBatchService);

    jest.clearAllMocks();
  });

  it('delegates getActiveBatch with named params', async () => {
    mockBatchService.getActiveBatch.mockResolvedValue({ data: null });

    const result = await controller.getActiveBatch(connectionId, orgId);

    expect(batchService.getActiveBatch).toHaveBeenCalledWith({
      connectionId,
      organizationId: orgId,
    });
    expect(result).toEqual({ data: null });
  });

  it('delegates createBatch and records the audit trail', async () => {
    const { logCloudSecurityActivity } = jest.requireMock(
      './cloud-security-audit',
    );
    mockBatchService.createBatch.mockResolvedValue({ data: { id: 'batch_1' } });
    const body = {
      connectionId,
      findings: [{ id: 'chk_1', key: 'k1', title: 't1' }],
    };

    const result = await controller.createBatch(body, orgId, userId);

    expect(batchService.createBatch).toHaveBeenCalledWith({
      connectionId,
      findings: body.findings,
      organizationId: orgId,
      userId,
    });
    expect(logCloudSecurityActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: orgId,
        action: 'remediation_executed',
      }),
    );
    expect(result).toEqual({ data: { id: 'batch_1' } });
  });

  it('delegates updateBatch with named params', async () => {
    mockBatchService.updateBatch.mockResolvedValue({ data: { id: 'batch_1' } });

    const result = await controller.updateBatch(
      'batch_1',
      { triggerRunId: 'run_1' },
      orgId,
    );

    expect(batchService.updateBatch).toHaveBeenCalledWith({
      batchId: 'batch_1',
      triggerRunId: 'run_1',
      status: undefined,
      organizationId: orgId,
    });
    expect(result).toEqual({ data: { id: 'batch_1' } });
  });

  it('delegates skipFinding with named params', async () => {
    mockBatchService.skipFinding.mockResolvedValue({ success: true });

    const result = await controller.skipFinding('batch_1', 'chk_1', orgId);

    expect(batchService.skipFinding).toHaveBeenCalledWith({
      batchId: 'batch_1',
      findingId: 'chk_1',
      organizationId: orgId,
    });
    expect(result).toEqual({ success: true });
  });
});
