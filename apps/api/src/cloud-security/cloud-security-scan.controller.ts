import {
  Controller,
  Post,
  Param,
  Logger,
  HttpException,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { ServiceTokenOnlyGuard } from '../auth/service-token-only.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { OrganizationId } from '../auth/auth-context.decorator';
import {
  CloudSecurityService,
  ConnectionNotFoundError,
} from './cloud-security.service';
import { ActingUserResolver } from '../auth/acting-user.service';
import type { AuthenticatedRequest } from '../auth/types';
import { logCloudSecurityActivity } from './cloud-security-audit';
import { ApiAuthErrors } from '../openapi/common-responses';

@ApiTags('CloudSecurity')
@Controller({ path: 'cloud-security', version: '1' })
export class CloudSecurityScanController {
  private readonly logger = new Logger(CloudSecurityScanController.name);

  constructor(
    private readonly cloudSecurityService: CloudSecurityService,
    private readonly actingUser: ActingUserResolver,
  ) {}

  @Post('resolve-session/:connectionId')
  @SkipThrottle()
  @UseGuards(HybridAuthGuard, ServiceTokenOnlyGuard, PermissionGuard)
  @RequirePermission('integration', 'update')
  @ApiOperation({
    summary:
      'Resolve short-lived AWS credentials for a connection (internal only)',
  })
  @ApiCreatedResponse({
    description:
      'Resolve short-lived AWS credentials for a connection (internal only) completed successfully',
  })
  @ApiAuthErrors()
  async resolveSession(
    @Param('connectionId') connectionId: string,
    @OrganizationId() organizationId: string,
  ) {
    try {
      return await this.cloudSecurityService.resolveAwsSession(
        connectionId,
        organizationId,
      );
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        throw new HttpException('Connection not found', HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }

  @Post('scan/:connectionId')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'update')
  @ApiOperation({ summary: 'Trigger a security scan for a connection' })
  @ApiCreatedResponse({
    description: 'Run cloud security scan completed successfully',
  })
  @ApiAuthErrors()
  async scan(
    @Param('connectionId') connectionId: string,
    @OrganizationId() organizationId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.logger.log(
      `Cloud security scan requested for connection ${connectionId}`,
    );

    const result = await this.cloudSecurityService.scan(
      connectionId,
      organizationId,
    );

    if (!result.success) {
      // GCP setup issues are user-fixable — return 400 with structured error
      const isSetupError =
        result.error?.startsWith('SCC_NOT_ACTIVATED:') ||
        result.error?.startsWith('GCP_ORG_MISSING:');
      const errorStr = result.error ?? '';
      const errorCode = isSetupError ? errorStr.split(':')[0] : undefined;
      const message = isSetupError
        ? errorStr.substring(errorStr.indexOf(':') + 2)
        : result.error || 'Scan failed';

      throw new HttpException(
        {
          message,
          provider: result.provider,
          ...(errorCode && { errorCode }),
        },
        isSetupError
          ? HttpStatus.BAD_REQUEST
          : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const totalFindings = result.findings.length;
    const failedCount = result.findings.filter((f) => !f.passed).length;
    const passedCount = result.findings.filter((f) => f.passed).length;

    // Attribute to the acting user. Session callers already have req.userId;
    // API key / service token callers resolve to the key creator or org owner.
    // This is best-effort: the scan has already completed, so a transient
    // resolver/audit failure (or an org with no attributable user) must not turn
    // it into a failed HTTP request — that would invite the caller to re-run the
    // scan. Log and move on. (auditLog.userId is a FK to User, so skip on null.)
    try {
      const acting = await this.actingUser.resolve(req, organizationId);
      if (acting.userId)
        await logCloudSecurityActivity({
          organizationId,
          userId: acting.userId,
          connectionId,
          action: 'scan_completed',
          // Append the caller marker (e.g. 'via API key "CI"') for non-session
          // callers so an owner-fallback attribution isn't read as a session
          // action — mirrors the exception / scan-mode endpoints.
          description: `Ran cloud security scan — ${totalFindings} findings (${failedCount} failed, ${passedCount} passed)${
            acting.callerLabel ? ` [${acting.callerLabel}]` : ''
          }`,
          metadata: {
            totalFindings,
            failedCount,
            passedCount,
            provider: result.provider,
          },
        });
    } catch (err) {
      this.logger.error('Failed to record cloud security scan activity', err);
    }

    return {
      success: true,
      provider: result.provider,
      findingsCount: totalFindings,
      scannedAt: result.scannedAt,
    };
  }

  @Post('detect-services/:connectionId')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'read')
  @ApiOperation({ summary: 'Detect available cloud services for a connection' })
  @ApiCreatedResponse({
    description:
      'Detect available cloud services for a connection completed successfully',
  })
  @ApiAuthErrors()
  async detectServices(
    @Param('connectionId') connectionId: string,
    @OrganizationId() organizationId: string,
  ) {
    try {
      const services = await this.cloudSecurityService.detectServices(
        connectionId,
        organizationId,
      );
      return { services };
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        throw new HttpException('Connection not found', HttpStatus.NOT_FOUND);
      }
      const message =
        error instanceof Error ? error.message : 'Failed to detect services';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }
}
