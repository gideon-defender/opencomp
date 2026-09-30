import { ConflictException, NotFoundException } from '@nestjs/common';

// Mock the DB layer before importing the service. We also provide a stand-in
// Prisma.PrismaClientKnownRequestError so the service's `instanceof` checks and
// error-code branches can be exercised without a real database.
jest.mock('@db', () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, { code }: { code: string }) {
      super(message);
      this.code = code;
      this.name = 'PrismaClientKnownRequestError';
    }
  }

  return {
    db: {
      $transaction: jest.fn(),
      evidenceAutomation: {
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      evidenceAutomationVersion: { create: jest.fn(), findMany: jest.fn() },
      evidenceAutomationRun: { findMany: jest.fn() },
    },
    Prisma: { PrismaClientKnownRequestError },
  };
});

import { db, Prisma } from '@db';
import { AutomationsService } from './automations.service';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: '5.0.0',
  });

const scope = { organizationId: 'org_1', taskId: 'tsk_1', automationId: 'aut_1' };

describe('AutomationsService — automation access is scoped to task and organization', () => {
  let service: AutomationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AutomationsService();
  });

  describe('findById', () => {
    it('returns the automation when it belongs to the task and organization', async () => {
      const automation = { id: 'aut_1', taskId: 'tsk_1' };
      (db.evidenceAutomation.findFirst as jest.Mock).mockResolvedValue(
        automation,
      );

      const result = await service.findById(scope);

      expect(db.evidenceAutomation.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'aut_1',
          taskId: 'tsk_1',
          task: { organizationId: 'org_1' },
        },
      });
      expect(result).toEqual({ success: true, automation });
    });

    it('throws NotFoundException when the automation belongs to a different task/org (IDOR)', async () => {
      (db.evidenceAutomation.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findById(scope)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const dto = { name: 'Renamed' };

    it('updates the automation when it belongs to the task and organization', async () => {
      (db.evidenceAutomation.findFirst as jest.Mock).mockResolvedValue({
        id: 'aut_1',
      });
      (db.evidenceAutomation.update as jest.Mock).mockResolvedValue({
        id: 'aut_1',
        name: 'Renamed',
        description: null,
      });

      const result = await service.update({
        ...scope,
        updateAutomationDto: dto,
      });

      expect(result.success).toBe(true);
      expect(db.evidenceAutomation.update).toHaveBeenCalled();
    });

    it('throws NotFoundException and never updates when automation is from another org (IDOR)', async () => {
      (db.evidenceAutomation.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.update({ ...scope, updateAutomationDto: dto }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(db.evidenceAutomation.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes the automation when it belongs to the task and organization', async () => {
      (db.evidenceAutomation.findFirst as jest.Mock).mockResolvedValue({
        id: 'aut_1',
      });
      (db.evidenceAutomation.delete as jest.Mock).mockResolvedValue({});

      const result = await service.delete(scope);

      expect(result).toEqual({
        success: true,
        message: 'Automation deleted successfully',
      });
      expect(db.evidenceAutomation.delete).toHaveBeenCalledWith({
        where: { id: 'aut_1' },
      });
    });

    it('throws NotFoundException and never deletes when automation is from another org (IDOR)', async () => {
      (db.evidenceAutomation.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.delete(scope)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(db.evidenceAutomation.delete).not.toHaveBeenCalled();
    });
  });

  describe('findRunsByAutomationId', () => {
    it('returns runs when the automation belongs to the task and organization', async () => {
      (db.evidenceAutomation.findFirst as jest.Mock).mockResolvedValue({
        id: 'aut_1',
      });
      (db.evidenceAutomationRun.findMany as jest.Mock).mockResolvedValue([
        { id: 'run_1' },
      ]);

      const result = await service.findRunsByAutomationId(scope);

      expect(result).toEqual([{ id: 'run_1' }]);
    });

    it('throws NotFoundException and never queries runs when automation is from another org (IDOR)', async () => {
      (db.evidenceAutomation.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findRunsByAutomationId(scope),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(db.evidenceAutomationRun.findMany).not.toHaveBeenCalled();
    });
  });

  describe('listVersions', () => {
    it('returns versions when the automation belongs to the task and organization', async () => {
      (db.evidenceAutomation.findFirst as jest.Mock).mockResolvedValue({
        id: 'aut_1',
      });
      (db.evidenceAutomationVersion.findMany as jest.Mock).mockResolvedValue([
        { id: 'eav_1', version: 1 },
      ]);

      const result = await service.listVersions(scope);

      expect(result).toEqual({
        success: true,
        versions: [{ id: 'eav_1', version: 1 }],
      });
    });

    it('throws NotFoundException and never queries versions when automation is from another org (IDOR)', async () => {
      (db.evidenceAutomation.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.listVersions(scope)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(db.evidenceAutomationVersion.findMany).not.toHaveBeenCalled();
    });
  });
});

describe('AutomationsService.createVersion — error mapping', () => {
  let service: AutomationsService;
  const input = { version: 1, scriptKey: 'org_1/tsk_1/aut_1.v1.js' };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AutomationsService();
    (db.evidenceAutomation.findFirst as jest.Mock).mockResolvedValue({
      id: 'aut_1',
    });
  });

  it('records the version and returns it on success', async () => {
    const created = { id: 'eav_1', version: 1, scriptKey: input.scriptKey };
    (db.$transaction as jest.Mock).mockResolvedValue([
      created,
      { id: 'aut_1' },
    ]);

    const result = await service.createVersion({ ...scope, data: input });

    expect(result).toEqual({ success: true, version: created });
  });

  it('throws NotFoundException and never writes when automation is from another org (IDOR)', async () => {
    (db.evidenceAutomation.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.createVersion({ ...scope, data: input }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('maps a duplicate version (P2002) to a 409 ConflictException', async () => {
    (db.$transaction as jest.Mock).mockRejectedValue(prismaError('P2002'));

    await expect(
      service.createVersion({ ...scope, data: input }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps a missing automation (P2003 FK violation) to a 404 NotFoundException', async () => {
    (db.$transaction as jest.Mock).mockRejectedValue(prismaError('P2003'));

    await expect(
      service.createVersion({ ...scope, automationId: 'missing', data: input }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps a missing automation (P2025 record not found) to a 404 NotFoundException', async () => {
    (db.$transaction as jest.Mock).mockRejectedValue(prismaError('P2025'));

    await expect(
      service.createVersion({ ...scope, automationId: 'missing', data: input }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rethrows unexpected errors untouched (no masking real 500s)', async () => {
    const boom = new Error('db exploded');
    (db.$transaction as jest.Mock).mockRejectedValue(boom);

    await expect(
      service.createVersion({ ...scope, data: input }),
    ).rejects.toBe(boom);
  });
});
