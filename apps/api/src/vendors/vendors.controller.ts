import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthContext, OrganizationId } from '../auth/auth-context.decorator';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { SkipOrgCheck } from '../auth/skip-org-check.decorator';
import { ActingUserResolver } from '../auth/acting-user.service';
import type {
  AuthContext as AuthContextType,
  AuthenticatedRequest,
} from '../auth/types';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { VendorsService } from './vendors.service';
import { VENDOR_OPERATIONS } from './schemas/vendor-operations';
import { VENDOR_PARAMS } from './schemas/vendor-params';
import { VENDOR_BODIES } from './schemas/vendor-bodies';
import { GET_ALL_VENDORS_RESPONSES } from './schemas/get-all-vendors.responses';
import { GET_VENDOR_BY_ID_RESPONSES } from './schemas/get-vendor-by-id.responses';
import { CREATE_VENDOR_RESPONSES } from './schemas/create-vendor.responses';
import { UPDATE_VENDOR_RESPONSES } from './schemas/update-vendor.responses';
import { DELETE_VENDOR_RESPONSES } from './schemas/delete-vendor.responses';

import { authEnvelope } from '@/utils/auth-response';
import { ApiAuthErrors, ApiForbiddenError } from '../openapi/common-responses';
@ApiTags('Vendors')
@Controller({ path: 'vendors', version: '1' })
@UseGuards(HybridAuthGuard, PermissionGuard)
@ApiSecurity('apikey')
export class VendorsController {
  constructor(
    private readonly vendorsService: VendorsService,
    private readonly actingUser: ActingUserResolver,
  ) {}

  @Get('global/search')
  @SkipOrgCheck()
  @ApiOperation({
    summary: 'Search global vendors database',
    description:
      'Requires session, no active org needed — used during onboarding.',
  })
  @ApiQuery({
    name: 'name',
    required: false,
    description: 'Vendor name to search for',
  })
  @ApiOkResponse({ description: 'Global vendors retrieved successfully' })
  @ApiAuthErrors()
  async searchGlobalVendors(@Query('name') name?: string) {
    return this.vendorsService.searchGlobal(name ?? '');
  }

  @Get()
  @RequirePermission('vendor', 'read')
  @ApiOperation(VENDOR_OPERATIONS.getAllVendors)
  @ApiResponse(GET_ALL_VENDORS_RESPONSES[200])
  @ApiResponse(GET_ALL_VENDORS_RESPONSES[401])
  @ApiResponse(GET_ALL_VENDORS_RESPONSES[404])
  @ApiResponse(GET_ALL_VENDORS_RESPONSES[500])
  @ApiForbiddenError()
  async getAllVendors(
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const vendors =
      await this.vendorsService.findAllByOrganization(organizationId);

    return {
      data: vendors,
      count: vendors.length,
      ...authEnvelope(authContext),
    };
  }

  @Get(':id')
  @RequirePermission('vendor', 'read')
  @ApiOperation(VENDOR_OPERATIONS.getVendorById)
  @ApiParam(VENDOR_PARAMS.vendorId)
  @ApiResponse(GET_VENDOR_BY_ID_RESPONSES[200])
  @ApiResponse(GET_VENDOR_BY_ID_RESPONSES[401])
  @ApiResponse(GET_VENDOR_BY_ID_RESPONSES[404])
  @ApiResponse(GET_VENDOR_BY_ID_RESPONSES[500])
  @ApiForbiddenError()
  async getVendorById(
    @Param('id') vendorId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const vendor = await this.vendorsService.findById(vendorId, organizationId);

    return {
      ...vendor,
      ...authEnvelope(authContext),
    };
  }

  @Post()
  @RequirePermission('vendor', 'create')
  @ApiOperation(VENDOR_OPERATIONS.createVendor)
  @ApiBody(VENDOR_BODIES.createVendor)
  @ApiResponse(CREATE_VENDOR_RESPONSES[201])
  @ApiResponse(CREATE_VENDOR_RESPONSES[400])
  @ApiResponse(CREATE_VENDOR_RESPONSES[401])
  @ApiResponse(CREATE_VENDOR_RESPONSES[404])
  @ApiResponse(CREATE_VENDOR_RESPONSES[500])
  @ApiForbiddenError()
  async createVendor(
    @Body() createVendorDto: CreateVendorDto,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
    @Req() req: AuthenticatedRequest,
  ) {
    // Attribute the vendor + its auto-generated assessment task to the acting
    // user. Session callers have authContext.userId; API-key / service-token
    // callers resolve to the key creator (else org owner) so the "created this
    // task" activity credits a real person, not the org owner by default.
    const acting = await this.actingUser.resolve(req, organizationId);
    if (!acting.userId) {
      // No attributable user (org has no active owner). Reject with an
      // actionable message rather than create a vendor whose assessment task
      // has no acting user — matches ActingUserResolver's contract.
      throw new BadRequestException(
        'Cannot attribute this action — your organization must have at least one active user with the "owner" role.',
      );
    }
    const vendor = await this.vendorsService.create(
      organizationId,
      createVendorDto,
      acting.userId, // Pass user ID for task assignment
    );

    return {
      ...vendor,
      ...authEnvelope(authContext),
    };
  }

  @Patch(':id')
  @RequirePermission('vendor', 'update')
  @ApiOperation(VENDOR_OPERATIONS.updateVendor)
  @ApiParam(VENDOR_PARAMS.vendorId)
  @ApiBody(VENDOR_BODIES.updateVendor)
  @ApiResponse(UPDATE_VENDOR_RESPONSES[200])
  @ApiResponse(UPDATE_VENDOR_RESPONSES[400])
  @ApiResponse(UPDATE_VENDOR_RESPONSES[401])
  @ApiResponse(UPDATE_VENDOR_RESPONSES[404])
  @ApiResponse(UPDATE_VENDOR_RESPONSES[500])
  @ApiForbiddenError()
  async updateVendor(
    @Param('id') vendorId: string,
    @Body() updateVendorDto: UpdateVendorDto,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const updatedVendor = await this.vendorsService.updateById(
      vendorId,
      organizationId,
      updateVendorDto,
    );

    return {
      ...updatedVendor,
      ...authEnvelope(authContext),
    };
  }

  @Post(':id/trigger-assessment')
  @RequirePermission('vendor', 'update')
  @ApiOperation({ summary: 'Trigger vendor risk assessment' })
  @ApiParam(VENDOR_PARAMS.vendorId)
  @ApiCreatedResponse({
    description: 'Trigger vendor risk assessment completed successfully',
  })
  @ApiAuthErrors()
  async triggerAssessment(
    @Param('id') vendorId: string,
    @OrganizationId() organizationId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const acting = await this.actingUser.resolve(req, organizationId);
    if (!acting.userId) {
      throw new BadRequestException(
        'Cannot attribute this action — your organization must have at least one active user with the "owner" role.',
      );
    }
    const result = await this.vendorsService.triggerAssessment(
      vendorId,
      organizationId,
      acting.userId,
    );

    return {
      success: true,
      ...result,
    };
  }

  @Delete(':id')
  @RequirePermission('vendor', 'delete')
  @ApiOperation(VENDOR_OPERATIONS.deleteVendor)
  @ApiParam(VENDOR_PARAMS.vendorId)
  @ApiResponse(DELETE_VENDOR_RESPONSES[200])
  @ApiResponse(DELETE_VENDOR_RESPONSES[401])
  @ApiResponse(DELETE_VENDOR_RESPONSES[404])
  @ApiResponse(DELETE_VENDOR_RESPONSES[500])
  @ApiForbiddenError()
  async deleteVendor(
    @Param('id') vendorId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const result = await this.vendorsService.deleteById(
      vendorId,
      organizationId,
    );

    return {
      ...result,
      ...authEnvelope(authContext),
    };
  }
}
