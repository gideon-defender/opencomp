import {
  Controller,
  Post,
  Body,
  Query,
  HttpCode,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { db, normalizeEmail } from '@db';
import {
  verifyUnsubscribeToken,
  resolveUnsubscribeUser,
} from '@gideon-defender/email';

// Class (not inline type) so swagger + the ValidationPipe whitelist accept it.
// Exported so the one-click regression test can run the real global-pipe
// config against it.
export class UnsubscribeBodyDto {
  @ApiPropertyOptional({
    description: 'Recipient email address (matches the email query param).',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    description: 'HMAC unsubscribe token (matches the token query param).',
  })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({
    description:
      'User ID for tenant-scoped links (matches the userId query param).',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Originating organization bound to the signed link.',
  })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({
    description:
      'RFC 8058 one-click marker. Gmail POSTs List-Unsubscribe=One-Click as a urlencoded body field alongside the query params; the global ValidationPipe (forbidNonWhitelisted) rejects unknown fields, so this must be allowlisted even though the handler ignores it.',
  })
  @IsOptional()
  @IsString()
  'List-Unsubscribe'?: string;
}

@ApiTags('Email - Unsubscribe')
@Controller({ path: 'email/unsubscribe', version: '1' })
export class UnsubscribeController {
  private readonly logger = new Logger('UnsubscribeController');
  /**
   * RFC 8058 one-click unsubscribe endpoint.
   * Gmail POSTs to this URL with List-Unsubscribe=One-Click in the body.
   *
   * User-scoped links (`userId` + `email` + `token`) unsubscribe exactly one
   * tenant account. Legacy email-only links still verify (including
   * pre-scoping in-flight links), but when several tenant accounts share the
   * address the request returns success WITHOUT changing any account — the
   * machine caller cannot pick the right one, and a non-2xx would only
   * trigger Gmail retries. The recipient's scoped link (email body) still
   * unsubscribes their own account.
   */
  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'One-click unsubscribe (RFC 8058)',
    description:
      'Handles Gmail List-Unsubscribe POSTs. User-scoped links unsubscribe one tenant account; legacy email-only links succeed without changes when several tenants share the address.',
  })
  @ApiBody({ type: UnsubscribeBodyDto })
  async unsubscribe(
    @Query('email') queryEmail?: string,
    @Query('token') queryToken?: string,
    @Query('userId') queryUserId?: string,
    @Body() body?: UnsubscribeBodyDto,
    @Query('organizationId') queryOrganizationId?: string,
  ) {
    // Coerce to string - query params can be arrays if repeated
    const rawEmail = queryEmail || body?.email;
    const rawToken = queryToken || body?.token;
    const rawOrganizationId = queryOrganizationId || body?.organizationId;
    const organizationId =
      typeof rawOrganizationId === 'string' ? rawOrganizationId : undefined;
    const rawUserId = queryUserId || body?.userId;
    const email = typeof rawEmail === 'string' ? rawEmail : undefined;
    const token = typeof rawToken === 'string' ? rawToken : undefined;
    const userId = typeof rawUserId === 'string' ? rawUserId : undefined;

    if (!email || !token) {
      throw new BadRequestException('Email and token are required');
    }
    const normalizedEmail = normalizeEmail(email);

    if (userId) {
      const user = await resolveUnsubscribeUser({
        db,
        userId,
        email: normalizedEmail,
        token,
        organizationId,
      });
      if (!user) throw new BadRequestException('Invalid token');
      await db.user.update({
        where: { id: user.id },
        data: {
          emailNotificationsUnsubscribed: true,
          emailPreferences: {
            policyNotifications: false,
            taskReminders: false,
            weeklyTaskDigest: false,
            unassignedItemsNotifications: false,
            taskMentions: false,
            taskAssignments: false,
            findingNotifications: false,
          },
        },
      });
      return { success: true };
    }

    // Legacy email-only path: verify the HMAC (normalized and, for
    // pre-scoping in-flight links, raw), then resolve tenant-scoped.
    if (!verifyUnsubscribeToken(email, token)) {
      throw new BadRequestException('Invalid token');
    }

    const users = await db.user.findMany({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true },
    });

    if (users.length === 0) {
      // Don't reveal user existence - just return success
      return { success: true };
    }
    if (users.length > 1) {
      // Ambiguous: the machine caller cannot pick one tenant account, and a
      // non-2xx makes Gmail retry a request that can never succeed. Return
      // success without changing any account (count only in the log — the
      // address itself is PII). The recipient unsubscribes via their scoped
      // link from the email body instead.
      this.logger.warn(
        `Ambiguous one-click unsubscribe for an address shared by ${users.length} accounts — no account changed`,
      );
      return { success: true };
    }

    await db.user.update({
      where: { id: users[0].id },
      data: {
        emailNotificationsUnsubscribed: true,
        emailPreferences: {
          policyNotifications: false,
          taskReminders: false,
          weeklyTaskDigest: false,
          unassignedItemsNotifications: false,
          taskMentions: false,
          taskAssignments: false,
          findingNotifications: false,
        },
      },
    });

    return { success: true };
  }
}
