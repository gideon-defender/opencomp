import {
  Controller,
  Post,
  Param,
  HttpException,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { OrganizationId } from '../auth/auth-context.decorator';
import { CloudSecurityService } from './cloud-security.service';
import { AzureSecurityService } from './providers/azure-security.service';
import { ApiAuthErrors } from '../openapi/common-responses';
import { normalizeAzureSubscriptionId } from './azure-ids';

@ApiTags('CloudSecurity')
@Controller({ path: 'cloud-security', version: '1' })
export class CloudSecurityAzureValidateController {
  private readonly logger = new Logger(
    CloudSecurityAzureValidateController.name,
  );

  constructor(
    private readonly cloudSecurityService: CloudSecurityService,
    private readonly azureSecurityService: AzureSecurityService,
  ) {}

  @Post('validate-azure/:connectionId')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'read')
  @ApiOperation({ summary: 'Validate Azure credentials for a connection' })
  @ApiCreatedResponse({
    description:
      'Validate Azure credentials for a connection completed successfully',
  })
  @ApiAuthErrors()
  async validateAzure(
    @Param('connectionId') connectionId: string,
    @OrganizationId() organizationId: string,
  ) {
    try {
      const connection = await this.cloudSecurityService.getConnectionForDetect(
        connectionId,
        organizationId,
      );

      const credentials = connection.credentials as Record<string, unknown>;
      const variables = (connection.variables ?? {}) as Record<string, unknown>;
      const tenantId = credentials?.tenantId as string;
      const clientId = credentials?.clientId as string;
      const clientSecret = credentials?.clientSecret as string;
      const subscriptionId = normalizeAzureSubscriptionId(
        credentials?.subscriptionId ?? variables.subscription_id,
      );

      const steps: Array<{ name: string; success: boolean; error?: string }> =
        [];

      if (!subscriptionId) {
        steps.push({
          name: 'Subscription ID',
          success: false,
          error:
            'No valid subscription ID configured. Go to the Azure integration settings to auto-detect your subscription.',
        });
        return { steps, subscriptionId: null };
      }

      // Step 1: Validate credentials (token exchange)
      let accessToken: string | null = null;
      try {
        accessToken = await this.azureSecurityService.getAccessToken(
          tenantId,
          clientId,
          clientSecret,
        );
        steps.push({ name: 'Authenticate with Azure', success: true });
      } catch (error) {
        steps.push({
          name: 'Authenticate with Azure',
          success: false,
          error:
            error instanceof Error ? error.message : 'Authentication failed',
        });
        return { steps, subscriptionId };
      }

      // Step 2: Verify subscription access
      try {
        const resp = await fetch(
          `https://management.azure.com/subscriptions/${subscriptionId}?api-version=2022-12-01`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (resp.ok) {
          steps.push({ name: 'Subscription access verified', success: true });
        } else {
          const errorText = await resp.text();
          this.logger.warn(
            `Azure subscription access check failed (${resp.status}): ${errorText.slice(0, 200)}`,
          );
          steps.push({
            name: 'Subscription access',
            success: false,
            error:
              'Cannot access subscription. Assign "Reader" role to the app registration.',
          });
        }
      } catch {
        steps.push({
          name: 'Subscription access',
          success: false,
          error: 'Network error',
        });
      }

      // Step 3: Verify Defender access
      try {
        const resp = await fetch(
          `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Security/assessments?api-version=2021-06-01&$top=1`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (resp.ok) {
          steps.push({
            name: 'Microsoft Defender for Cloud access',
            success: true,
          });
        } else {
          steps.push({
            name: 'Microsoft Defender for Cloud access',
            success: false,
            error: 'Assign "Security Reader" role to the app registration.',
          });
        }
      } catch {
        steps.push({
          name: 'Microsoft Defender for Cloud access',
          success: false,
          error: 'Could not verify Defender access',
        });
      }

      return { steps, subscriptionId };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Azure validation failed';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }
}
