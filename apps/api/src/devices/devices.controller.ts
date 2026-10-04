import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthContext, OrganizationId } from '../auth/auth-context.decorator';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import type { AuthContext as AuthContextType } from '../auth/types';
import { DevicesByMemberResponseDto } from './dto/devices-by-member-response.dto';
import { DevicesService } from './devices.service';

import { authEnvelope } from '@/utils/auth-response';
import {
  ApiErrorResponseDto,
  ApiForbiddenError,
  ApiUnauthorizedError,
} from '../openapi/common-responses';
@ApiTags('Devices')
@Controller({ path: 'devices', version: '1' })
@UseGuards(HybridAuthGuard, PermissionGuard)
@RequirePermission('app', 'read')
@ApiSecurity('apikey')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all devices',
    description:
      'Returns all devices for the authenticated organization from FleetDM. Supports both API key authentication (X-API-Key header) and session authentication (Bearer token or cookies).',
  })
  @ApiResponse({
    status: 200,
    description: 'Devices retrieved successfully',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/DeviceResponseDto' },
            },
            count: {
              type: 'number',
              description: 'Total number of devices',
              example: 25,
            },
            authType: {
              type: 'string',
              enum: ['api-key', 'session'],
              description: 'How the request was authenticated',
            },
            authenticatedUser: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'User ID',
                  example: 'usr_abc123def456',
                },
                email: {
                  type: 'string',
                  description: 'User email',
                  example: 'user@company.com',
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description:
      'Unauthorized - Invalid authentication or insufficient permissions',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Organization not found',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error - FleetDM integration issue',
    type: ApiErrorResponseDto,
  })
  @ApiForbiddenError()
  async getAllDevices(
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const devices =
      await this.devicesService.findAllByOrganization(organizationId);

    return {
      data: devices,
      count: devices.length,
      ...authEnvelope(authContext),
    };
  }

  @Get('member/:memberId')
  @ApiOperation({
    summary: 'Get devices by member ID',
    description:
      "Returns all devices assigned to a specific member within the authenticated organization. Devices are fetched from FleetDM using the member's dedicated fleetDmLabelId. Supports both API key authentication (X-API-Key header) and session authentication (Bearer token or cookies).",
  })
  @ApiParam({
    name: 'memberId',
    description: 'Member ID to get devices for',
    example: 'mem_abc123def456',
  })
  @ApiResponse({
    status: 200,
    description: 'Member devices retrieved successfully',
    type: DevicesByMemberResponseDto,
  })
  @ApiResponse({
    status: 401,
    description:
      'Unauthorized - Invalid authentication or insufficient permissions',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Organization or member not found',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error - FleetDM integration issue',
  })
  @ApiForbiddenError()
  async getDevicesByMember(
    @Param('memberId') memberId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ): Promise<DevicesByMemberResponseDto> {
    const [devices, member] = await Promise.all([
      this.devicesService.findAllByMember(organizationId, memberId),
      this.devicesService.getMemberById(organizationId, memberId),
    ]);

    return {
      data: devices,
      count: devices.length,
      member,
      ...authEnvelope(authContext),
    };
  }

  @Delete(':id')
  @RequirePermission('member', 'delete')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete device',
    description:
      'Deletes a single device in the authenticated organization. Only organization owners can delete devices.',
  })
  @ApiParam({
    name: 'id',
    description: 'Device ID to delete',
    example: 'dev_abc123def456',
  })
  @ApiResponse({
    status: 204,
    description: 'Device deleted successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - only organization owners can delete devices',
  })
  @ApiResponse({
    status: 404,
    description: 'Organization or device not found',
  })
  @ApiUnauthorizedError()
  async deleteDevice(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ): Promise<void> {
    await this.devicesService.removeDeviceById({
      organizationId,
      deviceId: id,
      userId: authContext.userId,
    });
  }
}
