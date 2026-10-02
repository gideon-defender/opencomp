import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation } from '@nestjs/swagger';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { OrganizationId, UserId } from '../auth/auth-context.decorator';
import { RemediationBatchService } from './remediation-batch.service';
import { logCloudSecurityActivity } from './cloud-security-audit';
import { CreateBatchDto, UpdateBatchDto } from './dto/remediation.dto';

/**
 * Batch remediation endpoints. Split from RemediationController so batch
 * orchestration has its own module instead of growing the single-file
 * controller past the repo file-size limit.
 */
@Controller({ path: 'cloud-security/remediation', version: '1' })
@UseGuards(HybridAuthGuard, PermissionGuard)
export class RemediationBatchController {
  constructor(
    private readonly remediationBatchService: RemediationBatchService,
  ) {}

  /** Get active batch for a connection (if any). */
  @Get('batch/active')
  @RequirePermission('integration', 'read')
  @ApiOperation({
    summary: 'Get the active remediation batch',
    description:
      'Return the pending or running batch for a connection, if any.',
  })
  async getActiveBatch(
    @Query('connectionId') connectionId: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.remediationBatchService.getActiveBatch({
      connectionId,
      organizationId,
    });
  }

  /** Create a new batch record (called before triggering the task). */
  @Post('batch')
  @RequirePermission('integration', 'update')
  @ApiOperation({
    summary: 'Create a remediation batch',
    description:
      'Start a batch fix for up to 500 findings on one active connection in this organization.',
  })
  @ApiBody({ type: CreateBatchDto })
  async createBatch(
    @Body() body: CreateBatchDto,
    @OrganizationId() organizationId: string,
    @UserId() userId: string,
  ) {
    const result = await this.remediationBatchService.createBatch({
      connectionId: body.connectionId,
      findings: body.findings,
      organizationId,
      userId,
    });

    await logCloudSecurityActivity({
      organizationId,
      userId,
      connectionId: body.connectionId,
      action: 'remediation_executed',
      description: `Started batch fix: ${body.findings.length} findings`,
      metadata: {
        batchId: result.data.id,
        findingCount: body.findings.length,
      },
    });

    return result;
  }

  /** Update a batch (set triggerRunId after task starts). */
  @Patch('batch/:batchId')
  @RequirePermission('integration', 'update')
  @ApiOperation({
    summary: 'Update a remediation batch',
    description:
      'Attach the trigger run ID or move the batch between pending, running, completed, done, failed, and cancelled.',
  })
  @ApiBody({ type: UpdateBatchDto })
  async updateBatch(
    @Param('batchId') batchId: string,
    @Body() body: UpdateBatchDto,
    @OrganizationId() organizationId: string,
  ) {
    return this.remediationBatchService.updateBatch({
      batchId,
      triggerRunId: body.triggerRunId,
      status: body.status,
      organizationId,
    });
  }

  /** Skip a specific finding in an active batch. */
  @Post('batch/:batchId/skip/:findingId')
  @RequirePermission('integration', 'update')
  @ApiOperation({
    summary: 'Skip a finding in a remediation batch',
    description:
      'Mark one finding cancelled so the running batch leaves it untouched.',
  })
  async skipFinding(
    @Param('batchId') batchId: string,
    @Param('findingId') findingId: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.remediationBatchService.skipFinding({
      batchId,
      findingId,
      organizationId,
    });
  }
}
