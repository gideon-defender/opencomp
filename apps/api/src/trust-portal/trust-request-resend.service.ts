import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import { generateTrustToken } from './trust-access-helpers';
import {
  buildNdaSigningLink,
  buildPortalAccessUrl,
  resolveTrustAppUrl,
} from './trust-portal-urls';
import { TrustEmailService } from './email.service';
import { TrustGrantTokenService } from './trust-grant-token.service';

/**
 * Notification resends for trust portals: access-granted and NDA-signing
 * emails. Split from TrustAccessService.
 */
@Injectable()
export class TrustRequestResendService {
  constructor(
    private readonly emailService: TrustEmailService,
    private readonly grantTokens: TrustGrantTokenService,
  ) {}

  private buildPortalAccessUrl(params: {
    organizationId: string;
    accessToken: string;
  }): Promise<string> {
    return buildPortalAccessUrl({
      trustAppUrl: resolveTrustAppUrl(),
      organizationId: params.organizationId,
      accessToken: params.accessToken,
    });
  }

  private buildNdaSigningLink(params: {
    organizationId: string;
    signToken: string;
  }): Promise<string> {
    return buildNdaSigningLink({
      trustAppUrl: resolveTrustAppUrl(),
      organizationId: params.organizationId,
      signToken: params.signToken,
    });
  }

  async resendAccessGrantEmail(organizationId: string, grantId: string) {
    const grant = await db.trustAccessGrant.findFirst({
      where: {
        id: grantId,
        accessRequest: {
          organizationId,
        },
      },
      include: {
        accessRequest: {
          include: {
            organization: {
              select: { name: true },
            },
          },
        },
        ndaAgreement: {
          select: { status: true },
        },
      },
    });

    if (!grant) {
      throw new NotFoundException('Grant not found');
    }

    if (grant.status !== 'active') {
      throw new BadRequestException(
        `Cannot resend access email for ${grant.status} grant`,
      );
    }

    const now = new Date();

    // Check if grant has expired
    if (grant.expiresAt < now) {
      throw new BadRequestException(
        'Cannot resend access email for expired grant',
      );
    }

    // Generate a new access token if expired or missing
    const { accessToken } = await this.grantTokens.resolveLiveAccessToken({
      id: grantId,
      accessToken: grant.accessToken,
      accessTokenExpiresAt: grant.accessTokenExpiresAt,
      expiresAt: grant.expiresAt,
    });

    const portalUrl = await this.buildPortalAccessUrl({
      organizationId,
      accessToken,
    });

    await this.emailService.sendAccessGrantedEmail({
      toEmail: grant.subjectEmail,
      toName: grant.accessRequest.name,
      organizationName: grant.accessRequest.organization.name,
      expiresAt: grant.expiresAt,
      portalUrl,
      // A bypassed grant has no NDA agreement; an NDA-signed grant links a
      // 'signed' one. Mirror the original email's copy when resending.
      ndaBypassed: grant.ndaAgreement?.status !== 'signed',
    });

    return { message: 'Access email resent successfully' };
  }

  async resendNda(organizationId: string, requestId: string) {
    const request = await db.trustAccessRequest.findFirst({
      where: {
        id: requestId,
        organizationId,
      },
      include: {
        organization: true,
        ndaAgreements: {
          where: { status: 'pending' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Access request not found');
    }

    if (request.status !== 'approved') {
      throw new BadRequestException('Request must be approved first');
    }

    const pendingNda = request.ndaAgreements[0];
    if (!pendingNda) {
      throw new BadRequestException('No pending NDA agreement found');
    }

    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 7);

    // Rotate the token so a previously leaked link does not get a fresh
    // 7-day window — the old link stops working when the email is resent.
    const signToken = generateTrustToken(32);

    await db.trustNDAAgreement.update({
      where: { id: pendingNda.id },
      data: { signToken, signTokenExpiresAt: newExpiresAt },
    });

    const ndaSigningLink = await this.buildNdaSigningLink({
      organizationId,
      signToken,
    });

    await this.emailService.sendNdaSigningEmail({
      toEmail: request.email,
      toName: request.name,
      organizationName: request.organization.name,
      ndaSigningLink,
    });

    return {
      message: 'NDA signing email resent',
    };
  }
}
