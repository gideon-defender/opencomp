import { ConflictException, NotFoundException } from '@nestjs/common';
import { db, Prisma } from '@db';
import {
  normalizePortalDomain,
  normalizePortalUrl,
} from './trust-access-helpers';

/**
 * Portal URL builders. Extracted from TrustAccessService so link
 * construction (custom-domain aware) evolves in one focused module.
 * `trustAppUrl` is passed explicitly — callers own the env default.
 */

/** Shared Trust app base URL. Fails closed in production: a silent localhost
 * fallback would ship dead NDA/grant bearer links to real recipients.
 * Localhost stays as a dev/test convenience only. */
export function resolveTrustAppUrl(): string {
  const value = process.env.TRUST_APP_URL || process.env.PORTAL_URL;
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'TRUST_APP_URL (or PORTAL_URL) is not set — emailed trust links would point at localhost',
    );
  }
  return 'http://localhost:3008';
}

/**
 * Slugs that must never become a portal friendlyUrl. The trust-access
 * router mounts literal `nda/:token`, `access/:token`, and `admin/*`
 * routes ahead of the public `:friendlyUrl/*` reads, so a portal with one
 * of these slugs would have its public pages shadowed by the token lookup
 * (e.g. `/nda/faqs` reads as NDA token `faqs`, never as portal `nda`).
 */
export const RESERVED_PORTAL_SLUGS = new Set(['nda', 'access', 'admin']);

/** True when a slug would collide with a literal trust-access route. */
export function isReservedPortalSlug(slug: string): boolean {
  return RESERVED_PORTAL_SLUGS.has(slug.toLowerCase().trim());
}

/** Slugify an organization name for use as a portal URL segment. */
function slugifyOrganizationName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * Single writer for the `trust.friendlyUrl` column. Callers may pass the
 * organization name for a human-readable first candidate; without one the
 * organizationId is used. Collisions retry with a numeric suffix — never
 * hand back a known-colliding slug, since friendlyUrl wins in resolution
 * and a collision would route links to the wrong portal.
 */
export async function ensureFriendlyUrl(
  organizationId: string,
  options?: { organizationName?: string },
): Promise<string> {
  const current = await db.trust.findUnique({
    where: { organizationId },
    select: { friendlyUrl: true },
  });

  if (current?.friendlyUrl) return current.friendlyUrl;

  const baseCandidate =
    slugifyOrganizationName(options?.organizationName ?? '') || organizationId;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate =
      attempt === 0 ? baseCandidate : `${baseCandidate}-${attempt + 1}`;

    // Reserved slugs shadow literal trust-access routes (nda/:token,
    // access/:token, admin/*) — skip them the same way as taken slugs so
    // an org named e.g. "NDA" lands on `nda-2` instead of a dead portal.
    if (isReservedPortalSlug(candidate)) {
      continue;
    }

    const taken = await db.trust.findUnique({
      where: { friendlyUrl: candidate },
      select: { organizationId: true },
    });

    // Best-effort fast path: skip only on positive proof another org holds
    // the slug. The unique constraint below stays the correctness backstop.
    if (taken?.organizationId && taken.organizationId !== organizationId) {
      continue;
    }

    try {
      await db.trust.upsert({
        where: { organizationId },
        update: { friendlyUrl: candidate },
        create: {
          organizationId,
          friendlyUrl: candidate,
          status: 'published',
        },
      });
      return candidate;
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // A concurrent call may have assigned a slug since our first read.
        const existing = await db.trust.findUnique({
          where: { organizationId },
          select: { friendlyUrl: true },
        });
        if (existing?.friendlyUrl) return existing.friendlyUrl;
        continue;
      }
      throw error;
    }
  }

  throw new ConflictException(
    'Could not assign a portal URL — pick a custom friendly URL instead',
  );
}

/** Portal base URL, checking the verified custom domain first. */
export async function buildPortalBaseUrl(params: {
  trustAppUrl: string;
  organizationId: string;
}): Promise<string> {
  const { trustAppUrl, organizationId } = params;

  const trust = await db.trust.findUnique({
    where: { organizationId },
    select: { domain: true, domainVerified: true, friendlyUrl: true },
  });

  if (trust?.domain && trust.domainVerified) {
    return `https://${normalizePortalDomain(trust.domain)}`;
  }

  const urlId = trust?.friendlyUrl || (await ensureFriendlyUrl(organizationId));

  return `${normalizePortalUrl(trustAppUrl)}/${urlId}`;
}

/** Portal access URL carrying a grant access token. */
export async function buildPortalAccessUrl(params: {
  trustAppUrl: string;
  organizationId: string;
  accessToken: string;
}): Promise<string> {
  const { trustAppUrl, organizationId, accessToken } = params;
  const base = await buildPortalBaseUrl({ trustAppUrl, organizationId });
  return `${base}/access/${accessToken}`;
}

/**
 * NDA signing link on the portal base URL so verified custom domains
 * receive links on their own host instead of the default host.
 */
export async function buildNdaSigningLink(params: {
  trustAppUrl: string;
  organizationId: string;
  signToken: string;
}): Promise<string> {
  const { trustAppUrl, organizationId, signToken } = params;
  const base = await buildPortalBaseUrl({ trustAppUrl, organizationId });
  return `${base}/nda/${signToken}`;
}

/**
 * Read-only portal base URL for unauthenticated paths (NDA-token reads,
 * grant reclaim, access-request flows). Never creates or publishes trust
 * rows — unlike buildPortalBaseUrl, a missing row falls back to the
 * organizationId segment instead of calling ensureFriendlyUrl. Links built
 * this way 404 downstream when no published portal exists, which is the
 * correct outcome for a portal that was never configured.
 */
export async function buildPublicPortalBaseUrl(params: {
  trustAppUrl: string;
  organizationId: string;
}): Promise<string> {
  const { trustAppUrl, organizationId } = params;

  const trust = await db.trust.findUnique({
    where: { organizationId },
    select: { domain: true, domainVerified: true, friendlyUrl: true },
  });

  if (trust?.domain && trust.domainVerified) {
    return `https://${normalizePortalDomain(trust.domain)}`;
  }

  const urlId = trust?.friendlyUrl || organizationId;

  return `${normalizePortalUrl(trustAppUrl)}/${urlId}`;
}

/** Read-only variant of buildPortalAccessUrl for unauthenticated paths. */
export async function buildPublicPortalAccessUrl(params: {
  trustAppUrl: string;
  organizationId: string;
  accessToken: string;
}): Promise<string> {
  const { trustAppUrl, organizationId, accessToken } = params;
  const base = await buildPublicPortalBaseUrl({ trustAppUrl, organizationId });
  return `${base}/access/${accessToken}`;
}

/** Read-only variant of buildNdaSigningLink for unauthenticated paths. */
export async function buildPublicNdaSigningLink(params: {
  trustAppUrl: string;
  organizationId: string;
  signToken: string;
}): Promise<string> {
  const { trustAppUrl, organizationId, signToken } = params;
  const base = await buildPublicPortalBaseUrl({ trustAppUrl, organizationId });
  return `${base}/nda/${signToken}`;
}

/** Resolve a published portal by friendly URL or organization ID. */
export async function findPublishedTrustByRouteId(id: string) {
  // First, try treating `id` as the existing friendlyUrl.
  let trust = await db.trust.findUnique({
    where: { friendlyUrl: id },
    include: { organization: true },
  });

  // If none found, fall back to treating `id` as organizationId.
  if (!trust) {
    trust = await db.trust.findFirst({
      where: { organizationId: id },
      include: { organization: true },
    });
  }

  // Read-only resolution: public callers must never create or publish
  // portal records. Missing or unpublished portals are not found.
  if (!trust || trust.status !== 'published') {
    throw new NotFoundException('Trust site not found');
  }

  return trust;
}
