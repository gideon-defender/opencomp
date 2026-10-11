import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { OrganizationId } from '../auth/auth-context.decorator';
import { FindingTemplateService } from './finding-template.service';
import { CreateFindingTemplateDto } from './dto/create-finding-template.dto';
import { UpdateFindingTemplateDto } from './dto/update-finding-template.dto';
import { ValidateFindingTemplateIdPipe } from './pipes/validate-id.pipe';

@ApiTags('Finding Templates')
@ApiSecurity('apikey')
@Controller({ path: 'finding-template', version: '1' })
@UseGuards(HybridAuthGuard)
export class FindingTemplateController {
  constructor(
    private readonly findingTemplateService: FindingTemplateService,
  ) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('finding', 'read')
  @ApiOperation({
    summary: 'List finding templates for the organization',
    description:
      'Returns global templates plus this organization\u2019s own templates, ordered by category. Use to populate the finding template picker.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of finding templates',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async getAllFindingTemplates(@OrganizationId() organizationId: string) {
    return await this.findingTemplateService.findAll({ organizationId });
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('finding', 'read')
  @ApiOperation({
    summary: 'Get a finding template by ID',
    description:
      'Returns one global or own-org finding template. Templates from other orgs return 404.',
  })
  @ApiParam({
    name: 'id',
    description: 'Finding template ID',
    example: 'fnd_t_abc123',
  })
  @ApiResponse({
    status: 200,
    description: 'The finding template',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Finding template not found',
  })
  async getFindingTemplateById(
    @Param('id', ValidateFindingTemplateIdPipe) id: string,
    @OrganizationId() organizationId: string,
  ) {
    return await this.findingTemplateService.findById({ id, organizationId });
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission('finding', 'update')
  @ApiOperation({
    summary: 'Create a per-org finding template',
    description:
      'Creates a finding template owned by the caller\u2019s organization. Member admins manage their org\u2019s templates here.',
  })
  @ApiBody({
    type: CreateFindingTemplateDto,
    description: 'Finding template data',
  })
  @ApiResponse({
    status: 201,
    description: 'The created finding template',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden - template management requires finding update access',
  })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async createFindingTemplate(
    @Body() createDto: CreateFindingTemplateDto,
    @OrganizationId() organizationId: string,
  ) {
    return await this.findingTemplateService.create({
      organizationId,
      createDto,
    });
  }

  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('finding', 'update')
  @ApiOperation({
    summary: 'Update a per-org finding template',
    description:
      'Updates an own-org finding template. Global templates cannot be changed; copy one first.',
  })
  @ApiParam({
    name: 'id',
    description: 'Finding template ID',
    example: 'fnd_t_abc123',
  })
  @ApiBody({
    type: UpdateFindingTemplateDto,
    description: 'Finding template update data',
  })
  @ApiResponse({
    status: 200,
    description: 'The updated finding template',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - global templates cannot be changed',
  })
  @ApiResponse({
    status: 404,
    description: 'Finding template not found',
  })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async updateFindingTemplate(
    @Param('id', ValidateFindingTemplateIdPipe) id: string,
    @Body() updateDto: UpdateFindingTemplateDto,
    @OrganizationId() organizationId: string,
  ) {
    return await this.findingTemplateService.updateById({
      id,
      organizationId,
      updateDto,
    });
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('finding', 'update')
  @ApiOperation({
    summary: 'Delete a per-org finding template',
    description:
      'Deletes an own-org finding template. Findings already raised from it keep their content.',
  })
  @ApiParam({
    name: 'id',
    description: 'Finding template ID',
    example: 'fnd_t_abc123',
  })
  @ApiResponse({
    status: 200,
    description: 'Finding template deleted successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - global templates cannot be deleted',
  })
  @ApiResponse({
    status: 404,
    description: 'Finding template not found',
  })
  async deleteFindingTemplate(
    @Param('id', ValidateFindingTemplateIdPipe) id: string,
    @OrganizationId() organizationId: string,
  ) {
    return await this.findingTemplateService.deleteById({
      id,
      organizationId,
    });
  }
}
