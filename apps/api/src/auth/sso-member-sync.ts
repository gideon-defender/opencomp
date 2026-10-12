import { Logger } from '@nestjs/common';
import { db } from '@db';

const logger = new Logger('SsoMemberSync');

export interface SyncSsoMemberParams {
  userId: string;
  organizationId: string;
  /** Validated IdP role names (non-empty after trim). Overwrites, never unions. */
  roles: string[];
}

/** A confirmed IdP denial cuts off existing tokens without altering HR state. */
export async function revokeSsoMember({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}): Promise<void> {
  await db.member.updateMany({
    where: { userId, organizationId },
    data: { role: '', roleSource: 'sso', idpAccessRevoked: true },
  });
}

/**
 * Phase 1 JIT member provisioning: find-or-create the member row for a
 * login carrying valid IdP assignments, then atomically set
 * `roleSource='sso'`, overwrite the role set exactly, and clear only
 * `idpAccessRevoked`. HR/local fields (`deactivated`, `isActive`,
 * `department`, onboard/offboard dates) are never touched — a restored IdP
 * assignment must not resurrect an HR-offboarded member, and revocation
 * must not clear HR state.
 *
 * Runs inside a transaction and commits before the caller mints a session;
 * any throw means no session. A concurrent first login racing the create
 * surfaces as P2002 — re-read and fall through to the update path (same
 * pattern as `provisionGideonUser`). The @@unique([organizationId, userId])
 * constraint makes this retry airtight: without it a raced create would
 * insert a duplicate member row instead of conflicting.
 */
export async function syncSsoMember({
  userId,
  organizationId,
  roles,
}: SyncSsoMemberParams) {
  const role = [...new Set(roles.map((r) => r.trim()).filter(Boolean))].join(
    ',',
  );
  if (!role) {
    throw new Error(
      `syncSsoMember refused empty role set for user ${userId} in org ${organizationId}`,
    );
  }

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.member.findFirst({
        where: { userId, organizationId },
        select: { id: true },
      });
      if (existing) {
        return tx.member.update({
          where: { id: existing.id },
          data: { role, roleSource: 'sso', idpAccessRevoked: false },
        });
      }
      return tx.member.create({
        data: {
          userId,
          organizationId,
          role,
          roleSource: 'sso',
          idpAccessRevoked: false,
        },
      });
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const raced = await db.member.findFirst({
      where: { userId, organizationId },
      select: { id: true },
    });
    if (!raced) throw error;
    logger.warn(
      `SSO member sync raced first-login create for user ${userId} in org ${organizationId} — updating instead`,
    );
    return db.member.update({
      where: { id: raced.id },
      data: { role, roleSource: 'sso', idpAccessRevoked: false },
    });
  }
}

/**
 * Cutover session invalidation: after converting a tenant's memberships,
 * existing sessions must not retain pre-conversion privileges (sessions
 * re-resolve Member per request, so deleting the rows is an immediate,
 * complete cutoff). Returns the deleted count for the cutover audit.
 */
export async function invalidateTenantSessions({
  tenantId,
}: {
  tenantId: string;
}): Promise<{ deleted: number }> {
  const result = await db.session.deleteMany({
    where: {
      user: { members: { some: { organizationId: tenantId } } },
    },
  });
  logger.warn(
    `SSO cutover invalidated ${result.count} session(s) for tenant ${tenantId}`,
  );
  return { deleted: result.count };
}
