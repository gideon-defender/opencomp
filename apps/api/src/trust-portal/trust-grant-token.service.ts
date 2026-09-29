import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '@db';
import { generateTrustToken } from './trust-access-helpers';
import {
  buildPublicPortalAccessUrl as buildPublicAccessUrl,
  findPublishedTrustByRouteId as findTrustByRouteId,
  resolveTrustAppUrl,
} from './trust-portal-urls';
import { TrustEmailService } from './email.service';

/**
 * Grant link-token rotation shared by reclaim, NDA, intake, and resend
 * flows. Split from TrustAccessService so rotation evolves in one place.
 */
@Injectable()
export class TrustGrantTokenService {
  constructor(private readonly emailService: TrustEmailService) {}

  private findPublishedTrustByRouteId(id: string) {
    return findTrustByRouteId(id);
  }

  private buildPublicPortalAccessUrl(params: {
    organizationId: string;
    accessToken: string;
  }): Promise<string> {
    return buildPublicAccessUrl({
      trustAppUrl: resolveTrustAppUrl(),
      organizationId: params.organizationId,
      accessToken: params.accessToken,
    });
  }

  /**
   * Shared access-token rotation: when the short-lived link token is missing
   * or expired, mint a fresh one that lives as long as the grant itself.
   * Returns the live token pair; persists only when rotation was needed.
   * The write is guarded on the previously observed token value so
   * concurrent callers (e.g. a double-submitted reclaim) cannot silently
   * invalidate each other's emailed links — the loser re-reads the winner's
   * token instead of overwriting it.
   */
  async resolveLiveAccessToken(grant: {
    id: string;
    accessToken: string | null;
    accessTokenExpiresAt: Date | null;
    expiresAt: Date;
  }): Promise<{ accessToken: string; accessTokenExpiresAt: Date }> {
    const now = new Date();
    if (
      grant.accessToken &&
      grant.accessTokenExpiresAt &&
      grant.accessTokenExpiresAt >= now
    ) {
      return {
        accessToken: grant.accessToken,
        accessTokenExpiresAt: grant.accessTokenExpiresAt,
      };
    }

    const accessToken = generateTrustToken(32);
    // Mirror the grant's own expiry rather than a fixed window, so the
    // emailed link stays valid for the whole approved duration.
    const accessTokenExpiresAt = grant.expiresAt;

    // Each rotation mints a fresh 192-bit token, so the old value uniquely
    // identifies this generation — a concurrent rotation changes it first
    // and this guarded write matches zero rows instead of clobbering it.
    const transition = await db.trustAccessGrant.updateMany({
      where: { id: grant.id, accessToken: grant.accessToken },
      data: { accessToken, accessTokenExpiresAt },
    });

    if (transition.count > 0) {
      return { accessToken, accessTokenExpiresAt };
    }

    // Lost the race: another caller rotated first. Re-read and use the
    // winner's token so every emailed link stays valid.
    const current = await db.trustAccessGrant.findUnique({
      where: { id: grant.id },
      select: {
        accessToken: true,
        accessTokenExpiresAt: true,
        expiresAt: true,
      },
    });

    if (
      current?.accessToken &&
      current.accessTokenExpiresAt &&
      current.accessTokenExpiresAt >= new Date()
    ) {
      return {
        accessToken: current.accessToken,
        accessTokenExpiresAt: current.accessTokenExpiresAt,
      };
    }

    throw new NotFoundException('Access grant not found');
  }

  async reclaimAccess(id: string, email: string, query?: string) {
    const trust = await this.findPublishedTrustByRouteId(id);
    const normalizedEmail = email.toLowerCase().trim();

    const grant = await db.trustAccessGrant.findFirst({
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
      // Multiple active grants can exist for one email (repeat approvals).
      // Pick the longest-lived one so the emailed link lasts as long as
      // possible instead of an arbitrary row.
      orderBy: { expiresAt: 'desc' },
      include: {
        accessRequest: {
          include: {
            organization: true,
          },
        },
        ndaAgreement: true,
      },
    });

    if (!grant) {
      // Generic response: do not reveal whether a grant exists for this
      // email (prevents address enumeration), and never return the link —
      // delivery happens via email only.
      return {
        message:
          'If an active grant exists for this email, an access link was sent',
      };
    }

    const { accessToken } = await this.resolveLiveAccessToken(grant);

    let accessLink = await this.buildPublicPortalAccessUrl({
      organizationId: trust.organizationId,
      accessToken,
    });

    // `query` lands in a link the recipient is primed to trust — accept
    // only short slug-like values (e.g. security-questionnaire) and drop
    // everything else instead of reflecting attacker input into the email.
    if (query && /^[a-z0-9-]{1,100}$/i.test(query)) {
      const separator = accessLink.includes('?') ? '&' : '?';
      accessLink = `${accessLink}${separator}query=${encodeURIComponent(query)}`;
    }

    await this.emailService.sendAccessReclaimEmail({
      toEmail: normalizedEmail,
      toName: grant.accessRequest.name,
      organizationName: grant.accessRequest.organization.name,
      accessLink,
      expiresAt: grant.expiresAt,
    });

    return {
      // Same shape as the no-grant path above: the link travels by email
      // only, so the response never distinguishes the two cases.
      message:
        'If an active grant exists for this email, an access link was sent',
    };
  }
}
