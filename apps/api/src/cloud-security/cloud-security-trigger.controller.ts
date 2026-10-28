import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Logger,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { OrganizationId } from '../auth/auth-context.decorator';
import {
  CloudSecurityService,
  ConnectionNotFoundError,
} from './cloud-security.service';
import { ApiAuthErrors } from '../openapi/common-responses';

@ApiTags('CloudSecurity')
@Controller({ path: 'cloud-security', version: '1' })
export class CloudSecurityTriggerController {
  private readonly logger = new Logger(CloudSecurityTriggerController.name);

  constructor(private readonly cloudSecurityService: CloudSecurityService) {}

  @Post('trigger/:connectionId')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'update')
  @ApiOperation({ summary: 'Trigger a cloud security run for a connection' })
  @ApiCreatedResponse({
    description:
      'Trigger a cloud security run for a connection completed successfully',
  })
  @ApiAuthErrors()
  async triggerScan(
    @Param('connectionId') connectionId: string,
    @OrganizationId() organizationId: string,
  ) {
    this.logger.log(
      `Cloud security scan trigger requested for connection ${connectionId}`,
    );

    try {
      const result = await this.cloudSecurityService.triggerScan(
        connectionId,
        organizationId,
      );
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to trigger scan';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get('runs/:runId')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'read')
  @ApiOperation({ summary: 'Get a cloud security scan run by ID' })
  @ApiOkResponse({
    description: 'A cloud security scan run by ID retrieved successfully',
  })
  @ApiAuthErrors()
  async getRunStatus(
    @Param('runId') runId: string,
    @Query('connectionId') connectionId: string,
    @OrganizationId() organizationId: string,
  ) {
    if (!connectionId) {
      throw new HttpException(
        'connectionId query parameter is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      return await this.cloudSecurityService.getRunStatus(
        runId,
        connectionId,
        organizationId,
      );
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        throw new HttpException('Connection not found', HttpStatus.NOT_FOUND);
      }
      const message =
        error instanceof Error ? error.message : 'Failed to get run status';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
