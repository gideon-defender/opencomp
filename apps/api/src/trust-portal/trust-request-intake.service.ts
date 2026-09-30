import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { db } from '@db';
import {
  CreateAccessRequestDto,
  ListAccessRequestsDto,
} from './dto/trust-access.dto';
import {
  buildPublicPortalAccessUrl as buildPublicUrl,
  findPublishedTrustByRouteId as findTrustByRouteId,
  resolveTrustAppUrl,
} from './trust-portal-urls';
import { TrustEmailService } from './email.service';
import { TrustGrantTokenService } from './trust-grant-token.service';

/**
 * Access-request intake for trust portals: submit, list, and read.
 * Split from TrustAccessService.
 */
@Injectable()
export class TrustRequestIntakeService {
  private readonly logger = new Logger(TrustRequestIntakeService.name);

  constructor(
    private readonly emailService: TrustEmailService,
    private readonly grantTokens: TrustGrantTokenService,
  ) {}

  private findPublishedTrustByRouteId(id: string) {
    return findTrustByRouteId(id);
  }

  private buildPublicPortalAccessUrl(params: {
    organizationId: string;
    accessToken: string;
  }): Promise<string> {
    return buildPublicUrl({
      trustAppUrl: resolveTrustAppUrl(),
      organizationId: params.organizationId,
      accessToken: params.accessToken,
    });
  }

  async getMemberIdFromUserId(
    userId: string,
    organizationId: string,
  ): Promise<string | undefined> {
    const member = await db.member.findFirst({
      where: {
        userId,
        organizationId,
      },
      select: {
        id: true,
      },
    });
    return member?.id;
  }

  async createAccessRequest(
    id: string,
    dto: CreateAccessRequestDto,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ) {
    const trust = await this.findPublishedTrustByRouteId(id);

    // Normalize once: email matching is case-insensitive everywhere else
    // (signNda, allow-list helpers), so lookups and storage must agree.
    // All response paths below return the same shape on purpose — distinct
    // grant/pending/created answers would let callers probe which emails
    // hold active grants (same rationale as reclaimAccess).
    const normalizedEmail = dto.email.toLowerCase().trim();
    const genericResponse = {
      status: 'under_review',
      message: 'Access request submitted for review',
    };

    // Check if the email already has an active grant
    const existingGrant = await db.trustAccessGrant.findFirst({
      where: {
        subjectEmail: normalizedEmail,
        status: 'active',
        expiresAt: {
          gt: new Date(),
        },
        accessRequest: {
          organizationId: trust.organizationId,
        },
      },
      // Longest-lived grant wins when several are active for one email.
      orderBy: { expiresAt: 'desc' },
      include: {
        accessRequest: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (existingGrant) {
      // Reuse the reclaim flow: rotate the access token if needed and email a
      // fresh portal link to the requester so they don't need a separate
      // "Reclaim access" step.
      const { accessToken } =
        await this.grantTokens.resolveLiveAccessToken(existingGrant);
      const accessLink = await this.buildPublicPortalAccessUrl({
        organizationId: trust.organizationId,
        accessToken,
      });

      await this.emailService.sendAccessReclaimEmail({
        toEmail: normalizedEmail,
        toName: existingGrant.accessRequest.name,
        organizationName: existingGrant.accessRequest.organization.name,
        accessLink,
        expiresAt: existingGrant.expiresAt,
      });

      return genericResponse;
    }

    const existingRequest = await db.trustAccessRequest.findFirst({
      where: {
        organizationId: trust.organizationId,
        email: normalizedEmail,
        status: 'under_review',
      },
    });

    if (existingRequest) {
      return genericResponse;
    }

    const request = await db.trustAccessRequest.create({
      data: {
        organizationId: trust.organizationId,
        name: dto.name,
        email: normalizedEmail,
        company: dto.company,
        jobTitle: dto.jobTitle,
        purpose: dto.purpose,
        requestedDurationDays: dto.requestedDurationDays,
        status: 'under_review',
        ipAddress,
        userAgent,
      },
    });

    // The `existingRequest` read above and this insert are not atomic, so
    // two concurrent submits can both insert. The loser deletes its own row
    // before any notification goes out: the oldest row wins, ties break by
    // id, so exactly one request survives and the org gets exactly one email.
    const olderDuplicate = await db.trustAccessRequest.findFirst({
      where: {
        organizationId: trust.organizationId,
        email: normalizedEmail,
        status: 'under_review',
        OR: [
          { createdAt: { lt: request.createdAt } },
          {
            createdAt: request.createdAt,
            id: { lt: request.id },
          },
        ],
      },
      select: { id: true },
    });

    if (olderDuplicate) {
      await db.trustAccessRequest.delete({ where: { id: request.id } });
      return genericResponse;
    }

    // Send notification email to organization
    await this.sendAccessRequestNotificationToOrg(
      trust.organizationId,
      request.id,
      trust.organization.name,
      dto,
    );

    return genericResponse;
  }

  private async sendAccessRequestNotificationToOrg(
    organizationId: string,
    requestId: string,
    organizationName: string,
    dto: CreateAccessRequestDto,
  ) {
    // Get contact email from Trust or fallback to owner/admin emails
    const trust = await db.trust.findUnique({
      where: { organizationId },
      select: { contactEmail: true },
    });

    let notificationEmails: string[] = [];

    // Use contactEmail if available
    if (trust?.contactEmail) {
      notificationEmails.push(trust.contactEmail);
    } else {
      // Fallback: Get owner and admin emails
      const members = await db.member.findMany({
        where: {
          organizationId,
        },
        include: {
          user: {
            select: {
              email: true,
            },
          },
        },
      });

      // Filter for members with owner or admin role (handles comma-separated roles)
      const ownerAdminMembers = members.filter((m) => {
        const role = m.role.toLowerCase();
        return role.includes('owner') || role.includes('admin');
      });

      notificationEmails = ownerAdminMembers
        .map((m) => m.user.email)
        .filter((email): email is string => !!email);
    }

    // If no notification emails found, skip sending
    if (notificationEmails.length === 0) {
      return;
    }

    // Construct review URL pointing at the pending access requests list, not
    // the trust portal settings/overview page.
    const reviewUrl = `${process.env.BETTER_AUTH_URL}/${organizationId}/trust/access-requests`;

    // Send notification to all recipients. Failures must stay visible:
    // a rejected send without a log leaves the requester on `under_review`
    // while the org never learns the request exists.
    const emailPromises = notificationEmails.map((email) =>
      this.emailService.sendAccessRequestNotification({
        toEmail: email,
        organizationName,
        requesterName: dto.name,
        requesterEmail: dto.email,
        requesterCompany: dto.company,
        requesterJobTitle: dto.jobTitle,
        purpose: dto.purpose,
        requestedDurationDays: dto.requestedDurationDays,
        reviewUrl,
      }),
    );

    const results = await Promise.allSettled(emailPromises);
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failures.length > 0) {
      this.logger.error(
        `Failed to send ${failures.length}/${notificationEmails.length} access-request notifications for request ${requestId} (org ${organizationId}): ${failures
          .map((failure) =>
            failure.reason instanceof Error
              ? failure.reason.message
              : String(failure.reason),
          )
          .join('; ')}`,
      );
    }
  }

  async listAccessRequests(organizationId: string, dto: ListAccessRequestsDto) {
    const where = {
      organizationId,
      ...(dto.status && { status: dto.status }),
    };

    const requests = await db.trustAccessRequest.findMany({
      where,
      include: {
        reviewer: {
          select: {
            id: true,
            user: { select: { name: true, email: true } },
          },
        },
        grant: {
          select: {
            id: true,
            status: true,
            expiresAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests;
  }

  async getAccessRequest(organizationId: string, requestId: string) {
    const request = await db.trustAccessRequest.findFirst({
      where: {
        id: requestId,
        organizationId,
      },
      include: {
        reviewer: {
          select: {
            id: true,
            user: { select: { name: true, email: true } },
          },
        },
        grant: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Access request not found');
    }

    return request;
  }
}
