import {
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { db, normalizeEmail } from '@db';
import {
  findClaimableExpandRow,
  linkGideonSub,
  recoverRacedProvision,
  resolveAdoptEmail,
  updateLoginState,
} from './gideon-oidc-link';
import { findLegacySharedUser } from './legacy-shared-user';
import { SESSION_TTL_SECONDS } from './session-cookie';

const logger = new Logger('GideonOidcProvisioning');

export interface ProvisionGideonUserParams {
  sub: string;
  email: string;
  name?: string;
  image?: string;
  /**
   * Gideon tenant id from the login (decoded from the access token). The
   * tenant IS the organization (Organization.id), and it is the immutable
   * User.tenantId ownership boundary: one user belongs to exactly one
   * tenant, and the same email in another tenant is a separate User row
   * with a distinct Gideon subject.
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
 * JIT find-or-create keyed by canonical Gideon subject first, then by
 * tenant-scoped email.
 *
 * Identity model: emails are unique within a tenant, not globally. The same
 * normalized email in two tenants with distinct subjects is two independent
 * users with separate roles, sessions, and HR state.
 *
 * Resolution order:
 *   1. Canonical subject (`gideonSub`): the authoritative link. A hit
 *      returns the linked row after a tenant-consistency check — a subject
 *      issued by tenant A never authenticates as a user owned by tenant B.
 *      Before contract, existing secondary memberships can read their shared
 *      row while the legacy global key exists; this path never changes it.
 *   2. Tenant-scoped legacy email link (`tenantId`, normalized email): only
 *      rows owned by the authenticated tenant are eligible. A null
 *      `gideonSub` is linked; a conflicting non-null subject is rejected,
 *      never overwritten (no hijack across Gideon accounts).
 *   2b. Expand-window fallback: rows written by old code before the tenant
 *      backfill carry no ownership, so they never match the tenant-scoped
 *      lookup. The legacy global email key still guards the window, so a
 *      global email match with no tenant is this login's row — claim it for
 *      the login tenant instead of failing. Post-contract rows are never
 *      null, so the fallback simply misses and creation proceeds.
 *   3. Create: a new User row owned by the login tenant with a normalized
 *      email. Creation without a tenant is refused — ownership is required.
 *
 * `User.tenantId` is immutable and never updated here; only the legacy
 * `gideonTenantId` stamp is refreshed. A concurrent first login racing this
 * one surfaces as P2002 — re-read tenant-scoped state and fall through to
 * the link path instead of failing the login.
 */
export async function provisionGideonUser({
  sub,
  email,
  name,
  image,
  tenantId,
  beforeWrite,
}: ProvisionGideonUserParams) {
  const normalizedEmail = normalizeEmail(email);

  // Authorization runs exactly once per login, before the first write.
  // The P2002 race-recovery path reuses the same decision instead of
  // invoking the hook a second time (duplicate entitlement evaluation and
  // duplicate audit log lines for one login).
  let beforeWriteDone = false;
  const runBeforeWriteOnce = async (): Promise<void> => {
    if (beforeWriteDone) return;
    beforeWriteDone = true;
    await beforeWrite?.();
  };

  const bySub = await db.user.findUnique({ where: { gideonSub: sub } });
  if (bySub) {
    if (bySub.banned) {
      throw new ForbiddenException('Account is disabled');
    }
    if (tenantId && bySub.tenantId && bySub.tenantId !== tenantId) {
      const shared = await findLegacySharedUser({
        tenantId,
        normalizedEmail,
        sub,
      });
      if (shared?.id === bySub.id) {
        await runBeforeWriteOnce();
        return shared;
      }
      logger.warn(
        `Gideon subject tenant mismatch for user ${bySub.id} — subject is owned by another tenant, rejecting`,
      );
      throw new ForbiddenException(
        'Gideon account belongs to a different organization',
      );
    }
    // Expand-window rows written by old code carry no tenantId yet: the
    // login tenant claims ownership here instead of this login failing.
    // Tenant-less logins never claim — creation without a tenant stays
    // refused below, but existing subject-linked sessions keep working on
    // the legacy most-recent-org fallback.
    const claimTenantId = !bySub.tenantId && tenantId ? tenantId : undefined;
    if (claimTenantId) {
      logger.warn(`Claiming expand-window null-tenant row ${bySub.id}`);
    }
    // Without any tenant scope there is nothing safe to adopt against, so
    // keep the existing email rather than checking adoption tenant-blind.
    const scopeTenantId = bySub.tenantId ?? tenantId;
    const adoptEmail = scopeTenantId
      ? await resolveAdoptEmail({
          tenantId: scopeTenantId,
          normalizedEmail,
          currentEmail: bySub.email,
          excludeId: bySub.id,
        })
      : undefined;
    await runBeforeWriteOnce();
    return updateLoginState({
      userId: bySub.id,
      adoptEmail,
      tenantId,
      claimTenantId,
    });
  }

  if (!tenantId) {
    logger.warn(
      'Gideon login without tenant — refusing to create a tenant-less user',
    );
    throw new UnauthorizedException(
      'Gideon login did not include a tenant; cannot provision user',
    );
  }

  const existing = await db.user.findFirst({
    where: {
      tenantId,
      email: { equals: normalizedEmail, mode: 'insensitive' },
    },
  });
  if (existing) {
    return linkGideonSub({
      sub,
      existing,
      tenantId,
      beforeWrite: runBeforeWriteOnce,
    });
  }
  // Expand-window fallback: a legacy row predating the tenant backfill never
  // matches the tenant-scoped lookup above (`tenantId` filter excludes null).
  // Only rows with no ownership are eligible — a row owned by another tenant
  // is skipped so creation (post-contract) or the global-key conflict path
  // (in-window) handles it.
  const expandRow = await findClaimableExpandRow(normalizedEmail);
  if (expandRow) {
    return linkGideonSub({
      sub,
      existing: expandRow,
      tenantId,
      beforeWrite: runBeforeWriteOnce,
    });
  }
  await runBeforeWriteOnce();
  try {
    return await db.user.create({
      data: {
        email: normalizedEmail,
        emailVerified: true,
        name: name ?? normalizedEmail.split('@')[0] ?? normalizedEmail,
        ...(image ? { image } : {}),
        gideonSub: sub,
        tenantId,
        gideonTenantId: tenantId,
        lastLogin: new Date(),
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const shared = await findLegacySharedUser({
      tenantId,
      normalizedEmail,
      sub,
    });
    if (shared) {
      if (shared.gideonSub !== sub) {
        throw new ForbiddenException(
          'Gideon account is linked to a different user',
        );
      }
      return shared;
    }
    return recoverRacedProvision({
      sub,
      normalizedEmail,
      tenantId,
      beforeWrite: runBeforeWriteOnce,
    });
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
