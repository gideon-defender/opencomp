import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { db } from '@db';
import { CreateFindingTemplateDto } from './dto/create-finding-template.dto';
import { UpdateFindingTemplateDto } from './dto/update-finding-template.dto';

@Injectable()
export class FindingTemplateService {
  private readonly logger = new Logger(FindingTemplateService.name);

  /**
   * Templates visible to an org: global templates (organizationId null)
   * plus that org's own templates. Other orgs' templates never leak.
   */
  async findAll({ organizationId }: { organizationId: string }) {
    const templates = await db.findingTemplate.findMany({
      where: {
        OR: [{ organizationId: null }, { organizationId }],
      },
      orderBy: [{ category: 'asc' }, { order: 'asc' }, { title: 'asc' }],
    });

    this.logger.log(
      `Retrieved ${templates.length} finding templates for organization ${organizationId}`,
    );
    return templates;
  }

  async findById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }) {
    const template = await db.findingTemplate.findUnique({
      where: { id },
    });

    if (
      !template ||
      !this.isVisibleTo(template.organizationId, organizationId)
    ) {
      throw new NotFoundException(`Finding template with ID ${id} not found`);
    }

    return template;
  }

  /** Creates a per-org template. Global templates are never created via API. */
  async create({
    organizationId,
    createDto,
  }: {
    organizationId: string;
    createDto: CreateFindingTemplateDto;
  }) {
    const template = await db.findingTemplate.create({
      data: {
        category: createDto.category,
        title: createDto.title,
        content: createDto.content,
        order: createDto.order ?? 0,
        organizationId,
      },
    });

    this.logger.log(
      `Created finding template: ${template.title} (${template.id}) for organization ${organizationId}`,
    );
    return template;
  }

  async updateById({
    id,
    organizationId,
    updateDto,
  }: {
    id: string;
    organizationId: string;
    updateDto: UpdateFindingTemplateDto;
  }) {
    const existing = await this.findById({ id, organizationId });
    this.rejectGlobalWrite(existing.organizationId, 'update');

    try {
      const updatedTemplate = await db.findingTemplate.update({
        where: { id },
        data: updateDto,
      });

      this.logger.log(
        `Updated finding template: ${updatedTemplate.title} (${id})`,
      );
      return updatedTemplate;
    } catch (error) {
      // A concurrent delete between the visibility check and this write
      // surfaces as P2025 — report the same 404 as a missing row, not a 500.
      if ((error as { code?: string }).code === 'P2025') {
        throw new NotFoundException(`Finding template with ID ${id} not found`);
      }
      throw error;
    }
  }

  async deleteById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }) {
    const existing = await this.findById({ id, organizationId });
    this.rejectGlobalWrite(existing.organizationId, 'delete');

    try {
      await db.findingTemplate.delete({
        where: { id },
      });
    } catch (error) {
      // Same concurrent-delete race as updateById — stay a 404, not a 500.
      if ((error as { code?: string }).code === 'P2025') {
        throw new NotFoundException(`Finding template with ID ${id} not found`);
      }
      throw error;
    }

    this.logger.log(`Deleted finding template: ${existing.title} (${id})`);
    return {
      message: 'Finding template deleted successfully',
      deletedTemplate: {
        id: existing.id,
        title: existing.title,
      },
    };
  }

  private isVisibleTo(
    templateOrgId: string | null,
    organizationId: string,
  ): boolean {
    return templateOrgId === null || templateOrgId === organizationId;
  }

  /**
   * Global templates are shared across orgs — one org must not rename or
   * remove them for everyone. They stay visible (listable) so the error
   * names the rule instead of pretending the row is missing.
   */
  private rejectGlobalWrite(
    templateOrgId: string | null,
    action: 'update' | 'delete',
  ): void {
    if (templateOrgId === null) {
      throw new ForbiddenException(
        `Global finding templates cannot be ${action}d. Create a per-org copy instead.`,
      );
    }
  }
}
