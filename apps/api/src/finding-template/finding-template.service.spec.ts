jest.mock('@db', () => ({
  db: {
    findingTemplate: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { db } from '@db';
import { FindingTemplateService } from './finding-template.service';

const mockedDb = db as unknown as Record<string, Record<string, jest.Mock>>;

const ORG = 'org_123';
const OTHER_ORG = 'org_456';

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fnd_t_abc123',
    category: 'evidence_issue',
    title: 'Issue with uploaded evidence',
    content: 'Please provide a screenshot showing the context.',
    order: 0,
    organizationId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('FindingTemplateService', () => {
  let service: FindingTemplateService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FindingTemplateService();
  });

  describe('findAll', () => {
    it('returns global templates plus the org\u2019s own templates', async () => {
      const rows = [
        template({ id: 'fnd_t_global' }),
        template({ id: 'fnd_t_mine', organizationId: ORG }),
      ];
      mockedDb.findingTemplate.findMany.mockResolvedValue(rows);

      await expect(service.findAll({ organizationId: ORG })).resolves.toEqual(
        rows,
      );
      expect(mockedDb.findingTemplate.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ organizationId: null }, { organizationId: ORG }],
        },
        orderBy: [{ category: 'asc' }, { order: 'asc' }, { title: 'asc' }],
      });
    });
  });

  describe('findById', () => {
    it('returns a global template', async () => {
      mockedDb.findingTemplate.findUnique.mockResolvedValue(template());

      await expect(
        service.findById({ id: 'fnd_t_abc123', organizationId: ORG }),
      ).resolves.toMatchObject({ id: 'fnd_t_abc123' });
    });

    it('returns an own-org template', async () => {
      mockedDb.findingTemplate.findUnique.mockResolvedValue(
        template({ organizationId: ORG }),
      );

      await expect(
        service.findById({ id: 'fnd_t_abc123', organizationId: ORG }),
      ).resolves.toMatchObject({ organizationId: ORG });
    });

    it('throws NotFound for another org\u2019s template', async () => {
      mockedDb.findingTemplate.findUnique.mockResolvedValue(
        template({ organizationId: OTHER_ORG }),
      );

      await expect(
        service.findById({ id: 'fnd_t_abc123', organizationId: ORG }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the template does not exist', async () => {
      mockedDb.findingTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.findById({ id: 'fnd_t_missing', organizationId: ORG }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a per-org template', async () => {
      const created = template({ organizationId: ORG });
      mockedDb.findingTemplate.create.mockResolvedValue(created);

      const result = await service.create({
        organizationId: ORG,
        createDto: {
          category: 'evidence_issue',
          title: 'Issue with uploaded evidence',
          content: 'Please provide a screenshot showing the context.',
        },
      });

      expect(result).toEqual(created);
      expect(mockedDb.findingTemplate.create).toHaveBeenCalledWith({
        data: {
          category: 'evidence_issue',
          title: 'Issue with uploaded evidence',
          content: 'Please provide a screenshot showing the context.',
          order: 0,
          organizationId: ORG,
        },
      });
    });
  });

  describe('updateById', () => {
    it('updates an own-org template', async () => {
      mockedDb.findingTemplate.findUnique.mockResolvedValue(
        template({ organizationId: ORG }),
      );
      mockedDb.findingTemplate.update.mockResolvedValue(
        template({ organizationId: ORG, title: 'Updated title' }),
      );

      const result = await service.updateById({
        id: 'fnd_t_abc123',
        organizationId: ORG,
        updateDto: { title: 'Updated title' },
      });

      expect(result.title).toBe('Updated title');
    });

    it('rejects updates to a global template', async () => {
      mockedDb.findingTemplate.findUnique.mockResolvedValue(template());

      await expect(
        service.updateById({
          id: 'fnd_t_abc123',
          organizationId: ORG,
          updateDto: { title: 'Updated title' },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockedDb.findingTemplate.update).not.toHaveBeenCalled();
    });

    it('throws NotFound for another org\u2019s template', async () => {
      mockedDb.findingTemplate.findUnique.mockResolvedValue(
        template({ organizationId: OTHER_ORG }),
      );

      await expect(
        service.updateById({
          id: 'fnd_t_abc123',
          organizationId: ORG,
          updateDto: { title: 'Updated title' },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps a concurrent-delete race (P2025) to NotFound instead of a 500', async () => {
      mockedDb.findingTemplate.findUnique.mockResolvedValue(
        template({ organizationId: ORG }),
      );
      mockedDb.findingTemplate.update.mockRejectedValue(
        Object.assign(new Error('Record to update not found.'), {
          code: 'P2025',
        }),
      );

      await expect(
        service.updateById({
          id: 'fnd_t_abc123',
          organizationId: ORG,
          updateDto: { title: 'Updated title' },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteById', () => {
    it('deletes an own-org template', async () => {
      mockedDb.findingTemplate.findUnique.mockResolvedValue(
        template({ organizationId: ORG }),
      );

      const result = await service.deleteById({
        id: 'fnd_t_abc123',
        organizationId: ORG,
      });

      expect(mockedDb.findingTemplate.delete).toHaveBeenCalledWith({
        where: { id: 'fnd_t_abc123' },
      });
      expect(result.deletedTemplate.id).toBe('fnd_t_abc123');
    });

    it('rejects deletes of a global template', async () => {
      mockedDb.findingTemplate.findUnique.mockResolvedValue(template());

      await expect(
        service.deleteById({ id: 'fnd_t_abc123', organizationId: ORG }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockedDb.findingTemplate.delete).not.toHaveBeenCalled();
    });

    it('throws NotFound for another org\u2019s template', async () => {
      mockedDb.findingTemplate.findUnique.mockResolvedValue(
        template({ organizationId: OTHER_ORG }),
      );

      await expect(
        service.deleteById({ id: 'fnd_t_abc123', organizationId: ORG }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps a concurrent-delete race (P2025) to NotFound instead of a 500', async () => {
      mockedDb.findingTemplate.findUnique.mockResolvedValue(
        template({ organizationId: ORG }),
      );
      mockedDb.findingTemplate.delete.mockRejectedValue(
        Object.assign(new Error('Record to update not found.'), {
          code: 'P2025',
        }),
      );

      await expect(
        service.deleteById({ id: 'fnd_t_abc123', organizationId: ORG }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
