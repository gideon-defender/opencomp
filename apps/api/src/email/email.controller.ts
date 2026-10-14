import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiExcludeController,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { OrganizationId } from '../auth/auth-context.decorator';
import { SkipAuditLog } from '../audit/skip-audit-log.decorator';
import { SendEmailDto } from './dto/send-email.dto';
import { SendBatchEmailDto } from './dto/send-batch-email.dto';
import { defaultFromAddress } from './from-address';
import { enqueueEmail, enqueueEmailBatch } from './sqs-client';

@ApiExcludeController()
@ApiTags('Internal - Email')
@Controller({ path: 'internal/email', version: '1' })
@UseGuards(HybridAuthGuard, PermissionGuard)
@ApiSecurity('apikey')
export class EmailController {
  @Post('send')
  @HttpCode(200)
  @RequirePermission('email', 'send')
  // The body carries rendered `html` (magic-links / OTP) and full attachment
  // bytes — never worth diffing into the audit log, and readable with app:read.
  @SkipAuditLog()
  @ApiOperation({
    summary: 'Enqueue an email via SQS for SES delivery (internal)',
  })
  @ApiResponse({ status: 200, description: 'Email enqueued' })
  async sendEmail(
    @Body() dto: SendEmailDto,
    @OrganizationId() organizationId: string,
  ) {
    const { id } = await enqueueEmail({
      to: dto.to,
      subject: dto.subject,
      html: dto.html,
      from: dto.from,
      channel: dto.system ? 'system' : 'default',
      cc: dto.cc,
      scheduledAt: dto.scheduledAt,
      attachments: dto.attachments,
      userId: dto.userId,
      organizationId,
    });

    return { success: true, taskId: id };
  }

  @Post('send-batch')
  @HttpCode(200)
  @RequirePermission('email', 'send')
  @SkipAuditLog()
  @ApiOperation({
    summary: 'Enqueue a batch of emails via SQS for SES delivery (internal)',
  })
  @ApiResponse({ status: 200, description: 'Batch email enqueued' })
  async sendBatchEmail(
    @Body() dto: SendBatchEmailDto,
    @OrganizationId() organizationId: string,
  ) {
    const fromAddress = defaultFromAddress();

    const emails = dto.emails.map((email) => ({
      to: email.to,
      subject: email.subject,
      html: email.html,
      from: email.from ?? fromAddress,
      cc: email.cc,
      userId: email.userId,
      organizationId,
    }));

    const { id } = await enqueueEmailBatch(emails);

    return { success: true, taskId: id };
  }
}
