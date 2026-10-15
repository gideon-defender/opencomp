import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtension,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthContext, OrganizationId } from '../auth/auth-context.decorator';
import { AuditRead } from '../audit/skip-audit-log.decorator';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import type { AuthContext as AuthContextType } from '../auth/types';
import { statement } from '@gideon-defender/auth';
import { PeopleResponseDto, UserResponseDto } from './dto/people-responses.dto';
import { UpdateEmailPreferencesDto } from './dto/update-email-preferences.dto';
import { AttachmentsService } from '../attachments/attachments.service';
import { UploadAttachmentDto } from '../attachments/upload-attachment.dto';
import { AttachmentEntityType } from '@db';
import { PeopleService } from './people.service';
import { PeopleAccessService } from './people-access.service';
import { GET_ALL_PEOPLE_RESPONSES } from './schemas/get-all-people.responses';
import { GET_PERSON_BY_ID_RESPONSES } from './schemas/get-person-by-id.responses';
import { REMOVE_HOST_RESPONSES } from './schemas/remove-host.responses';
import { UNLINK_DEVICE_RESPONSES } from './schemas/unlink-device.responses';
import { PEOPLE_OPERATIONS } from './schemas/people-operations';
import { PEOPLE_PARAMS } from './schemas/people-params';

import { authEnvelope } from '@/utils/auth-response';
import { ApiAuthErrors, ApiForbiddenError } from '../openapi/common-responses';
@ApiTags('People')
@ApiExtraModels(PeopleResponseDto, UserResponseDto)
@Controller({ path: 'people', version: '1' })
@UseGuards(HybridAuthGuard, PermissionGuard)
@ApiSecurity('apikey')
export class PeopleController {
  constructor(
    private readonly peopleService: PeopleService,
    private readonly peopleAccessService: PeopleAccessService,
    private readonly attachmentsService: AttachmentsService,
  ) {}

  private resolveEventType(eventType: string): AttachmentEntityType {
    if (eventType === 'onboard') return AttachmentEntityType.employment_onboard;
    if (eventType === 'offboard')
      return AttachmentEntityType.employment_offboard;
    throw new BadRequestException(
      `Invalid event type "${eventType}". Must be "onboard" or "offboard".`,
    );
  }

  @Get()
  @RequirePermission('member', 'read')
  @ApiOperation(PEOPLE_OPERATIONS.getAllPeople)
  @ApiExtension('x-comp-mcp', { name: 'list-members' })
  @ApiResponse(GET_ALL_PEOPLE_RESPONSES[200])
  @ApiResponse(GET_ALL_PEOPLE_RESPONSES[401])
  @ApiResponse(GET_ALL_PEOPLE_RESPONSES[404])
  @ApiResponse(GET_ALL_PEOPLE_RESPONSES[500])
  @ApiForbiddenError()
  async getAllPeople(
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
    @Query('includeDeactivated') includeDeactivated?: string,
    @Query('onboardAfter') onboardAfter?: string,
    @Query('onboardBefore') onboardBefore?: string,
    @Query('offboardAfter') offboardAfter?: string,
    @Query('offboardBefore') offboardBefore?: string,
  ) {
    const parseDateParam = (
      param: string | undefined,
      name: string,
    ): Date | undefined => {
      if (!param) return undefined;
      const date = new Date(param);
      if (isNaN(date.getTime())) {
        throw new BadRequestException(
          `Invalid date value for "${name}": ${param}`,
        );
      }
      return date;
    };

    const filters = {
      ...(onboardAfter
        ? { onboardAfter: parseDateParam(onboardAfter, 'onboardAfter') }
        : {}),
      ...(onboardBefore
        ? { onboardBefore: parseDateParam(onboardBefore, 'onboardBefore') }
        : {}),
      ...(offboardAfter
        ? { offboardAfter: parseDateParam(offboardAfter, 'offboardAfter') }
        : {}),
      ...(offboardBefore
        ? { offboardBefore: parseDateParam(offboardBefore, 'offboardBefore') }
        : {}),
    };

    const hasFilters = Object.keys(filters).length > 0;

    const people = await this.peopleService.findAllByOrganization(
      organizationId,
      includeDeactivated === 'true',
      hasFilters ? filters : undefined,
    );

    return {
      data: people,
      count: people.length,
      ...authEnvelope(authContext),
    };
  }

  @Get('devices')
  @RequirePermission('member', 'read')
  @ApiOperation({
    summary: 'Get all employee devices with fleet compliance data',
  })
  @ApiOkResponse({
    description:
      'All employee devices with fleet compliance data retrieved successfully',
  })
  @ApiAuthErrors()
  async getDevices(
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const devices = await this.peopleService.getDevices(organizationId);

    return {
      data: devices,
      ...authEnvelope(authContext),
    };
  }

  @Get('test-stats/by-assignee')
  @RequirePermission('member', 'read')
  @ApiOperation({
    summary: 'Get integration test statistics grouped by assignee',
  })
  @ApiOkResponse({
    description:
      'Integration test statistics grouped by assignee retrieved successfully',
  })
  @ApiAuthErrors()
  async getTestStatsByAssignee(
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const data =
      await this.peopleService.getTestStatsByAssignee(organizationId);

    return {
      data,
      ...authEnvelope(authContext),
    };
  }

  @Get('mentionable')
  @RequirePermission('member', 'read')
  @ApiOperation({
    summary: 'Get members who can read a specific resource type',
  })
  @ApiOkResponse({
    description:
      'Members who can read a specific resource type retrieved successfully',
  })
  @ApiAuthErrors()
  async getMentionableMembers(
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
    @Query('resource') resource: string,
  ) {
    if (!resource) {
      throw new BadRequestException('Query parameter "resource" is required');
    }

    const validResources = Object.keys(statement);
    if (!validResources.includes(resource)) {
      throw new BadRequestException(
        `Invalid resource: "${resource}". Valid resources: ${validResources.join(', ')}`,
      );
    }

    const members = await this.peopleService.findMentionableMembers(
      organizationId,
      resource,
    );

    return {
      data: members,
      count: members.length,
      ...authEnvelope(authContext),
    };
  }

  @Get(':id')
  @AuditRead()
  @RequirePermission('member', 'read')
  @ApiOperation(PEOPLE_OPERATIONS.getPersonById)
  @ApiParam(PEOPLE_PARAMS.memberId)
  @ApiExtension('x-comp-mcp', { name: 'get-member' })
  @ApiResponse(GET_PERSON_BY_ID_RESPONSES[200])
  @ApiResponse(GET_PERSON_BY_ID_RESPONSES[401])
  @ApiResponse(GET_PERSON_BY_ID_RESPONSES[404])
  @ApiResponse(GET_PERSON_BY_ID_RESPONSES[500])
  @ApiForbiddenError()
  async getPersonById(
    @Param('id') memberId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const person = await this.peopleService.findById(memberId, organizationId);

    return {
      ...person,
      ...authEnvelope(authContext),
    };
  }

  @Get(':id/access')
  @RequirePermission('member', 'read')
  @ApiOperation({
    summary: "Member's access across connected integrations",
    description:
      'Aggregates the latest Employee Access check results from every connected integration bound to the Employee Access task, matched to the member by email.',
  })
  @ApiParam(PEOPLE_PARAMS.memberId)
  @ApiOkResponse({
    description:
      "Member's access across connected integrations completed successfully",
  })
  @ApiAuthErrors()
  async getMemberAccess(
    @Param('id') memberId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const data = await this.peopleAccessService.getMemberAccess(
      organizationId,
      memberId,
    );

    return {
      data,
      ...authEnvelope(authContext),
    };
  }

  @Get(':id/training-videos')
  @RequirePermission('member', 'read')
  @ApiOperation({ summary: 'Get training video completions for a member' })
  @ApiParam(PEOPLE_PARAMS.memberId)
  @ApiOkResponse({
    description:
      'Training video completions for a member retrieved successfully',
  })
  @ApiAuthErrors()
  async getTrainingVideos(
    @Param('id') memberId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const data = await this.peopleService.getTrainingVideos(
      memberId,
      organizationId,
    );

    return {
      data,
      ...authEnvelope(authContext),
    };
  }

  @Get(':id/fleet-compliance')
  @RequirePermission('member', 'read')
  @ApiOperation({ summary: 'Get fleet/device compliance for a member' })
  @ApiParam(PEOPLE_PARAMS.memberId)
  @ApiOkResponse({ description: 'Fleet compliance retrieved successfully' })
  @ApiAuthErrors()
  async getFleetCompliance(
    @Param('id') memberId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const data = await this.peopleService.getFleetCompliance(
      memberId,
      organizationId,
    );

    return {
      ...data,
      ...authEnvelope(authContext),
    };
  }

  @Delete(':id/host/:hostId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('member', 'delete')
  @ApiOperation(PEOPLE_OPERATIONS.removeHost)
  @ApiParam(PEOPLE_PARAMS.memberId)
  @ApiParam(PEOPLE_PARAMS.hostId)
  @ApiResponse(REMOVE_HOST_RESPONSES[200])
  @ApiResponse(REMOVE_HOST_RESPONSES[401])
  @ApiResponse(REMOVE_HOST_RESPONSES[404])
  @ApiResponse(REMOVE_HOST_RESPONSES[500])
  @ApiForbiddenError()
  async removeHost(
    @Param('id') memberId: string,
    @Param('hostId', ParseIntPipe) hostId: number,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const result = await this.peopleService.removeHostById(
      memberId,
      organizationId,
      hostId,
    );

    return {
      ...result,
      ...authEnvelope(authContext),
    };
  }

  @Patch(':id/unlink-device')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('member', 'update')
  @ApiOperation(PEOPLE_OPERATIONS.unlinkDevice)
  @ApiParam(PEOPLE_PARAMS.memberId)
  @ApiResponse(UNLINK_DEVICE_RESPONSES[200])
  @ApiResponse(UNLINK_DEVICE_RESPONSES[400])
  @ApiResponse(UNLINK_DEVICE_RESPONSES[401])
  @ApiResponse(UNLINK_DEVICE_RESPONSES[404])
  @ApiResponse(UNLINK_DEVICE_RESPONSES[500])
  @ApiForbiddenError()
  async unlinkDevice(
    @Param('id') memberId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const updatedMember = await this.peopleService.unlinkDevice(
      memberId,
      organizationId,
    );

    return {
      ...updatedMember,
      ...authEnvelope(authContext),
    };
  }

  @Get(':id/employment-evidence/:eventType')
  @RequirePermission('member', 'read')
  @ApiOperation({ summary: 'Get employment evidence attachments' })
  @ApiParam(PEOPLE_PARAMS.memberId)
  @ApiParam({ name: 'eventType', enum: ['onboard', 'offboard'] })
  @ApiOkResponse({
    description: 'Employment evidence attachments retrieved successfully',
  })
  @ApiAuthErrors()
  async getEmploymentEvidence(
    @Param('id') memberId: string,
    @Param('eventType') eventType: string,
    @OrganizationId() organizationId: string,
  ) {
    const entityType = this.resolveEventType(eventType);
    await this.peopleService.findById(memberId, organizationId);
    return this.attachmentsService.getAttachments(
      organizationId,
      memberId,
      entityType,
    );
  }

  @Post(':id/employment-evidence/:eventType')
  @RequirePermission('member', 'update')
  @ApiOperation({ summary: 'Upload employment evidence' })
  @ApiParam(PEOPLE_PARAMS.memberId)
  @ApiParam({ name: 'eventType', enum: ['onboard', 'offboard'] })
  @ApiCreatedResponse({
    description: 'Employment evidence uploaded successfully',
  })
  @ApiAuthErrors()
  async uploadEmploymentEvidence(
    @Param('id') memberId: string,
    @Param('eventType') eventType: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
    @Body() uploadDto: UploadAttachmentDto,
  ) {
    if (!authContext.userId) {
      throw new BadRequestException('User context required for this operation');
    }
    const entityType = this.resolveEventType(eventType);
    await this.peopleService.findById(memberId, organizationId);
    return this.attachmentsService.uploadAttachment(
      organizationId,
      memberId,
      entityType,
      uploadDto,
      authContext.userId,
    );
  }

  @Delete(':id/employment-evidence/:eventType/:attachmentId')
  @RequirePermission('member', 'delete')
  @ApiOperation({ summary: 'Delete employment evidence' })
  @ApiParam(PEOPLE_PARAMS.memberId)
  @ApiParam({ name: 'eventType', enum: ['onboard', 'offboard'] })
  @ApiParam({ name: 'attachmentId', description: 'Attachment ID' })
  @ApiOkResponse({ description: 'Employment evidence deleted successfully' })
  @ApiAuthErrors()
  async deleteEmploymentEvidence(
    @Param('id') memberId: string,
    @Param('eventType') eventType: string,
    @Param('attachmentId') attachmentId: string,
    @OrganizationId() organizationId: string,
  ) {
    const entityType = this.resolveEventType(eventType);
    await this.peopleService.findById(memberId, organizationId);
    const attachments = await this.attachmentsService.getAttachments(
      organizationId,
      memberId,
      entityType,
    );
    if (!attachments.some((a) => a.id === attachmentId)) {
      throw new BadRequestException(
        'Attachment not found for this member and event type',
      );
    }
    await this.attachmentsService.deleteAttachment(
      organizationId,
      attachmentId,
    );
    return { success: true };
  }

  @Get('me/email-preferences')
  @ApiOperation({ summary: 'Get current user email notification preferences' })
  @ApiOkResponse({
    description:
      'Current user email notification preferences retrieved successfully',
  })
  @ApiAuthErrors()
  async getEmailPreferences(
    @AuthContext() authContext: AuthContextType,
    @OrganizationId() organizationId: string,
  ) {
    if (!authContext.userId) {
      throw new BadRequestException(
        'User ID is required. This endpoint requires session authentication.',
      );
    }

    return this.peopleService.getEmailPreferences(
      authContext.userId,
      authContext.userEmail!,
      organizationId,
    );
  }

  @Put('me/email-preferences')
  @ApiOperation({
    summary: 'Update current user email notification preferences',
  })
  @ApiOkResponse({
    description:
      'Current user email notification preferences updated successfully',
  })
  @ApiAuthErrors()
  async updateEmailPreferences(
    @AuthContext() authContext: AuthContextType,
    @Body() body: UpdateEmailPreferencesDto,
  ) {
    if (!authContext.userId) {
      throw new BadRequestException(
        'User ID is required. This endpoint requires session authentication.',
      );
    }

    return this.peopleService.updateEmailPreferences(authContext.userId, {
      ...body.preferences,
    });
  }
}
