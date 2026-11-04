import {
  Controller,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { OrganizationId } from '../auth/auth-context.decorator';
import { CloudSecurityLegacyService } from './cloud-security-legacy.service';

@ApiTags('CloudSecurity')
@Controller({ path: 'cloud-security', version: '1' })
export class CloudSecurityLegacyController {
  constructor(private readonly legacyService: CloudSecurityLegacyService) {}

  @Post('legacy/connect')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'create')
  @ApiOperation({ summary: 'Create a legacy cloud integration' })
  async connectLegacy(
    @OrganizationId() organizationId: string,
    @Body()
    body: {
      provider: 'aws' | 'gcp' | 'azure';
      credentials: Record<string, string | string[]>;
    },
  ) {
    const result = await this.legacyService.connectLegacy(
      organizationId,
      body.provider,
      body.credentials,
    );
    return { success: true, integrationId: result.integrationId };
  }

  @Post('legacy/validate-aws')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'read')
  @ApiOperation({ summary: 'Validate legacy AWS credentials' })
  async validateAwsCredentials(
    @Body() body: { accessKeyId: string; secretAccessKey: string },
  ) {
    const result = await this.legacyService.validateAwsAccessKeys(
      body.accessKeyId,
      body.secretAccessKey,
    );
    return {
      success: true,
      accountId: result.accountId,
      regions: result.regions,
    };
  }

  @Delete('legacy/:integrationId')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'delete')
  @ApiOperation({ summary: 'Delete a legacy cloud integration' })
  async disconnectLegacy(
    @Param('integrationId') integrationId: string,
    @OrganizationId() organizationId: string,
  ) {
    await this.legacyService.disconnectLegacy(integrationId, organizationId);
    return { success: true };
  }
}
