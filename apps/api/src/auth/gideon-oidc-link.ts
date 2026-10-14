import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { db, normalizeEmail } from '@db';
import type { User } from '@db';

const logger = new Logger('GideonOidcProvisioning');

export interface LinkGideonSubParams {
  sub: string;
  existing: {
    id: string;
    banned: boolean | null;
    gideonSub: string | null;
    // Nullable during the expand-window rollout: rows written by old code
    // before the tenant backfill carry no ownership yet and are claimed by
    // the first login/sync that presents them (see linkGideonSub).
    tenantId: string | null;
  };
  tenantId: string;
  beforeWrite?: () => Promise<void>;
}

/**
 * Adopt-if-free: decide whether the linked row takes the login email.
 *
 * The IdP is the source of truth for the subject's verified email: adopt
 * a changed address so the login email cannot go stale. Adoption is
 * tenant-scoped — when another row in the same tenant already holds the new
 * address, keep the existing email and let the login proceed; the collision
 * is logged for administrators to resolve instead of bricking the login or
 * overwriting the other account.
 */
export async function resolveAdoptEmail(params: {
  tenantId: string;
  normalizedEmail: string;
  currentEmail: string;
  excludeId: string;
  /** Log prefix for the collision warn (login vs sync caller). */
  source?: string;
}): Promise<string | undefined> {
  const { tenantId, normalizedEmail, currentEmail, excludeId } = params;
  if (normalizeEmail(currentEmail) === normalizedEmail) return undefined;
  const taken = await db.user.findFirst({
    where: {
      tenantId,
      email: { equals: normalizedEmail, mode: 'insensitive' },
      id: { not: excludeId },
    },
    select: { id: true },
  });
  if (taken) {
    logger.warn(
      `${params.source ?? 'Gideon'} email change for user ${excludeId} collides within the tenant — keeping the existing login email`,
    );
    return undefined;
  }
  return normalizedEmail;
}

/**
 * Expand-window fallback lookup: the oldest User row holding the normalized
 * email that still lacks tenant ownership (written by old code before the
 * tenant backfill). Nulls-first ordering puts a tenant-less row at the head
 * of the single-row page when one exists, so an owned row can never shadow
 * it the way a truncated email-only page did. Post-contract every row is
 * owned, so the head row fails the null check and this simply misses while
 * creation proceeds.
 */
export async function findClaimableExpandRow(
  normalizedEmail: string,
): Promise<User | undefined> {
  // Raw SQL on purpose: the generated client types tenantId (required in the
  // final schema) as plain SortOrder, which cannot express NULLS FIRST — but
  // the column stays nullable in the database through the expand window, and
  // nulls-first is load-bearing (see above). Parameterized, so there is no
  // injection surface; lower() keeps the match case-insensitive without LIKE
  // wildcards (emails can contain % and _ literally).
  const rows = await db.$queryRaw<User[]>`
    SELECT * FROM "User"
    WHERE lower(email) = ${normalizedEmail}
    ORDER BY "tenantId" ASC NULLS FIRST, "createdAt" ASC
    LIMIT 1
  `;
  const row = rows[0];
  return row && !row.tenantId ? row : undefined;
}

/**
 * Persist login state, optionally adopting the login email. A row can claim
 * the target address between the adopt check and this write — on P2002
 * degrade to keeping the existing email (logged) instead of 500ing login.
 * The same applies to an expand-window ownership claim that collides with
 * the tenant's existing composite key: drop the claim as well and let the
 * login proceed so the collision surfaces in the migration abort checks
 * instead of bricking sign-in.
 */
export async function updateLoginState(params: {
  userId: string;
  adoptEmail?: string;
  tenantId?: string;
  /**
   * Expand-window ownership claim: set immutable tenantId once for rows
   * written by old code before the backfill. Only pass when the row was
   * read with a null tenantId — the immutability trigger rejects any later
   * change, and post-contract rows are never null.
   */
  claimTenantId?: string;
}) {
  const { userId, adoptEmail, tenantId, claimTenantId } = params;
  try {
    return await db.user.update({
      where: { id: userId },
      data: {
        lastLogin: new Date(),
        ...(adoptEmail ? { email: adoptEmail } : {}),
        ...(tenantId ? { gideonTenantId: tenantId } : {}),
        ...(claimTenantId ? { tenantId: claimTenantId } : {}),
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    if (!adoptEmail && !claimTenantId) throw error;
    if (adoptEmail) {
      logger.warn(
        `Gideon email adoption for user ${userId} raced a concurrent write — keeping the existing login email`,
      );
    }
    try {
      return await db.user.update({
        where: { id: userId },
        data: {
          lastLogin: new Date(),
          ...(tenantId ? { gideonTenantId: tenantId } : {}),
          ...(claimTenantId ? { tenantId: claimTenantId } : {}),
        },
      });
    } catch (retryError) {
      if ((retryError as { code?: string }).code !== 'P2002' || !claimTenantId)
        throw retryError;
      logger.warn(
        `Gideon ownership claim for user ${userId} collides within the tenant — leaving ownership unresolved`,
      );
      return db.user.update({
        where: { id: userId },
        data: {
          lastLogin: new Date(),
          ...(tenantId ? { gideonTenantId: tenantId } : {}),
        },
      });
    }
  }
}

export async function linkGideonSub({
  sub,
  existing,
  tenantId,
  beforeWrite,
}: LinkGideonSubParams) {
  if (existing.banned) {
    throw new ForbiddenException('Account is disabled');
  }
  if (!existing.tenantId) {
    // Expand-window row written by old code before the tenant backfill: the
    // login tenant claims ownership below instead of this login failing.
    logger.warn(
      `Claiming expand-window null-tenant row ${existing.id} for the login tenant`,
    );
  } else if (existing.tenantId !== tenantId) {
    logger.warn(
      `Tenant-scoped link rejected for user ${existing.id} — row is owned by another tenant`,
    );
    throw new ForbiddenException(
      'Gideon account belongs to a different organization',
    );
  }
  if (existing.gideonSub && existing.gideonSub !== sub) {
    logger.warn(
      `Gideon sub mismatch for user ${existing.id} — not overwriting existing link`,
    );
    throw new ForbiddenException(
      'Gideon account is linked to a different user',
    );
  }
  await beforeWrite?.();
  // Guard the subject link against a concurrent writer: when this login is
  // about to claim an unlinked row, the update only matches while the row is
  // still unlinked. A lost race surfaces as P2025 (no rows matched) instead
  // of silently overwriting the winner's subject and locking them out.
  // Mirrors the HR-sync link path (hr-sync-idp-link.ts).
  const linkingSub = !existing.gideonSub;
  try {
    return await db.user.update({
      where: linkingSub
        ? { id: existing.id, AND: { gideonSub: null } }
        : { id: existing.id },
      data: {
        lastLogin: new Date(),
        ...(existing.gideonSub ? {} : { gideonSub: sub }),
        gideonTenantId: tenantId,
        ...(existing.tenantId ? {} : { tenantId }),
      },
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'P2025' && linkingSub) {
      logger.warn(
        `Gideon link for user ${existing.id} lost a concurrent link race — retryable conflict`,
      );
      throw new ConflictException(
        'Sign-in hit a concurrent account change; please try again',
      );
    }
    if (code !== 'P2002') throw error;
    // Two unique keys can collide here: the global subject link and — for
    // null-tenant expand-window claims — the composite (tenantId, email).
    // A subject collision is a genuine link conflict; an ownership-claim
    // collision is a within-tenant email duplicate that needs admin
    // resolution, not a "different user" verdict. Tell them apart before
    // responding so the error points at the real remediation.
    const subHolder = await db.user.findUnique({
      where: { gideonSub: sub },
      select: { id: true },
    });
    if (subHolder && subHolder.id !== existing.id) {
      logger.warn(
        `Gideon sub already linked elsewhere for user ${existing.id} — rejecting`,
      );
      throw new ForbiddenException(
        'Gideon account is linked to a different user',
      );
    }
    logger.warn(
      `Gideon ownership claim for user ${existing.id} collides within the tenant — retryable conflict`,
    );
    throw new ConflictException(
      'Sign-in hit a concurrent account change; please try again',
    );
  }
}

/**
 * Recover a P2002 on create: a concurrent first login racing this one.
 * Re-read tenant-scoped state and fall through to the link path. During the
 * expand window the conflicting row may predate the tenant backfill (the
 * tenant-scoped re-read never matches null ownership), so fall back to a
 * global email match with no tenant before concluding the row vanished.
 * When every re-read misses (the conflicting row vanished concurrently),
 * report a retryable conflict — never leak the raw Prisma error to the
 * login caller.
 */
export async function recoverRacedProvision(params: {
  sub: string;
  normalizedEmail: string;
  tenantId: string;
  beforeWrite?: () => Promise<void>;
}) {
  const { sub, normalizedEmail, tenantId, beforeWrite } = params;
  const raced = await db.user.findFirst({
    where: {
      tenantId,
      email: { equals: normalizedEmail, mode: 'insensitive' },
    },
  });
  if (raced) {
    return linkGideonSub({
      sub,
      existing: raced,
      tenantId,
      beforeWrite,
    });
  }
  // Expand-window fallback (see provisionGideonUser step 2b): the P2002 may
  // come from the legacy global email key on a row that predates the tenant
  // backfill. Claim it for the login tenant instead of looping in conflict.
  const expandRaced = await findClaimableExpandRow(normalizedEmail);
  if (expandRaced) {
    return linkGideonSub({
      sub,
      existing: expandRaced,
      tenantId,
      beforeWrite,
    });
  }
  const bySubRaced = await db.user.findUnique({ where: { gideonSub: sub } });
  if (!bySubRaced) {
    throw new ConflictException(
      'Sign-in hit a concurrent account change; please try again',
    );
  }
  if (bySubRaced.banned) {
    throw new ForbiddenException('Account is disabled');
  }
  if (!bySubRaced.tenantId) {
    logger.warn(
      `Claiming expand-window null-tenant row ${bySubRaced.id} on race recovery`,
    );
  } else if (bySubRaced.tenantId !== tenantId) {
    logger.warn(
      `Gideon subject tenant mismatch for user ${bySubRaced.id} on race recovery — rejecting`,
    );
    throw new ForbiddenException(
      'Gideon account belongs to a different organization',
    );
  }
  const adoptEmail = await resolveAdoptEmail({
    tenantId,
    normalizedEmail,
    currentEmail: bySubRaced.email,
    excludeId: bySubRaced.id,
  });
  await beforeWrite?.();
  return updateLoginState({
    userId: bySubRaced.id,
    adoptEmail,
    tenantId,
    claimTenantId: bySubRaced.tenantId ? undefined : tenantId,
  });
}
