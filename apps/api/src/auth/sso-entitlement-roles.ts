import type { Prisma } from '@db';
import { BUILT_IN_ROLE_PERMISSIONS } from '@gideon-defender/auth';
import type { EntitlementReconciliationConfig } from './entitlement-reconciliation-config';
import { fetchEntitlementSnapshot } from './entitlement-snapshot';
import {
  EntitlementsDeniedError,
  parseEntitlementsClaim,
} from './gideon-oidc-entitlements';

export async function readSsoEntitlementRoles({
  tx,
  tenantId,
  entitlements,
}: {
  tx: Prisma.TransactionClient;
  tenantId: string;
  entitlements: string[];
}) {
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
}: {
  tx: Prisma.TransactionClient;
  userId: string;
  organizationId: string;
  config: EntitlementReconciliationConfig;
}): Promise<string[]> {
  if (!config.tenantIds.includes(organizationId))
    throw new Error('Tenant is not enabled for reconciliation');
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { gideonSub: true, gideonTenantId: true, email: true },
  });
  if (
    !user?.gideonSub ||
    (user.gideonTenantId && user.gideonTenantId !== organizationId)
  )
    throw new Error('SSO membership has no valid tenant-linked IdP subject');
  const snapshot = await fetchEntitlementSnapshot({
    config,
    tenantId: organizationId,
    subject: user.gideonSub,
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
