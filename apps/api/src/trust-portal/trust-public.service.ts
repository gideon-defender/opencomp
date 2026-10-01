import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '@db';
import { isSafeHttpUrl } from '@gideon-defender/utils';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { APP_AWS_ORG_ASSETS_BUCKET, s3Client, getSignedUrl } from '../app/s3';
import { Prisma } from '@db';
import { TrustCustomFrameworkService } from './trust-custom-framework.service';
import type { TrustCustomFrameworkPublicItem } from './dto/trust-custom-framework.dto';

/**
 * Resolve a Trust by friendlyUrl, falling back to organizationId — the public
 * portal passes either. Two findUnique calls on unique columns give explicit
 * precedence (friendlyUrl wins), so an org whose friendlyUrl happens to equal
 * another org's id can't shadow it. Shared by the public read endpoints.
 */
export async function resolveTrustByFriendlyUrl<S extends Prisma.TrustSelect>(
  friendlyUrl: string,
  select: S,
): Promise<Prisma.TrustGetPayload<{ select: S }> | null> {
  return (
    (await db.trust.findUnique({ where: { friendlyUrl }, select })) ??
    (await db.trust.findUnique({
      where: { organizationId: friendlyUrl },
      select,
    }))
  );
}

/**
 * Unauthenticated public reads for the trust portal (profile, policies,
 * controls, overview, links, favicon, FAQs, custom frameworks). Split from
 * TrustAccessService so grant/NDA flows and public content evolve separately.
 */
@Injectable()
export class TrustPublicService {
  constructor(
    private readonly trustCustomFrameworkService: TrustCustomFrameworkService,
  ) {}

  /** Custom frameworks shown on the public portal (delegates to the dedicated service). */
  async getPublicCustomFrameworks(
    friendlyUrl: string,
  ): Promise<TrustCustomFrameworkPublicItem[]> {
    return this.trustCustomFrameworkService.getPublicCustomFrameworks(
      friendlyUrl,
    );
  }

  /**
   * Public portal header data: org name, domain, and branding. 404s unless
   * the portal exists and is published — the public page cannot render
   * without an org identity.
   */
  async getPublicProfile(friendlyUrl: string) {
    const trust = await resolveTrustByFriendlyUrl(friendlyUrl, {
      organizationId: true,
      friendlyUrl: true,
      domain: true,
      domainVerified: true,
      contactEmail: true,
      favicon: true,
      status: true,
    });

    if (!trust || trust.status !== 'published') {
      throw new NotFoundException('Trust portal not found');
    }

    const org = await db.organization.findUnique({
      where: { id: trust.organizationId },
      select: { name: true, primaryColor: true, logo: true },
    });

    const [logoUrl, faviconUrl] = await Promise.all([
      this.getAssetSignedUrl(org?.logo ?? null),
      this.getAssetSignedUrl(trust.favicon ?? null),
    ]);

    return {
      organizationName: org?.name ?? '',
      domain: trust.domain,
      domainVerified: trust.domainVerified,
      friendlyUrl: trust.friendlyUrl,
      primaryColor: org?.primaryColor ?? null,
      logoUrl,
      faviconUrl,
      contactEmail: trust.contactEmail,
    };
  }

  /**
   * Published policy names for a public portal. Names and timestamps only —
   * content stays behind the access-grant flow.
   */
  async getPublicPolicies(friendlyUrl: string) {
    const trust = await resolveTrustByFriendlyUrl(friendlyUrl, {
      organizationId: true,
      status: true,
    });

    if (!trust || trust.status !== 'published') {
      return [];
    }

    return db.policy.findMany({
      where: {
        organizationId: trust.organizationId,
        status: 'published',
        isArchived: false,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        updatedAt: true,
      },
      orderBy: [{ lastPublishedAt: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  /** Non-archived control names for a public portal. */
  async getPublicControls(friendlyUrl: string) {
    const trust = await resolveTrustByFriendlyUrl(friendlyUrl, {
      organizationId: true,
      status: true,
    });

    if (!trust || trust.status !== 'published') {
      return [];
    }

    return db.control.findMany({
      where: {
        organizationId: trust.organizationId,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async getPublicOverview(friendlyUrl: string) {
    const trust = await resolveTrustByFriendlyUrl(friendlyUrl, {
      overviewTitle: true,
      overviewContent: true,
      showOverview: true,
      status: true,
    });

    if (!trust || trust.status !== 'published' || !trust.showOverview) {
      return null;
    }

    return {
      title: trust.overviewTitle,
      content: trust.overviewContent,
    };
  }

  /**
   * Whether the public trust portal offers the AI-assisted Security
   * Questionnaire. False when the portal is missing or unpublished — every
   * sibling read hides unpublished content, and the questionnaire button
   * must not advertise a portal that should not render.
   */
  async getPublicSecurityQuestionnaireEnabled(
    friendlyUrl: string,
  ): Promise<boolean> {
    const trust = await resolveTrustByFriendlyUrl(friendlyUrl, {
      securityQuestionnaireEnabled: true,
      status: true,
    });

    if (!trust || trust.status !== 'published') {
      return false;
    }

    return trust.securityQuestionnaireEnabled ?? true;
  }

  async getPublicCustomLinks(friendlyUrl: string) {
    const trust = await resolveTrustByFriendlyUrl(friendlyUrl, {
      organizationId: true,
      status: true,
    });

    if (!trust || trust.status !== 'published') {
      return [];
    }

    const links = await db.trustCustomLink.findMany({
      where: {
        organizationId: trust.organizationId,
        isActive: true,
      },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        url: true,
      },
    });

    // Defense in depth: the write path validates http(s), but legacy rows
    // predate it — never serve a non-http(s) href to public consumers.
    return links.filter((link) => isSafeHttpUrl(link.url));
  }

  async getPublicFavicon(friendlyUrl: string): Promise<string | null> {
    const trust = await resolveTrustByFriendlyUrl(friendlyUrl, {
      favicon: true,
      status: true,
    });

    if (!trust?.favicon || trust.status !== 'published') {
      return null;
    }

    return this.getFaviconSignedUrl(trust.favicon);
  }

  /**
   * FAQ content for a published trust portal. Missing or unpublished portals
   * are not found — public callers must never create or publish records.
   * Render markdown WITHOUT rehype-raw (no raw HTML) for security.
   */
  async getFaqs(friendlyUrl: string): Promise<{ faqs: unknown[] | null }> {
    const trust = await resolveTrustByFriendlyUrl(friendlyUrl, {
      organizationId: true,
      status: true,
    });

    if (!trust || trust.status !== 'published') {
      throw new NotFoundException('Trust site not found');
    }

    const organization = await db.organization.findUnique({
      where: { id: trust.organizationId },
      select: { trustPortalFaqs: true },
    });

    const faqs = organization?.trustPortalFaqs;
    return { faqs: Array.isArray(faqs) ? faqs : null };
  }

  async getTrustBrandingByOrganizationId(organizationId: string): Promise<{
    friendlyUrl: string;
    faviconUrl: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
    securityQuestionnaireEnabled: boolean;
  }> {
    const [trust, org] = await Promise.all([
      db.trust.findUnique({
        where: { organizationId },
        select: {
          friendlyUrl: true,
          favicon: true,
          securityQuestionnaireEnabled: true,
        },
      }),
      db.organization.findUnique({
        where: { id: organizationId },
        select: { logo: true, primaryColor: true },
      }),
    ]);

    const friendlyUrl = trust?.friendlyUrl ?? organizationId;
    const [faviconUrl, logoUrl] = await Promise.all([
      this.getAssetSignedUrl(trust?.favicon ?? null),
      this.getAssetSignedUrl(org?.logo ?? null),
    ]);

    return {
      friendlyUrl,
      faviconUrl,
      logoUrl,
      primaryColor: org?.primaryColor ?? null,
      securityQuestionnaireEnabled: trust?.securityQuestionnaireEnabled ?? true,
    };
  }

  private async getFaviconSignedUrl(
    faviconKey: string,
  ): Promise<string | null> {
    return this.getAssetSignedUrl(faviconKey);
  }

  private async getAssetSignedUrl(
    assetKey: string | null | undefined,
  ): Promise<string | null> {
    if (!s3Client || !APP_AWS_ORG_ASSETS_BUCKET) {
      return null;
    }

    if (!assetKey) {
      return null;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: APP_AWS_ORG_ASSETS_BUCKET,
        Key: assetKey,
      });
      return await getSignedUrl(s3Client, command, { expiresIn: 86400 }); // 24 hours
    } catch {
      return null;
    }
  }
}
