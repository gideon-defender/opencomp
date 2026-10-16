import { db, normalizeEmail } from '@db';
import type { User } from '@db';
import { lookupGideonTenantIdentity } from '../../auth/gideon-tenant-identity';
import { findClaimableExpandRow } from '../../auth/oidc-link';
import { findLegacySharedUser } from '../../auth/legacy-shared-user';
import { linkIdentity } from './hr-sync-idp-link';

export type HrIdentity = Pick<
  NonNullable<Awaited<ReturnType<typeof lookupGideonTenantIdentity>>>,
  'id' | 'email' | 'display_name'
>;
export type HrIdentityResolver = (params: {
  email: string;
}) => Promise<HrIdentity | null>;

/**
 * Tenant-scoped identity resolution: the local subject fast-path only
 * considers User rows owned by the sync's tenant (`tenantId ==
 * organizationId`). A matching email in another tenant is a different
 * account and must never satisfy this tenant's lookup.
 */
export function createHrIdentityResolver({
  organizationId,
}: {
  organizationId: string;
}): HrIdentityResolver {
  const pending = new Map<string, Promise<HrIdentity | null>>();
  return ({ email }) => {
    const normalizedEmail = normalizeEmail(email);
    const cached = pending.get(normalizedEmail);
    if (cached) return cached;
    const lookup = async (): Promise<HrIdentity | null> => {
      const local = await db.user.findFirst({
        where: {
          tenantId: organizationId,
          email: { equals: normalizedEmail, mode: 'insensitive' },
          oidcSub: { not: null },
        },
      });
      if (local?.oidcSub?.trim()) {
        return {
          id: local.oidcSub,
          email: local.email,
          display_name: local.name,
        };
      }
      return lookupGideonTenantIdentity({
        tenantId: organizationId,
        email: normalizedEmail,
      });
    };
    const result = lookup();
    pending.set(normalizedEmail, result);
    // Evict on settle: the map only dedupes concurrent in-flight lookups.
    // Keeping settled promises would poison later retries with the first
    // failure and grow the map for the resolver's lifetime.
    const evict = (): void => {
      if (pending.get(normalizedEmail) === result)
        pending.delete(normalizedEmail);
    };
    result.then(evict, evict);
    return result;
  };
}

/**
 * Materialize identities verified through a local link or Gideon Auth lookup.
 * Canonical subject first; tenant-scoped email second; tenant-scoped creation
 * and race recovery. Never links or overwrites a row owned by another tenant.
 * Expand-window fallback: rows predating the tenant backfill never match the
 * tenant-scoped lookups, so a global email match with no ownership is claimed
 * for the sync tenant (the legacy global key still guards the window).
 */
export async function getHrSyncUser({
  identity,
  organizationId,
}: {
  identity: HrIdentity;
  organizationId: string;
}): Promise<User> {
  const email = normalizeEmail(identity.email);
  const bySubject = await db.user.findUnique({
    where: { oidcSub: identity.id },
  });
  if (bySubject)
    return linkIdentity({ existing: bySubject, identity, organizationId });

  const existing = await db.user.findFirst({
    where: {
      tenantId: organizationId,
      email: { equals: email, mode: 'insensitive' },
    },
  });
  if (existing) return linkIdentity({ existing, identity, organizationId });
  // Expand-window fallback: a legacy row predating the tenant backfill never
  // matches the tenant-scoped lookup above. Only rows with no ownership are
  // eligible — a row owned by another tenant is skipped so creation handles
  // it (post-contract) instead of stealing it.
  const expandRow = await findClaimableExpandRow(email);
  if (expandRow)
    return linkIdentity({ existing: expandRow, identity, organizationId });
  try {
    return await db.user.create({
      data: {
        email,
        name: identity.display_name || email.split('@')[0] || email,
        emailVerified: false,
        oidcSub: identity.id,
        tenantId: organizationId,
        oidcTenantId: organizationId,
      },
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'P2002'
    )
      throw error;
    const shared = await findLegacySharedUser({
      purpose: 'hr-sync',
      tenantId: organizationId,
      normalizedEmail: email,
      sub: identity.id,
    });
    if (shared) return shared;
    const raced = await db.user.findFirst({
      where: {
        tenantId: organizationId,
        email: { equals: email, mode: 'insensitive' },
      },
    });
    if (raced)
      return linkIdentity({ existing: raced, identity, organizationId });
    // Expand-window fallback (see above): the P2002 may come from the legacy
    // global email key on a row that predates the tenant backfill.
    const expandRaced = await findClaimableExpandRow(email);
    if (expandRaced)
      return linkIdentity({
        existing: expandRaced,
        identity,
        organizationId,
      });
    const bySubject = await db.user.findUnique({
      where: { oidcSub: identity.id },
    });
    if (!bySubject) {
      // The conflicting row vanished concurrently: report a retryable
      // failure instead of leaking the raw Prisma error to the sync job.
      throw new Error(
        `HR sync hit a user creation conflict for identity ${identity.id}; retry the sync`,
      );
    }
    return linkIdentity({ existing: bySubject, identity, organizationId });
  }
}
