import { lockRoleAssignments } from '../roles/role-assignment-lock';
import { findLegacySharedUser } from './legacy-shared-user';
import type { Prisma } from '@db';
import { BUILT_IN_ROLE_PERMISSIONS } from '@gideon-defender/auth';
import type { EntitlementReconciliationConfig } from './entitlement-reconciliation-config';
import { fetchEntitlementSnapshot } from './entitlement-snapshot';
import {
  EntitlementsDeniedError,
  parseEntitlementsClaim,
} from './oidc-entitlements';

export async function readSsoEntitlementRoles({
  tx,
  tenantId,
  entitlements,
}: {
  tx: Prisma.TransactionClient;
  tenantId: string;
  entitlements: string[];
}) {
  await lockRoleAssignments({ tx, organizationId: tenantId });
  const customRoles = await tx.organizationRole.findMany({
    where: { organizationId: tenantId },
    select: { name: true },
  });
  const valid = new Set([
    ...Object.keys(BUILT_IN_ROLE_PERMISSIONS),
    ...customRoles.map((role) => role.name),
  ]);
  const roles = [
    ...new Set(
      parseEntitlementsClaim({ entitlements }).filter((value) =>
        valid.has(value),
      ),
    ),
  ].sort();
  return { roles, valid };
}

/** Call only after the membership lock: token claims can predate a poll's revocation. */
export async function refreshSsoLoginRoles({
  tx,
  userId,
  organizationId,
  config,
  subject,
}: {
  tx: Prisma.TransactionClient;
  userId: string;
  organizationId: string;
  config: EntitlementReconciliationConfig;
  subject?: string;
}): Promise<string[]> {
  if (!config.allTenants && !config.tenantIds.includes(organizationId))
    throw new Error('Tenant is not enabled for reconciliation');
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { oidcSub: true, tenantId: true, email: true },
  });
  if (!user || (!user.oidcSub && !subject))
    throw new Error('SSO membership has no valid tenant-linked IdP subject');
  let loginSubject = user.oidcSub;
  if (!user.tenantId) {
    // Expand-window row written by old code before the tenant backfill: the
    // login tenant claims ownership instead of this login failing. A P2002
    // means another row already holds this tenant+email, so surface a
    // descriptive conflict instead of leaking raw Prisma.
    try {
      await tx.user.update({
        where: { id: userId },
        data: { tenantId: organizationId },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      throw new Error(
        `SSO login ownership claim for user ${userId} conflicts within tenant ${organizationId}; merge or delete the duplicate and retry`,
      );
    }
  } else if (user.tenantId !== organizationId) {
    const shared = subject
      ? await findLegacySharedUser({
          tenantId: organizationId,
          normalizedEmail: user.email.trim().toLowerCase(),
          sub: subject,
          client: tx,
        })
      : undefined;
    if (shared?.id !== userId) {
      throw new Error('SSO membership has no valid tenant-linked IdP subject');
    }
    loginSubject = subject ?? null;
  }
  if (!loginSubject)
    throw new Error('SSO membership has no valid tenant-linked IdP subject');
  const snapshot = await fetchEntitlementSnapshot({
    config,
    tenantId: organizationId,
    subject: loginSubject,
  });
  const { roles } = await readSsoEntitlementRoles({
    tx,
    tenantId: organizationId,
    entitlements: snapshot.entitlements,
  });
  if (roles.length === 0)
    throw new EntitlementsDeniedError({
      reason: snapshot.entitlements.length
        ? 'no_valid_match'
        : 'empty_entitlements',
      email: user.email,
      tenantId: organizationId,
    });
  return roles;
}
