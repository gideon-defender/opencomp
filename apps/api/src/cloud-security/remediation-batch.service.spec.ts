import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { db } from '@db';
import { RemediationBatchService } from './remediation-batch.service';

jest.mock('@db', () => {
  // Mirrors Prisma.PrismaClientKnownRequestError closely enough for the
  // service's P2002 mapping — the real class is unavailable under mock.
  class mockPrismaKnownError extends Error {
    code: string;
    constructor(message: string, opts: { code: string }) {
      super(message);
      this.code = opts.code;
    }
  }
  return {
    db: {
      integrationConnection: { findFirst: jest.fn() },
      remediationBatch: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    },
    Prisma: { PrismaClientKnownRequestError: mockPrismaKnownError },
  };
});

const mockDb = db as unknown as {
  integrationConnection: { findFirst: jest.Mock };
  remediationBatch: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
};

// Mock auth.server to avoid importing better-auth ESM in Jest
jest.mock('../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('@gideon-defender/auth', () => ({
  statement: {},
  BUILT_IN_ROLE_PERMISSIONS: {},
}));

describe('RemediationBatchService', () => {
  let service: RemediationBatchService;

  const orgId = 'org_123';
  const userId = 'usr_456';
  const connectionId = 'conn_789';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RemediationBatchService],
    }).compile();

    service = module.get<RemediationBatchService>(RemediationBatchService);

    jest.clearAllMocks();
  });

  describe('createBatch', () => {
    const findings = [
      { id: 'chk_1', key: 's3-encryption', title: 'Unencrypted' },
    ];

    it('creates a batch when the connection belongs to the organization', async () => {
      mockDb.integrationConnection.findFirst.mockResolvedValue({
        id: connectionId,
      });
      mockDb.remediationBatch.create.mockResolvedValue({ id: 'batch_1' });

      const result = await service.createBatch({
        connectionId,
        findings,
        organizationId: orgId,
        userId,
      });

      expect(mockDb.integrationConnection.findFirst).toHaveBeenCalledWith({
        where: { id: connectionId, organizationId: orgId, status: 'active' },
      });
      expect(mockDb.remediationBatch.create).toHaveBeenCalled();
      expect(result).toEqual({ data: { id: 'batch_1' } });
    });

    it('rejects a connection from another organization', async () => {
      mockDb.integrationConnection.findFirst.mockResolvedValue(null);

      await expect(
        service.createBatch({
          connectionId,
          findings,
          organizationId: orgId,
          userId,
        }),
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });

      expect(mockDb.remediationBatch.create).not.toHaveBeenCalled();
    });

    it('rejects an empty findings list', async () => {
      mockDb.integrationConnection.findFirst.mockResolvedValue({
        id: connectionId,
      });

      await expect(
        service.createBatch({
          connectionId,
          findings: [],
          organizationId: orgId,
          userId,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });

      expect(mockDb.remediationBatch.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate finding ids', async () => {
      mockDb.integrationConnection.findFirst.mockResolvedValue({
        id: connectionId,
      });

      const dup = { id: 'chk_1', key: 'k', title: 't' };
      await expect(
        service.createBatch({
          connectionId,
          findings: [dup, { ...dup }],
          organizationId: orgId,
          userId,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });

      expect(mockDb.remediationBatch.create).not.toHaveBeenCalled();
    });

    it('rejects when a batch is already active for the connection', async () => {
      mockDb.integrationConnection.findFirst.mockResolvedValue({
        id: connectionId,
      });
      mockDb.remediationBatch.findFirst.mockResolvedValue({ id: 'batch_old' });

      await expect(
        service.createBatch({
          connectionId,
          findings,
          organizationId: orgId,
          userId,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

      expect(mockDb.remediationBatch.create).not.toHaveBeenCalled();
    });

    it('maps a lost create race to the same conflict', async () => {
      // Both concurrent creates pass the read; the partial unique index
      // rejects the loser with P2002 — that must surface as 409, not 500.
      const { Prisma: MockPrisma } = jest.requireMock('@db');
      mockDb.integrationConnection.findFirst.mockResolvedValue({
        id: connectionId,
      });
      mockDb.remediationBatch.findFirst.mockResolvedValue(null);
      mockDb.remediationBatch.create.mockRejectedValue(
        new MockPrisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          { code: 'P2002' },
        ),
      );

      await expect(
        service.createBatch({
          connectionId,
          findings,
          organizationId: orgId,
          userId,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    });
  });

  describe('getActiveBatch', () => {
    it('throws BAD_REQUEST when connectionId is missing', async () => {
      await expect(
        service.getActiveBatch({ connectionId: '', organizationId: orgId }),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });

      expect(mockDb.remediationBatch.findFirst).not.toHaveBeenCalled();
    });

    it('returns the active batch for the connection', async () => {
      mockDb.remediationBatch.findFirst.mockResolvedValue({ id: 'batch_1' });

      const result = await service.getActiveBatch({
        connectionId,
        organizationId: orgId,
      });

      expect(mockDb.remediationBatch.findFirst).toHaveBeenCalledWith({
        where: {
          connectionId,
          organizationId: orgId,
          status: { in: ['pending', 'running'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({ data: { id: 'batch_1' } });
    });
  });

  describe('updateBatch', () => {
    it('updates triggerRunId scoped to the organization', async () => {
      mockDb.remediationBatch.findFirst.mockResolvedValue({ id: 'batch_1' });
      mockDb.remediationBatch.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.updateBatch({
        batchId: 'batch_1',
        triggerRunId: 'run_1',
        status: 'running',
        organizationId: orgId,
      });

      expect(mockDb.remediationBatch.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'batch_1',
          organizationId: orgId,
          status: { notIn: ['completed', 'done', 'failed', 'cancelled'] },
        },
        data: { triggerRunId: 'run_1', status: 'running' },
      });
      expect(result).toEqual({ data: { id: 'batch_1' } });
    });

    it('accepts the legacy done status for finished-batch cleanup', async () => {
      mockDb.remediationBatch.findFirst.mockResolvedValue({
        status: 'running',
      });
      mockDb.remediationBatch.updateMany.mockResolvedValue({ count: 1 });

      await service.updateBatch({
        batchId: 'batch_1',
        status: 'done',
        organizationId: orgId,
      });

      expect(mockDb.remediationBatch.updateMany).toHaveBeenCalledWith({
        where: { id: 'batch_1', organizationId: orgId },
        data: { status: 'done' },
      });
    });

    it('throws NOT_FOUND when no batch matches', async () => {
      mockDb.remediationBatch.findFirst
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce(null);
      mockDb.remediationBatch.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateBatch({
          batchId: 'missing',
          status: 'cancelled',
          organizationId: orgId,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it('refuses to reopen a terminal batch', async () => {
      mockDb.remediationBatch.findFirst.mockResolvedValue({
        status: 'completed',
      });

      await expect(
        service.updateBatch({
          batchId: 'batch_1',
          status: 'pending',
          organizationId: orgId,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });

      expect(mockDb.remediationBatch.updateMany).not.toHaveBeenCalled();
    });

    it('reports a lost reopen race as bad request, not not-found', async () => {
      // A concurrent completion lands between the pre-check read and the
      // atomic write: the write matches nothing, but the row exists. That
      // is a failed reopen (400), not a missing batch (404).
      mockDb.remediationBatch.findFirst
        .mockResolvedValueOnce({ status: 'running' })
        .mockResolvedValueOnce({ status: 'completed' });
      mockDb.remediationBatch.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateBatch({
          batchId: 'batch_1',
          status: 'pending',
          organizationId: orgId,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('maps a lost update race against the unique index to conflict', async () => {
      // Reopening next to a second active batch trips the partial unique
      // index — same 409 as the create path, not a 500.
      const { Prisma: MockPrisma } = jest.requireMock('@db');
      mockDb.remediationBatch.findFirst.mockResolvedValue({
        status: 'running',
      });
      mockDb.remediationBatch.updateMany.mockRejectedValue(
        new MockPrisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          { code: 'P2002' },
        ),
      );

      await expect(
        service.updateBatch({
          batchId: 'batch_1',
          status: 'pending',
          organizationId: orgId,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    });

    it('rejects an empty body instead of sending Prisma an empty update', async () => {
      await expect(
        service.updateBatch({ batchId: 'batch_1', organizationId: orgId }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });

      expect(mockDb.remediationBatch.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('skipFinding', () => {
    it('marks a pending finding cancelled with an org-scoped write', async () => {
      mockDb.remediationBatch.findFirst.mockResolvedValue({
        id: 'batch_1',
        status: 'running',
        findings: [{ id: 'chk_1', status: 'pending' }],
      });
      mockDb.remediationBatch.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.skipFinding({
        batchId: 'batch_1',
        findingId: 'chk_1',
        organizationId: orgId,
      });

      expect(mockDb.remediationBatch.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'batch_1',
          organizationId: orgId,
          status: { in: ['pending', 'running'] },
          findings: { equals: [{ id: 'chk_1', status: 'pending' }] },
        },
        data: { findings: [{ id: 'chk_1', status: 'cancelled' }] },
      });
      expect(result).toEqual({ success: true });
    });

    it('throws NOT_FOUND for a batch in another organization', async () => {
      mockDb.remediationBatch.findFirst.mockResolvedValue(null);

      await expect(
        service.skipFinding({
          batchId: 'batch_1',
          findingId: 'chk_1',
          organizationId: orgId,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });

      expect(mockDb.remediationBatch.updateMany).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND for a finding not in the batch', async () => {
      mockDb.remediationBatch.findFirst.mockResolvedValue({
        id: 'batch_1',
        findings: [{ id: 'chk_9', status: 'pending' }],
      });

      await expect(
        service.skipFinding({
          batchId: 'batch_1',
          findingId: 'chk_1',
          organizationId: orgId,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });

      expect(mockDb.remediationBatch.updateMany).not.toHaveBeenCalled();
    });

    it('throws when stored findings are corrupted', async () => {
      mockDb.remediationBatch.findFirst.mockResolvedValue({
        id: 'batch_1',
        findings: null,
      });

      await expect(
        service.skipFinding({
          batchId: 'batch_1',
          findingId: 'chk_1',
          organizationId: orgId,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.INTERNAL_SERVER_ERROR });
    });

    it('refuses to skip in a terminal batch', async () => {
      mockDb.remediationBatch.findFirst.mockResolvedValue({
        id: 'batch_1',
        status: 'completed',
        findings: [{ id: 'chk_1', status: 'pending' }],
      });

      await expect(
        service.skipFinding({
          batchId: 'batch_1',
          findingId: 'chk_1',
          organizationId: orgId,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });

      expect(mockDb.remediationBatch.updateMany).not.toHaveBeenCalled();
    });

    it('reports a conflict when the finding is already handled', async () => {
      mockDb.remediationBatch.findFirst.mockResolvedValue({
        id: 'batch_1',
        status: 'running',
        findings: [{ id: 'chk_1', status: 'fixed' }],
      });

      await expect(
        service.skipFinding({
          batchId: 'batch_1',
          findingId: 'chk_1',
          organizationId: orgId,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

      expect(mockDb.remediationBatch.updateMany).not.toHaveBeenCalled();
    });

    it('treats re-skipping a cancelled finding as idempotent success', async () => {
      mockDb.remediationBatch.findFirst.mockResolvedValue({
        id: 'batch_1',
        status: 'running',
        findings: [{ id: 'chk_1', status: 'cancelled' }],
      });

      const result = await service.skipFinding({
        batchId: 'batch_1',
        findingId: 'chk_1',
        organizationId: orgId,
      });

      expect(result).toEqual({ success: true });
      expect(mockDb.remediationBatch.updateMany).not.toHaveBeenCalled();
    });

    it('retries against fresh state when a concurrent write wins the race', async () => {
      mockDb.remediationBatch.findFirst
        .mockResolvedValueOnce({
          id: 'batch_1',
          status: 'running',
          findings: [
            { id: 'chk_1', status: 'pending' },
            { id: 'chk_2', status: 'pending' },
          ],
        })
        // The worker marked chk_2 fixed between our read and write.
        .mockResolvedValueOnce({
          id: 'batch_1',
          status: 'running',
          findings: [
            { id: 'chk_1', status: 'pending' },
            { id: 'chk_2', status: 'fixed' },
          ],
        });
      mockDb.remediationBatch.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      const result = await service.skipFinding({
        batchId: 'batch_1',
        findingId: 'chk_1',
        organizationId: orgId,
      });

      expect(result).toEqual({ success: true });
      // The retry must carry the worker's progress forward, not clobber it.
      expect(mockDb.remediationBatch.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: 'batch_1',
          organizationId: orgId,
          status: { in: ['pending', 'running'] },
          findings: {
            equals: [
              { id: 'chk_1', status: 'pending' },
              { id: 'chk_2', status: 'fixed' },
            ],
          },
        },
        data: {
          findings: [
            { id: 'chk_1', status: 'cancelled' },
            { id: 'chk_2', status: 'fixed' },
          ],
        },
      });
    });
  });
});
