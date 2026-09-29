import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import {
  generateTrustToken,
  isDomainInAllowList,
  isEmailInAllowList,
} from './trust-access-helpers';
import { ApproveAccessRequestDto } from './dto/trust-access.dto';
import {
  buildNdaSigningLink,
  buildPortalAccessUrl,
  resolveTrustAppUrl,
} from './trust-portal-urls';
import { TrustEmailService } from './email.service';

/**
 * Access-request decisions for trust portals: approve (direct grant or
 * NDA-gated) and its atomic grant-minting helper. Split from
 * TrustAccessService.
 */
@Injectable()
export class TrustRequestApprovalService {
  constructor(private readonly emailService: TrustEmailService) {}

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

  async approveRequest(
    organizationId: string,
    requestId: string,
    dto: ApproveAccessRequestDto,
    memberId?: string,
  ) {
    const request = await db.trustAccessRequest.findFirst({
      where: {
        id: requestId,
        organizationId,
      },
      include: {
        organization: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Access request not found');
    }

    if (request.status !== 'under_review') {
      throw new BadRequestException(
        `Request is already ${request.status}, cannot approve`,
      );
    }

    const durationDays =
      dto.durationDays || request.requestedDurationDays || 30;

    const member = memberId
      ? await db.member.findFirst({
          where: { id: memberId, organizationId },
          select: { id: true, userId: true },
        })
      : null;

    if (!member) {
      throw new BadRequestException('Invalid member ID');
    }

    // Check if the email or its domain is in the allow list
    const trust = await db.trust.findUnique({
      where: { organizationId },
      select: { allowedDomains: true, allowedEmails: true },
    });

    const isAllowedDomain = isDomainInAllowList(
      request.email,
      trust?.allowedDomains ?? [],
    );
    const isAllowedEmail = isEmailInAllowList(
      request.email,
      trust?.allowedEmails ?? [],
    );

    // If the email or domain is in the allow list, skip NDA and grant access directly
    if (isAllowedDomain || isAllowedEmail) {
      return this.approveWithoutNda({
        organizationId,
        requestId,
        request,
        member,
        durationDays,
        bypassReason: isAllowedEmail ? 'allowed email' : 'allowed domain',
      });
    }

    // Standard flow: require NDA signing
    const signToken = generateTrustToken(32);
    const signTokenExpiresAt = new Date();
    signTokenExpiresAt.setDate(signTokenExpiresAt.getDate() + 7);

    const result = await db.$transaction(async (tx) => {
      // Atomic transition first: only one concurrent approve can win, and
      // the loser exits before minting an NDA. The loser sees count 0 and
      // reports the request as already processed.
      const transition = await tx.trustAccessRequest.updateMany({
        where: { id: requestId, status: 'under_review' },
        data: {
          status: 'approved',
          reviewerMemberId: member.id,
          reviewedAt: new Date(),
          requestedDurationDays: durationDays,
        },
      });

      if (transition.count === 0) {
        throw new BadRequestException(
          'Request was already processed, cannot approve',
        );
      }

      const ndaAgreement = await tx.trustNDAAgreement.create({
        data: {
          organizationId,
          accessRequestId: requestId,
          signToken,
          signTokenExpiresAt,
          status: 'pending',
        },
      });

      const updatedRequest = await tx.trustAccessRequest.findUniqueOrThrow({
        where: { id: requestId },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId: member.userId,
          memberId: member.id,
          entityType: 'trust',
          entityId: requestId,
          description: `Access request approved for ${request.email}, NDA signature required`,
          data: {
            requestId,
            ndaAgreementId: ndaAgreement.id,
            durationDays,
          },
        },
      });

      return { request: updatedRequest, ndaAgreement, durationDays };
    });

    const ndaSigningLink = await this.buildNdaSigningLink({
      organizationId,
      signToken: result.ndaAgreement.signToken,
    });

    await this.emailService.sendNdaSigningEmail({
      toEmail: request.email,
      toName: request.name,
      organizationName: request.organization.name,
      ndaSigningLink,
    });

    return {
      request: result.request,
      ndaAgreement: result.ndaAgreement,
      message: 'NDA signing email sent',
    };
  }

  /**
   * Approve request without NDA for allowlisted domains/emails - grants immediate access
   */
  private async approveWithoutNda({
    organizationId,
    requestId,
    request,
    member,
    durationDays,
    bypassReason,
  }: {
    organizationId: string;
    requestId: string;
    request: {
      email: string;
      name: string;
      organization: { name: string };
    };
    member: { id: string; userId: string };
    durationDays: number;
    bypassReason: 'allowed domain' | 'allowed email';
  }) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    const accessToken = generateTrustToken(32);
    // Mirror the grant's own expiry rather than a fixed window, so the
    // emailed link stays valid for the whole approved duration.
    const accessTokenExpiresAt = expiresAt;

    const result = await db.$transaction(async (tx) => {
      // Atomic transition first — see approveRequest.
      const transition = await tx.trustAccessRequest.updateMany({
        where: { id: requestId, status: 'under_review' },
        data: {
          status: 'approved',
          reviewerMemberId: member.id,
          reviewedAt: new Date(),
          requestedDurationDays: durationDays,
        },
      });

      if (transition.count === 0) {
        throw new BadRequestException(
          'Request was already processed, cannot approve',
        );
      }

      const updatedRequest = await tx.trustAccessRequest.findUniqueOrThrow({
        where: { id: requestId },
      });

      const grant = await tx.trustAccessGrant.create({
        data: {
          accessRequestId: requestId,
          // Normalized: reclaim and grant lookups match on the lowercased
          // address, so a mixed-case allowlisted email must not store raw.
          subjectEmail: request.email.toLowerCase().trim(),
          expiresAt,
          accessToken,
          accessTokenExpiresAt,
          issuedByMemberId: member.id,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId: member.userId,
          memberId: member.id,
          entityType: 'trust',
          entityId: requestId,
          description: `Access request approved for ${request.email} (${bypassReason} - NDA bypassed)`,
          data: {
            requestId,
            grantId: grant.id,
            durationDays,
            ndaBypassed: true,
            bypassReason,
          },
        },
      });

      return { request: updatedRequest, grant };
    });

    const portalUrl = await this.buildPortalAccessUrl({
      organizationId,
      accessToken,
    });

    await this.emailService.sendAccessGrantedEmail({
      toEmail: request.email,
      toName: request.name,
      organizationName: request.organization.name,
      expiresAt: result.grant.expiresAt,
      portalUrl,
      ndaBypassed: true,
    });

    return {
      request: result.request,
      grant: result.grant,
      message: 'Access granted', // NDA bypassed for allowlisted domain/email
    };
  }
}
