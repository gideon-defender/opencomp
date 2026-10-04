import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
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
import { Throttle } from '@nestjs/throttler';
import {
  ApproveAccessRequestDto,
  CreateAccessRequestDto,
  DenyAccessRequestDto,
  ListAccessRequestsDto,
  RevokeGrantDto,
} from './dto/trust-access.dto';
import { TrustAccessService } from './trust-access.service';
import { getRequestIp, getRequestUserId } from './trust-access-request.utils';
import { ApiAuthErrors, ApiNotFoundError } from '../openapi/common-responses';
@ApiTags('Trust Access')
// Public portal routes send emails and mint tokens: hold them below the
// global limit so one client cannot spam org inboxes or enumerate grants.
@Throttle({ default: { ttl: 60000, limit: 60 } })
@Controller({ path: 'trust-access', version: '1' })
export class TrustAccessRequestController {
  constructor(private readonly trustAccessService: TrustAccessService) {}

  @Post(':friendlyUrl/requests')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    operationId: 'TrustAccessController_createAccessRequest_v1',
    summary: 'Submit data access request',
    description:
      'External users submit request for data access from trust site',
  })
  @ApiParam({
    name: 'friendlyUrl',
    description: 'Trust Portal friendly URL or Organization ID',
  })
  @ApiBody({ type: CreateAccessRequestDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Access request created and sent for review',
  })
  @ApiNotFoundError('Trust portal not found')
  async createAccessRequest(
    // Note: friendlyUrl can be either the custom friendly URL or the organization ID
    @Param('friendlyUrl') friendlyUrl: string,
    @Body() dto: CreateAccessRequestDto,
    @Req() req: Request,
  ) {
    const ipAddress = getRequestIp(req);
    const userAgent =
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : undefined;

    return this.trustAccessService.createAccessRequest(
      friendlyUrl,
      dto,
      ipAddress,
      userAgent,
    );
  }

  @Get('admin/requests')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('trust', 'read')
  @ApiSecurity('apikey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_listAccessRequests_v1',
    summary: 'List access requests',
    description: 'Get all access requests for organization',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Access requests retrieved',
  })
  @ApiAuthErrors()
  async listAccessRequests(
    @OrganizationId() organizationId: string,
    @Query() dto: ListAccessRequestsDto,
  ) {
    return this.trustAccessService.listAccessRequests(organizationId, dto);
  }

  @Get('admin/requests/:id')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('trust', 'read')
  @ApiSecurity('apikey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getAccessRequest_v1',
    summary: 'Get access request details',
    description: 'Get detailed information about a specific access request',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Request details returned',
  })
  @ApiAuthErrors()
  async getAccessRequest(
    @OrganizationId() organizationId: string,
    @Param('id') requestId: string,
  ) {
    return this.trustAccessService.getAccessRequest(organizationId, requestId);
  }

  @Post('admin/requests/:id/approve')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('trust', 'update')
  @ApiSecurity('apikey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_approveRequest_v1',
    summary: 'Approve access request',
    description: 'Approve request and create time-limited grant',
  })
  @ApiBody({ type: ApproveAccessRequestDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Request approved successfully',
  })
  @ApiAuthErrors()
  async approveRequest(
    @OrganizationId() organizationId: string,
    @Param('id') requestId: string,
    @Body() dto: ApproveAccessRequestDto,
    @Req() req: Request,
  ) {
    const userId = getRequestUserId(req);
    if (!userId) {
      throw new UnauthorizedException('User ID is required');
    }
    const memberId = await this.trustAccessService.getMemberIdFromUserId(
      userId,
      organizationId,
    );
    return this.trustAccessService.approveRequest(
      organizationId,
      requestId,
      dto,
      memberId,
    );
  }

  @Post('admin/requests/:id/deny')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('trust', 'update')
  @ApiSecurity('apikey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_denyRequest_v1',
    summary: 'Deny access request',
    description: 'Reject access request with reason',
  })
  @ApiBody({ type: DenyAccessRequestDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Request denied' })
  @ApiAuthErrors()
  async denyRequest(
    @OrganizationId() organizationId: string,
    @Param('id') requestId: string,
    @Body() dto: DenyAccessRequestDto,
    @Req() req: Request,
  ) {
    const userId = getRequestUserId(req);
    if (!userId) {
      throw new UnauthorizedException('User ID is required');
    }
    const memberId = await this.trustAccessService.getMemberIdFromUserId(
      userId,
      organizationId,
    );
    return this.trustAccessService.denyRequest(
      organizationId,
      requestId,
      dto,
      memberId,
    );
  }

  @Get('admin/grants')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('trust', 'read')
  @ApiSecurity('apikey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_listGrants_v1',
    summary: 'List access grants',
    description: 'Get all active and expired grants',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Grants retrieved' })
  @ApiAuthErrors()
  async listGrants(@OrganizationId() organizationId: string) {
    return this.trustAccessService.listGrants(organizationId);
  }

  @Post('admin/grants/:id/revoke')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('trust', 'update')
  @ApiSecurity('apikey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_revokeGrant_v1',
    summary: 'Revoke access grant',
    description: 'Immediately revoke active grant',
  })
  @ApiBody({ type: RevokeGrantDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Grant revoked' })
  @ApiAuthErrors()
  async revokeGrant(
    @OrganizationId() organizationId: string,
    @Param('id') grantId: string,
    @Body() dto: RevokeGrantDto,
    @Req() req: Request,
  ) {
    const userId = getRequestUserId(req);
    if (!userId) {
      throw new UnauthorizedException('User ID is required');
    }
    const memberId = await this.trustAccessService.getMemberIdFromUserId(
      userId,
      organizationId,
    );
    return this.trustAccessService.revokeGrant(
      organizationId,
      grantId,
      dto,
      memberId,
    );
  }

  @Post('admin/requests/:id/resend-nda')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('trust', 'update')
  @ApiSecurity('apikey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_resendNda_v1',
    summary: 'Resend NDA email',
    description: 'Resend NDA signing email to requester',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'NDA email resent',
  })
  @ApiAuthErrors()
  async resendNda(
    @OrganizationId() organizationId: string,
    @Param('id') requestId: string,
  ) {
    return this.trustAccessService.resendNda(organizationId, requestId);
  }
}
