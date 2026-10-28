import {
  Controller,
  Post,
  Param,
  HttpException,
  HttpStatus,
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
export class CloudSecurityAzureController {
  constructor(
    private readonly cloudSecurityService: CloudSecurityService,
    private readonly azureSecurityService: AzureSecurityService,
  ) {}

  @Post('setup-azure/:connectionId')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'update')
  @ApiOperation({ summary: 'Set up Azure for a connection' })
  @ApiCreatedResponse({
    description: 'Up Azure for a connection updated successfully',
  })
  @ApiAuthErrors()
  async setupAzure(
    @Param('connectionId') connectionId: string,
    @OrganizationId() organizationId: string,
  ) {
    try {
      const connection = await this.cloudSecurityService.getConnectionForDetect(
        connectionId,
        organizationId,
      );

      const credentials = connection.credentials as Record<string, unknown>;
      const accessToken = credentials?.access_token as string;
      if (!accessToken) {
        throw new Error(
          'No access token found. Reconnect the Azure integration.',
        );
      }

      const variables = (connection.variables ?? {}) as Record<string, unknown>;
      const steps: Array<{ name: string; success: boolean; error?: string }> =
        [];

      // Step 1: Detect subscriptions
      let subscriptionId =
        normalizeAzureSubscriptionId(variables.subscription_id) ?? undefined;
      let subscriptionName: string | undefined;
      try {
        const subs =
          await this.azureSecurityService.detectSubscriptions(accessToken);
        if (subs.length > 0) {
          // Keep a saved, still-accessible subscription — never silently
          // re-pin scope to whatever the API lists first. Only persist a
          // detection when nothing was saved (or the saved id is no longer
          // among the accessible subscriptions).
          const detected = subs.find((s) => s.id === subscriptionId) ?? subs[0];
          subscriptionName = detected.displayName;
          if (detected.id !== subscriptionId) {
            subscriptionId = detected.id;
            await this.cloudSecurityService.saveConnectionVariable(
              connectionId,
              'subscription_id',
              subscriptionId,
              organizationId,
            );
          }
          steps.push({
            name: `Subscription detected: ${subscriptionName}`,
            success: true,
          });
        } else {
          steps.push({
            name: 'Detect subscription',
            success: false,
            error:
              'No Azure subscriptions found. Ensure your account has an active subscription.',
          });
        }
      } catch (error) {
        steps.push({
          name: 'Detect subscription',
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to detect subscriptions',
        });
      }

      // Step 2: Verify Defender access
      if (subscriptionId) {
        try {
          const resp = await fetch(
            `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Security/assessments?api-version=2021-06-01&$top=1`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (resp.ok) {
            steps.push({
              name: 'Microsoft Defender for Cloud access verified',
              success: true,
            });
          } else {
            steps.push({
              name: 'Microsoft Defender for Cloud access',
              success: false,
              error:
                'Your account needs the "Security Reader" role on this subscription.',
            });
          }
        } catch {
          steps.push({
            name: 'Microsoft Defender for Cloud access',
            success: false,
            error: 'Could not verify Defender access.',
          });
        }

        // Step 3: Verify general read access
        try {
          const resp = await fetch(
            `https://management.azure.com/subscriptions/${subscriptionId}/resources?api-version=2021-04-01&$top=1`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (resp.ok) {
            steps.push({
              name: 'Resource read access verified',
              success: true,
            });
          } else {
            steps.push({
              name: 'Resource read access',
              success: false,
              error:
                'Your account needs at least the "Reader" role on this subscription.',
            });
          }
        } catch {
          steps.push({
            name: 'Resource read access',
            success: false,
            error: 'Verification failed',
          });
        }

        // Step 4: Check write permissions for auto-fix
        // Use the permissions check API to see if user can write resources
        let canAutoFix = false;
        try {
          const permResp = await fetch(
            `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/permissions?api-version=2022-04-01`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (permResp.ok) {
            const permData = (await permResp.json()) as {
              value: Array<{ actions: string[]; notActions: string[] }>;
            };
            const allActions = permData.value?.flatMap((p) => p.actions) ?? [];
            canAutoFix = allActions.some((a) => a === '*' || a === '*/write');
            if (canAutoFix) {
              steps.push({
                name: 'Auto-fix capability: write access available',
                success: true,
              });
            } else {
              steps.push({
                name: 'Auto-fix capability',
                success: true,
                error:
                  'Read-only access. Auto-fix requires Contributor role — you can still scan and view findings.',
              });
            }
          }
        } catch {
          // Non-critical — auto-fix detection failed
        }
      }

      return {
        steps,
        subscriptionId,
        subscriptionName,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Azure setup failed';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }
}
