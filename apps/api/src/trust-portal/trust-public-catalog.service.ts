import { Injectable } from '@nestjs/common';
import { db, Prisma, TrustFramework } from '@db';
import {
  COMPLIANCE_BADGE_LABELS,
  FRAMEWORK_TITLES,
  isSafeHttpUrl,
  toSafeExternalHref,
} from '@gideon-defender/utils';
import { extractComplianceBadges } from './cert-badge-mapper';
import { resolveTrustByFriendlyUrl } from './trust-public.service';

/**
 * Native (non-custom) framework columns on the Trust model with
 * TrustFramework enum values. Display titles come from the shared
 * FRAMEWORK_TITLES map in `@gideon-defender/utils` — do not hardcode
 * titles here. Single source of truth for the public frameworks listing.
 */
const NATIVE_FRAMEWORKS: Array<{
  column:
    | 'soc2type1'
    | 'soc2type2'
    | 'soc3'
    | 'iso27001'
    | 'iso42001'
    | 'iso9001'
    | 'gdpr'
    | 'hipaa'
    | 'pci_dss'
    | 'nen7510'
    | 'pipeda'
    | 'ccpa'
    | 'dora'
    | 'nis_2'
    | 'hitrust_csf'
    | 'nist_csf'
    | 'nist_800_53';
  framework: TrustFramework;
}> = [
  { column: 'soc2type1', framework: TrustFramework.soc2_type1 },
  { column: 'soc2type2', framework: TrustFramework.soc2_type2 },
  { column: 'soc3', framework: TrustFramework.soc3 },
  { column: 'iso27001', framework: TrustFramework.iso_27001 },
  { column: 'iso42001', framework: TrustFramework.iso_42001 },
  { column: 'iso9001', framework: TrustFramework.iso_9001 },
  { column: 'gdpr', framework: TrustFramework.gdpr },
  { column: 'hipaa', framework: TrustFramework.hipaa },
  { column: 'pci_dss', framework: TrustFramework.pci_dss },
  { column: 'nen7510', framework: TrustFramework.nen_7510 },
  { column: 'pipeda', framework: TrustFramework.pipeda },
  { column: 'ccpa', framework: TrustFramework.ccpa },
  { column: 'dora', framework: TrustFramework.dora },
  { column: 'nis_2', framework: TrustFramework.nis_2 },
  { column: 'hitrust_csf', framework: TrustFramework.hitrust_csf },
  { column: 'nist_csf', framework: TrustFramework.nist_csf },
  { column: 'nist_800_53', framework: TrustFramework.nist_800_53 },
];

type TrustSelect = Prisma.TrustSelect;

/**
 * Public catalog reads for the trust portal (enabled frameworks with
 * certificate presence, vendor/subprocessor listing). Split from
 * TrustAccessService so grant/NDA flows and public content evolve separately.
 */
@Injectable()
export class TrustPublicCatalogService {
  /**
   * Enabled native frameworks with compliance status and certificate
   * presence. Empty when the portal is missing or unpublished — sections
   * hide instead of 404ing so a partially configured portal still renders.
   */
  async getPublicFrameworks(friendlyUrl: string) {
    const trust = await resolveTrustByFriendlyUrl(friendlyUrl, {
      organizationId: true,
      status: true,
      soc2type1: true,
      soc2type1_status: true,
      soc2type2: true,
      soc2type2_status: true,
      soc3: true,
      soc3_status: true,
      iso27001: true,
      iso27001_status: true,
      iso42001: true,
      iso42001_status: true,
      iso9001: true,
      iso9001_status: true,
      gdpr: true,
      gdpr_status: true,
      hipaa: true,
      hipaa_status: true,
      pci_dss: true,
      pci_dss_status: true,
      nen7510: true,
      nen7510_status: true,
      pipeda: true,
      pipeda_status: true,
      ccpa: true,
      ccpa_status: true,
      dora: true,
      dora_status: true,
      nis_2: true,
      nis_2_status: true,
      hitrust_csf: true,
      hitrust_csf_status: true,
      nist_csf: true,
      nist_csf_status: true,
      nist_800_53: true,
      nist_800_53_status: true,
    } satisfies TrustSelect);

    if (!trust || trust.status !== 'published') {
      return [];
    }

    const resources = await db.trustResource.findMany({
      where: {
        organizationId: trust.organizationId,
        framework: { not: null },
      },
      select: { framework: true },
    });
    const certified = new Set(resources.map((r) => r.framework));

    return NATIVE_FRAMEWORKS.filter((f) => trust[f.column]).map((f) => ({
      key: f.column,
      title: FRAMEWORK_TITLES[f.framework] ?? f.framework,
      status: trust[`${f.column}_status` as keyof typeof trust],
      hasCertificate: certified.has(f.framework),
    }));
  }

  async getPublicVendors(friendlyUrl: string) {
    const trust = await resolveTrustByFriendlyUrl(friendlyUrl, {
      organizationId: true,
      status: true,
    });

    if (!trust || trust.status !== 'published') {
      return [];
    }

    const vendors = await db.vendor.findMany({
      where: {
        organizationId: trust.organizationId,
        showOnTrustPortal: true,
      },
      orderBy: [{ trustPortalOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        website: true,
        logoUrl: true,
        complianceBadges: true,
      },
    });

    // Get websites to look up in GlobalVendors
    const websiteList = vendors
      .map((v) => v.website)
      .filter((w): w is string => !!w);

    // Fetch GlobalVendors data for trust portal URLs
    const globalVendors = websiteList.length
      ? await db.globalVendors.findMany({
          where: { website: { in: websiteList } },
          select: {
            website: true,
            riskAssessmentData: true,
          },
        })
      : [];

    // Create a map for quick lookup
    const globalVendorMap = new Map(
      globalVendors.map((gv) => [gv.website, gv.riskAssessmentData]),
    );

    // Enrich vendors with trust portal URL and compliance badges from GlobalVendors
    return vendors.map((vendor) => {
      // Org-controlled website is untrusted href input — run it through the
      // shared rule so javascript:/data: schemes never reach <a href>
      // consumers. Bare domains gain an https:// prefix (href-ready).
      let trustPortalUrl: string | null = toSafeExternalHref(vendor.website);
      let badges = vendor.complianceBadges;

      // Enrich from GlobalVendors riskAssessmentData
      if (vendor.website) {
        const riskData = globalVendorMap.get(vendor.website);
        if (riskData && typeof riskData === 'object' && riskData !== null) {
          const parsed = riskData as Record<string, unknown>;

          // Extract trust portal URL. Third-party enrichment data is
          // untrusted input — accept only http(s) targets.
          const links: unknown = parsed.links;
          if (Array.isArray(links) && links.length > 0) {
            const firstLink: unknown = links[0];
            const url =
              typeof firstLink === 'object' &&
              firstLink !== null &&
              'url' in firstLink
                ? (firstLink as { url?: unknown }).url
                : undefined;
            if (typeof url === 'string' && isSafeHttpUrl(url)) {
              trustPortalUrl = url;
            }
          }

          // Prefer badges freshly derived from the vendor's verified
          // certifications so the public Trust Centre always matches the admin
          // Vendors tab, rather than trusting a possibly-stale stored
          // complianceBadges value (CS-688). Fall back to the stored value only
          // when there is nothing to derive.
          const derivedBadges = extractComplianceBadges(parsed);
          if (derivedBadges.length > 0) {
            badges = derivedBadges;
          }
        }
      }
      return {
        ...vendor,
        // Stored logos are org-controlled URLs: only http(s) targets reach
        // <img src> consumers. Anything else renders the initials fallback.
        logoUrl:
          vendor.logoUrl && isSafeHttpUrl(vendor.logoUrl)
            ? vendor.logoUrl
            : null,
        complianceBadges: this.formatComplianceBadgeLabels(badges),
        trustPortalUrl,
      };
    });
  }

  /**
   * Format compliance badges as simple type + label pairs for external rendering.
   * Does NOT include branded icons to avoid implying vendors were certified through us.
   */
  private formatComplianceBadgeLabels(
    badges: unknown,
  ): { type: string; label: string }[] {
    if (!badges || !Array.isArray(badges)) {
      return [];
    }

    return badges
      .filter(
        (badge): badge is { type: unknown } =>
          typeof badge === 'object' && badge !== null && 'type' in badge,
      )
      .filter(
        (badge): badge is { type: string } =>
          typeof badge.type === 'string' && badge.type.length > 0,
      )
      .map((badge) => ({
        type: badge.type,
        label: COMPLIANCE_BADGE_LABELS[badge.type] ?? badge.type.toUpperCase(),
      }));
  }
}
