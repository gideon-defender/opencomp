import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { OrganizationId } from '../auth/auth-context.decorator';
import { Throttle } from '@nestjs/throttler';
import { TrustAccessService } from './trust-access.service';

@ApiTags('Trust Access')
// Same throttle posture as the request controller: previews mint PDFs and
// S3 objects, so hold them below the global limit.
@Throttle({ default: { ttl: 60000, limit: 60 } })
@Controller({ path: 'trust-access', version: '1' })
export class TrustNdaPreviewController {
  constructor(private readonly trustAccessService: TrustAccessService) {}

  @Post('admin/requests/:id/preview-nda')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('trust', 'read')
  @ApiSecurity('apikey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_previewNda_v1',
    summary: 'Preview NDA PDF',
    description:
      'Generate preview NDA with watermark and save to S3 with preview-* prefix',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Preview NDA generated',
  })
  async previewNda(
    @OrganizationId() organizationId: string,
    @Param('id') requestId: string,
  ) {
    return this.trustAccessService.previewNda(organizationId, requestId);
  }

  @Get('admin/requests/:id/preview-nda')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('trust', 'read')
  @ApiSecurity('apikey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_streamPreviewNda_v1',
    summary: 'Stream NDA preview PDF',
    description:
      'Generate the watermarked NDA preview on first view, then stream the PDF inline for browser viewing. Use this for preview links — the presigned S3 URL from POST is unreachable from browsers in local or VPC-isolated setups.',
  })
  @ApiProduces('application/pdf')
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Preview PDF streamed inline',
    content: { 'application/pdf': {} },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Access request not found',
  })
  async streamPreviewNda(
    @OrganizationId() organizationId: string,
    @Param('id') requestId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } =
      await this.trustAccessService.getPreviewNdaPdfBuffer(
        organizationId,
        requestId,
      );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }
}
