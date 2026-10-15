import { Logger } from '@nestjs/common';
import { db, normalizeEmail } from '@db';
import type { User } from '@db';
import { resolveAdoptEmail } from '../../auth/oidc-link';
import { findLegacySharedUser } from '../../auth/legacy-shared-user';
import type { HrIdentity } from './hr-sync-idp';

const logger = new Logger('HrSyncIdp');

/**
 * Claim expand-window ownership for null-tenant rows. Post-contract rows are
 * never null, so this is a no-op there. A P2002 means another row already
 * holds this tenant+email: surface a descriptive conflict (with both ids for
 * the operator) instead of returning the still-null row as a silent success,
 * which would only resurface as a contract-migration abort later.
 */
async function claimExpandOwnership({
  existing,
  organizationId,
}: {
  existing: User;
  organizationId: string;
}): Promise<User> {
  if (existing.tenantId) return existing;
  try {
    return await db.user.update({
      where: { id: existing.id },
      data: { tenantId: organizationId },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const winner = await db.user.findFirst({
      where: {
        tenantId: organizationId,
        email: { equals: existing.email, mode: 'insensitive' },
      },
      select: { id: true },
    });
    logger.warn(
      `HR sync ownership claim for user ${existing.id} collides within tenant ${organizationId} (winner: ${winner?.id ?? 'unknown'}) — needs explicit resolution`,
    );
    throw new Error(
      `HR sync ownership claim for user ${existing.id} conflicts with user ${winner?.id ?? 'unknown'} in tenant ${organizationId}; merge or delete the duplicate and retry the sync`,
    );
  }
}

export async function linkIdentity({
  existing,
  identity,
  organizationId,
  allowRaceRecovery = true,
}: {
  existing: User;
  identity: HrIdentity;
  organizationId: string;
  /** Single retry only: a second consecutive link loss is a retryable error. */
  allowRaceRecovery?: boolean;
}): Promise<User> {
  if (existing.tenantId && existing.tenantId !== organizationId) {
    const shared = await findLegacySharedUser({
      purpose: 'hr-sync',
      tenantId: organizationId,
      normalizedEmail: normalizeEmail(identity.email),
      sub: identity.id,
    });
    if (shared?.id === existing.id) return shared;
  }
  if (existing.gideonSub && existing.gideonSub !== identity.id)
    throw new Error(
      'HR sync IdP identity conflicts with the existing user link',
    );
  if (existing.banned)
    throw new Error('HR sync cannot provision a disabled local user');
  if (!existing.tenantId) {
    // Expand-window row written by old code before the tenant backfill: the
    // sync tenant claims ownership below instead of this identity failing.
    logger.warn(
      `HR sync claims expand-window null-tenant row ${existing.id} for tenant ${organizationId}`,
    );
  } else if (existing.tenantId !== organizationId)
    throw new Error(
      'HR sync IdP identity belongs to a different tenant than the existing user',
    );
  if (existing.gideonSub) {
    const email = normalizeEmail(identity.email);
    if (normalizeEmail(existing.email) === email)
      return claimExpandOwnership({ existing, organizationId });
    // Adopt-if-free, shared with the login path: when another row in the
    // same tenant already holds the IdP email, keep the existing login email
    // and let the sync proceed instead of aborting the job with a raw P2002.
    const adoptEmail = await resolveAdoptEmail({
      tenantId: organizationId,
      normalizedEmail: email,
      currentEmail: existing.email,
      excludeId: existing.id,
      source: 'HR sync',
    });
    if (!adoptEmail) {
      return claimExpandOwnership({ existing, organizationId });
    }
    try {
      return await db.user.update({
        where: { id: existing.id, gideonSub: identity.id },
        data: {
          email,
          ...(existing.tenantId ? {} : { tenantId: organizationId }),
        },
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P2025')
        return recoverLinkRace({
          existing,
          identity,
          organizationId,
          allowRaceRecovery,
        });
      if (code !== 'P2002') throw error;
      logger.warn(
        `HR sync email adoption for user ${existing.id} raced a concurrent write — keeping the existing login email`,
      );
      return claimExpandOwnership({ existing, organizationId });
    }
  }
  try {
    // NOTE: `await` is load-bearing here — a bare `return` would let the
    // rejection bypass the P2025 catch below.
    return await db.user.update({
      where: { id: existing.id, AND: { gideonSub: null } },
      data: {
        gideonSub: identity.id,
        gideonTenantId: organizationId,
        ...(existing.tenantId ? {} : { tenantId: organizationId }),
      },
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'P2025')
      return recoverLinkRace({
        existing,
        identity,
        organizationId,
        allowRaceRecovery,
      });
    if (code === 'P2002') {
      // Two unique keys can collide here: the composite (tenantId, email) on
      // a null-tenant ownership claim or a concurrent link, and the global
      // subject link when a concurrent writer (login or sync) claimed this
      // identity after our earlier read missed. Converge on the winner in
      // both cases instead of leaking raw Prisma to the job. The email
      // re-read alone never converges on a subject collision (it returns the
      // same still-unlinked row, looping forever since subjects are
      // immutable), so fall through to the subject holder below. The retry
      // budget must not reset — pass allowRaceRecovery through so a second
      // consecutive loss stays a retryable error instead of looping.
      const raced = await db.user.findFirst({
        where: {
          tenantId: organizationId,
          email: {
            equals: normalizeEmail(identity.email),
            mode: 'insensitive',
          },
        },
      });
      if (raced && raced.id !== existing.id)
        return linkIdentity({
          existing: raced,
          identity,
          organizationId,
          allowRaceRecovery,
        });
      const subHolder = await db.user.findUnique({
        where: { gideonSub: identity.id },
      });
      if (subHolder)
        return linkIdentity({
          existing: subHolder,
          identity,
          organizationId,
          allowRaceRecovery,
        });
      throw new Error(
        `HR sync hit a user link conflict for identity ${identity.id}; retry the sync`,
      );
    }
    throw error;
  }
}

/**
 * Recover a P2025 conditional-link loss: another writer (sync or login)
 * linked the row first, so the guarded update matched zero rows. Re-read and
 * converge on the winner's state — a link to the same identity succeeds
 * without further writes, genuine conflicts surface as descriptive errors.
 * Never leaks the raw Prisma error to the sync job. Single retry only: a
 * second consecutive loss surfaces as a retryable error instead of looping.
 */
async function recoverLinkRace(params: {
  existing: User;
  identity: HrIdentity;
  organizationId: string;
  allowRaceRecovery: boolean;
}): Promise<User> {
  const { existing, identity, organizationId, allowRaceRecovery } = params;
  if (!allowRaceRecovery) {
    throw new Error(
      `HR sync hit a user link conflict for identity ${identity.id}; retry the sync`,
    );
  }
  const current = await db.user.findUnique({ where: { id: existing.id } });
  if (!current) {
    // The conflicting row vanished concurrently: report a retryable failure
    // instead of leaking the raw Prisma error to the sync job.
    throw new Error(
      `HR sync hit a user link conflict for identity ${identity.id}; retry the sync`,
    );
  }
  return linkIdentity({
    existing: current,
    identity,
    organizationId,
    allowRaceRecovery: false,
  });
}
