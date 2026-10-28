import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { OrganizationId } from '../auth/auth-context.decorator';
import { CloudSecurityQueryService } from './cloud-security-query.service';
import { CloudSecurityActivityService } from './cloud-security-activity.service';
import { CheckDefinitionService } from './check-definition.service';
import { CloudExceptionService } from './exception.service';
import { CloudHistoryService } from './history.service';
import { CloudAwsScanModeService } from './aws-scan-mode.service';
import { parseExceptionExpiry } from './exception-expiry.utils';
import { MarkExceptionDto } from './dto/mark-exception.dto';
import { UpdateAwsScanModeDto } from './dto/update-scan-mode.dto';
import { ActingUserResolver } from '../auth/acting-user.service';
import type { AuthenticatedRequest } from '../auth/types';
import { ApiAuthErrors } from '../openapi/common-responses';

@ApiTags('CloudSecurity')
@Controller({ path: 'cloud-security', version: '1' })
export class CloudSecurityController {
  constructor(
    private readonly queryService: CloudSecurityQueryService,
    private readonly activityService: CloudSecurityActivityService,
    private readonly checkDefinitionService: CheckDefinitionService,
    private readonly exceptionService: CloudExceptionService,
    private readonly historyService: CloudHistoryService,
    private readonly scanModeService: CloudAwsScanModeService,
    private readonly actingUser: ActingUserResolver,
  ) {}

  @Get('activity')
  @SkipThrottle()
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'read')
  @ApiOperation({ summary: 'List recent cloud security activity' })
  @ApiQuery({
    name: 'take',
    required: false,
    description: 'Number of activity records to return (1-100, default 30)',
    type: String,
  })
  @ApiOkResponse({
    description: 'Recent cloud security activity retrieved successfully',
  })
  @ApiAuthErrors()
  async getActivity(
    @Query('connectionId') connectionId: string,
    @Query('take') take: string | undefined,
    @OrganizationId() organizationId: string,
  ) {
    if (!connectionId) {
      throw new HttpException(
        'connectionId query parameter is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const parsedTake = take
      ? Math.min(100, Math.max(1, parseInt(take, 10) || 30))
      : 30;

    const activity = await this.activityService.getActivity({
      connectionId,
      organizationId,
      take: parsedTake,
    });

    return { data: activity, count: activity.length };
  }

  @Get('providers')
  @SkipThrottle()
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'read')
  @ApiOperation({ summary: 'List supported cloud providers' })
  @ApiOkResponse({
    description: 'Supported cloud providers retrieved successfully',
  })
  @ApiAuthErrors()
  async getProviders(@OrganizationId() organizationId: string) {
    const providers = await this.queryService.getProviders(organizationId);
    return { data: providers, count: providers.length };
  }

  @Get('findings')
  @SkipThrottle()
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'read')
  @ApiOperation({ summary: 'List cloud security findings' })
  @ApiOkResponse({
    description: 'Cloud security findings retrieved successfully',
  })
  @ApiAuthErrors()
  async getFindings(@OrganizationId() organizationId: string) {
    const findings = await this.queryService.getFindings(organizationId);
    return { data: findings, count: findings.length };
  }

  @Post('findings/:findingId/exception')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'update')
  @ApiOperation({
    summary:
      'Mark a finding as an exception so it no longer appears in the active Scan Results list',
    description:
      'Accepts session, API key, or service token auth. For API key / service token callers ' +
      "without an explicit user attribution, the action is attributed to the org's owner and " +
      'the audit log description records the calling key/service name.',
  })
  @ApiCreatedResponse({
    description:
      'Mark a finding as an exception so it no longer appears in the active Scan Results list completed successfully',
  })
  @ApiAuthErrors()
  async markFindingAsException(
    @Param('findingId') findingId: string,
    @Body() body: MarkExceptionDto,
    @OrganizationId() organizationId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const acting = await this.actingUser.resolve(req, organizationId);
    if (!acting.userId) {
      throw new HttpException(
        'Cannot attribute this action — your organization must have at least one user with the "owner" role.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = await this.exceptionService.markAsException({
      findingId,
      organizationId,
      userId: acting.userId,
      reason: body.reason,
      reviewedBy: body.reviewedBy ?? null,
      expiresAt: parseExceptionExpiry(body.expiresAt),
      callerLabel: acting.callerLabel,
    });
    return { data: result };
  }

  @Patch('connections/:connectionId/scan-mode')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'update')
  @ApiOperation({
    summary:
      'Switch the AWS scan engine for a connection (OpenComp scanners ↔ Security Hub)',
    description:
      'Accepts session, API key, or service token auth. For API key / service token callers ' +
      "without an explicit user attribution, the action is attributed to the org's owner.",
  })
  @ApiOkResponse({
    description:
      'Switch the AWS scan engine for a connection (OpenComp scanners ↔ Security Hub) completed successfully',
  })
  @ApiAuthErrors()
  async updateAwsScanMode(
    @Param('connectionId') connectionId: string,
    @Body() body: UpdateAwsScanModeDto,
    @OrganizationId() organizationId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const acting = await this.actingUser.resolve(req, organizationId);
    if (!acting.userId) {
      throw new HttpException(
        'Cannot attribute this action — your organization must have at least one user with the "owner" role.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = await this.scanModeService.updateMode({
      connectionId,
      organizationId,
      userId: acting.userId,
      mode: body.mode,
      callerLabel: acting.callerLabel,
    });
    return { data: result };
  }

  @Delete('exceptions/:exceptionId')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'update')
  @ApiOperation({
    summary: 'Revoke an exception, reopening the finding',
    description:
      'Accepts session, API key, or service token auth. For API key / service token callers ' +
      "without an explicit user attribution, the action is attributed to the org's owner.",
  })
  @ApiOkResponse({
    description: 'An exception, reopening the finding revoked successfully',
  })
  @ApiAuthErrors()
  async revokeException(
    @Param('exceptionId') exceptionId: string,
    @OrganizationId() organizationId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const acting = await this.actingUser.resolve(req, organizationId);
    if (!acting.userId) {
      throw new HttpException(
        'Cannot attribute this action — your organization must have at least one user with the "owner" role.',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.exceptionService.revokeException({
      exceptionId,
      organizationId,
      userId: acting.userId,
      callerLabel: acting.callerLabel,
    });
    return { success: true };
  }

  @Get('history')
  @SkipThrottle()
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'read')
  @ApiOperation({
    summary:
      'List resolution, exception, and regression history for a connection',
  })
  @ApiOkResponse({
    description:
      'Resolution, exception, and regression history for a connection retrieved successfully',
  })
  @ApiAuthErrors()
  async getHistory(
    @Query('connectionId') connectionId: string,
    @OrganizationId() organizationId: string,
  ) {
    if (!connectionId) {
      throw new HttpException(
        'connectionId query parameter is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const history = await this.historyService.getHistory({
      organizationId,
      connectionId,
    });
    return { data: history };
  }

  @Get('findings/:findingId/check-definition')
  @SkipThrottle()
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'read')
  @ApiOperation({
    summary:
      'Resolve the "About this check" description for a finding (AI-cached for AWS; provider-derived for GCP/Azure)',
  })
  @ApiOkResponse({
    description:
      'Resolve the "About this check" description for a finding (AI-cached for AWS; provider-derived for GCP/Azure) completed successfully',
  })
  @ApiAuthErrors()
  async getCheckDefinition(
    @Param('findingId') findingId: string,
    @OrganizationId() organizationId: string,
  ) {
    const definition = await this.checkDefinitionService.getForFinding(
      findingId,
      organizationId,
    );
    return { data: definition };
  }
}
