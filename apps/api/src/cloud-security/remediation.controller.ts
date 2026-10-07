import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  Logger,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { OrganizationId, UserId } from '../auth/auth-context.decorator';
import { RemediationService } from './remediation.service';
import { logCloudSecurityActivity } from './cloud-security-audit';
import {
  ExecuteRemediationDto,
  PreviewRemediationDto,
} from './dto/remediation.dto';

@Controller({ path: 'cloud-security/remediation', version: '1' })
@UseGuards(HybridAuthGuard, PermissionGuard)
export class RemediationController {
  private readonly logger = new Logger(RemediationController.name);

  constructor(private readonly remediationService: RemediationService) {}

  @Get('capabilities')
  @SkipThrottle()
  @RequirePermission('integration', 'read')
  @ApiOperation({
    summary: 'List remediation capabilities',
    description:
      'List which providers and finding types support one-click auto-fix for this connection.',
  })
  async getCapabilities(
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
      return await this.remediationService.getCapabilities({
        connectionId,
        organizationId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to get capabilities';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('preview')
  @RequirePermission('integration', 'update')
  @ApiOperation({
    summary: 'Preview a remediation',
    description:
      'Build an auto-fix plan for one finding. Send cachedPermissions only to recheck a previous preview.',
  })
  @ApiBody({ type: PreviewRemediationDto })
  async preview(
    @Body() body: PreviewRemediationDto,
    @OrganizationId() organizationId: string,
  ) {
    try {
      return await this.remediationService.previewRemediation({
        connectionId: body.connectionId,
        organizationId,
        checkResultId: body.checkResultId,
        remediationKey: body.remediationKey,
        cachedPermissions: body.cachedPermissions,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preview failed';
      this.logger.error(`Remediation preview failed: ${message}`);
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('execute')
  @RequirePermission('integration', 'update')
  @ApiOperation({
    summary: 'Execute a remediation',
    description:
      'Run the approved auto-fix plan for one finding. Pass expectedPlanHash from the preview response (required for AWS/GCP/Azure). Fails closed when a step is skipped or invalid.',
  })
  @ApiBody({ type: ExecuteRemediationDto })
  async execute(
    @Body() body: ExecuteRemediationDto,
    @OrganizationId() organizationId: string,
    @UserId() userId: string,
  ) {
    try {
      const result = await this.remediationService.executeRemediation({
        connectionId: body.connectionId,
        organizationId,
        checkResultId: body.checkResultId,
        remediationKey: body.remediationKey,
        userId,
        acknowledgment: body.acknowledgment,
        ...(body.expectedPlanHash
          ? { expectedPlanHash: body.expectedPlanHash }
          : {}),
      });

      if (result.status === 'success') {
        await logCloudSecurityActivity({
          organizationId,
          userId,
          connectionId: body.connectionId,
          action: 'remediation_executed',
          description: `Applied auto-fix: ${body.remediationKey} on ${result.resourceId}`,
          metadata: {
            remediationKey: body.remediationKey,
            actionId: result.actionId,
            resourceId: result.resourceId,
            acknowledgmentText: body.acknowledgment,
            acknowledgedBy: userId,
            acknowledgedAt: new Date().toISOString(),
            previousState: result.previousState,
            appliedState: result.appliedState,
            verified: (result.appliedState as Record<string, unknown>)
              ?.verified,
          },
        });
      } else if (result.status === 'failed') {
        await logCloudSecurityActivity({
          organizationId,
          userId,
          connectionId: body.connectionId,
          action: 'remediation_failed',
          description: `Auto-fix failed: ${body.remediationKey} on ${result.resourceId} — ${result.error}`,
          metadata: {
            remediationKey: body.remediationKey,
            actionId: result.actionId,
            resourceId: result.resourceId,
            acknowledgmentText: body.acknowledgment,
            acknowledgedBy: userId,
            error: result.error,
          },
        });
      } else {
        await logCloudSecurityActivity({
          organizationId,
          userId,
          connectionId: body.connectionId,
          action: 'remediation_failed',
          description: `Auto-fix did not succeed: ${body.remediationKey} on ${result.resourceId} (status ${result.status})`,
          metadata: {
            remediationKey: body.remediationKey,
            actionId: result.actionId,
            resourceId: result.resourceId,
            acknowledgmentText: body.acknowledgment,
            acknowledgedBy: userId,
            status: result.status,
          },
        });
      }

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Execution failed';
      this.logger.error(`Remediation execution failed: ${message}`);
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post(':actionId/rollback')
  @RequirePermission('integration', 'update')
  @ApiOperation({
    summary: 'Roll back a remediation action',
    description:
      'Undo a previously applied auto-fix using its stored rollback steps.',
  })
  async rollback(
    @Param('actionId') actionId: string,
    @OrganizationId() organizationId: string,
    @UserId() userId: string,
  ) {
    try {
      const result = await this.remediationService.rollbackRemediation({
        actionId,
        organizationId,
      });

      const isSuccess = result.status === 'rolled_back';
      await logCloudSecurityActivity({
        organizationId,
        userId,
        connectionId: result.connectionId,
        action: isSuccess ? 'rollback_executed' : 'rollback_failed',
        description: isSuccess
          ? `Rolled back: ${result.remediationKey} on ${result.resourceId}`
          : `Rollback failed: ${result.remediationKey} on ${result.resourceId} — ${(result as { error?: string }).error}`,
        metadata: {
          actionId,
          remediationKey: result.remediationKey,
          resourceId: result.resourceId,
          status: result.status,
          rolledBackBy: userId,
          rolledBackAt: new Date().toISOString(),
          ...((result as { error?: string }).error && {
            error: (result as { error?: string }).error,
          }),
        },
      });

      return result;
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Rollback failed';
      this.logger.error(`Remediation rollback failed: ${raw}`);

      // Log the failure to audit trail
      await logCloudSecurityActivity({
        organizationId,
        userId,
        connectionId: actionId, // best effort — action ID as fallback
        action: 'rollback_failed',
        description: `Rollback failed for action ${actionId}: ${raw}`,
        metadata: { actionId, error: raw, rolledBackBy: userId },
      }).catch(() => {}); // don't let audit log failure block the response

      // Try to parse structured permission error
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'missingActions' in parsed
        ) {
          const record = parsed as Record<string, unknown>;
          const toStringArray = (value: unknown): string[] | undefined =>
            Array.isArray(value)
              ? value.filter((item): item is string => typeof item === 'string')
              : undefined;
          const toOptionalString = (value: unknown): string | undefined =>
            typeof value === 'string' ? value : undefined;
          const body: Record<string, string | string[]> = {
            message: toOptionalString(record.message) ?? raw,
          };
          const missingActions = toStringArray(record.missingActions);
          if (missingActions) body.missingActions = missingActions;
          const script = toOptionalString(record.script);
          if (script) body.script = script;
          // Forward the denylist fields when present — without them the
          // client renders a one-click grant with no record that part of
          // the requirement was refused for manual review.
          const blockedPermissions = toStringArray(record.blockedPermissions);
          if (blockedPermissions) body.blockedPermissions = blockedPermissions;
          const blockedPermissionsMessage = toOptionalString(
            record.blockedPermissionsMessage,
          );
          if (blockedPermissionsMessage)
            body.blockedPermissionsMessage = blockedPermissionsMessage;
          throw new HttpException(body, HttpStatus.BAD_REQUEST);
        }
      } catch (parseErr) {
        if (parseErr instanceof HttpException) throw parseErr;
      }

      throw new HttpException(raw, HttpStatus.BAD_REQUEST);
    }
  }

  @Get('actions')
  @RequirePermission('integration', 'read')
  @ApiOperation({
    summary: 'List remediation actions',
    description:
      'List recorded auto-fix attempts and their status for a connection.',
  })
  async getActions(
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
      const actions = await this.remediationService.getActions({
        connectionId,
        organizationId,
      });
      return { data: actions, count: actions.length };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to get actions';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }
}
