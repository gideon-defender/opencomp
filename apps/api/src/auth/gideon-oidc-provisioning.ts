import { ForbiddenException, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { db } from '@db';
import { SESSION_TTL_SECONDS } from './session-cookie';

const logger = new Logger('GideonOidcProvisioning');

export interface ProvisionGideonUserParams {
  sub: string;
  email: string;
  name?: string;
  image?: string;
  /**
   * Gideon tenant id from the login (decoded from the access token). The
   * tenant IS the organization (Organization.id), so this also selects the
   * session's active org — stamped onto the user row for onboarding, which
   * reads it to create organizations under the login's tenant.
   */
  tenantId?: string;
  /** Run authorization after identity checks, before any user write. */
  beforeWrite?: () => Promise<void>;
}

/**
 * Active organization for a session. Tenant is the org: when the login
 * carries a Gideon tenant id, the session points at the org with that id
 * (verified live membership — never a different org than the tenant that
 * issued the login). Unknown tenants and non-members resolve to null and
 * flow into setup; there is no most-recent fallback for Gideon logins.
 * Callers without a tenant (better-auth, device agent) keep the
 * most-recent-membership rule.
 */
export async function resolveActiveOrganizationId({
  userId,
  tenantId,
}: {
  userId: string;
  tenantId?: string;
}): Promise<string | null> {
  if (tenantId) {
    const org = await db.organization.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (org) {
      const membership = await db.member.findFirst({
        where: {
          userId,
          organizationId: org.id,
          deactivated: false,
          idpAccessRevoked: false,
        },
        select: { id: true },
      });
      if (membership) return org.id;
    }
    return null;
  }
  const org = await db.organization.findFirst({
    where: { members: { some: { userId } } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return org?.id ?? null;
}

/**
 * JIT find-or-create keyed by verified email, linked via `gideonSub`.
 * The email is lowercased + trimmed first, and the lookup is
 * case-insensitive: OIDC providers preserve the registrant's case but
 * legacy better-auth rows keep the originally typed case, so an exact
 * match on the normalized value would miss the link and create a
 * duplicate account.
 * A non-null conflicting `gideonSub` is rejected rather than overwritten
 * so a Gideon account can never hijack an unrelated OpenComp user.
 * A concurrent first login racing this one surfaces as P2002 — re-read and
 * fall through to the link path instead of failing the login. When the
 * conflict is on the `gideonSub` index instead (same Gideon account with
 * a changed email), adopt the new email on the linked row.
 */
export async function provisionGideonUser({
  sub,
  email,
  name,
  image,
  tenantId,
  beforeWrite,
}: ProvisionGideonUserParams) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.user.findFirst({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
  });
  if (existing) {
    return linkGideonSub({
      sub,
      email: normalizedEmail,
      existing,
      tenantId,
      beforeWrite,
    });
  }
  await beforeWrite?.();
  try {
    return await db.user.create({
      data: {
        email: normalizedEmail,
        emailVerified: true,
        name: name ?? normalizedEmail.split('@')[0] ?? normalizedEmail,
        ...(image ? { image } : {}),
        gideonSub: sub,
        ...(tenantId ? { gideonTenantId: tenantId } : {}),
        lastLogin: new Date(),
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const raced = await db.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });
    if (raced) {
      return linkGideonSub({
        sub,
        email: normalizedEmail,
        existing: raced,
        tenantId,
        beforeWrite,
      });
    }
    const bySub = await db.user.findUnique({ where: { gideonSub: sub } });
    if (!bySub) throw error;
    if (bySub.banned) {
      throw new ForbiddenException('Account is disabled');
    }
    await beforeWrite?.();
    return db.user.update({
      where: { id: bySub.id },
      data: {
        email: normalizedEmail,
        lastLogin: new Date(),
        ...(tenantId ? { gideonTenantId: tenantId } : {}),
      },
    });
  }
}

async function linkGideonSub({
  sub,
  email,
  existing,
  tenantId,
  beforeWrite,
}: {
  sub: string;
  email: string;
  existing: { id: string; banned: boolean | null; gideonSub: string | null };
  tenantId?: string;
  beforeWrite?: () => Promise<void>;
}) {
  if (existing.banned) {
    throw new ForbiddenException('Account is disabled');
  }
  if (existing.gideonSub && existing.gideonSub !== sub) {
    logger.warn(
      `Gideon sub mismatch for ${email} — not overwriting existing link`,
    );
    throw new ForbiddenException(
      'Gideon account is linked to a different user',
    );
  }
  await beforeWrite?.();
  try {
    return await db.user.update({
      where: { id: existing.id },
      data: {
        lastLogin: new Date(),
        ...(existing.gideonSub ? {} : { gideonSub: sub }),
        ...(tenantId ? { gideonTenantId: tenantId } : {}),
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      logger.warn(
        `Gideon sub already linked elsewhere for ${email} — rejecting`,
      );
      throw new ForbiddenException(
        'Gideon account is linked to a different user',
      );
    }
    throw error;
  }
}

/**
 * Mint a standard Session row. The active org is the login's Gideon tenant
 * (tenant is the org); see `resolveActiveOrganizationId`.
 */
export async function mintGideonSession({
  userId,
  refreshToken,
  tenantId,
}: {
  userId: string;
  refreshToken?: string;
  tenantId?: string;
}) {
  return db.session.create({
    data: {
      token: randomBytes(32).toString('hex'),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
      activeOrganizationId: await resolveActiveOrganizationId({
        userId,
        tenantId,
      }),
      ...(refreshToken ? { gideonRefreshToken: refreshToken } : {}),
    },
  });
}
