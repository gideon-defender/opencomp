import { serviceDb } from '@db';
import type { EntitlementReconciliationConfig } from './entitlement-reconciliation-config';
import { fetchEntitlementSnapshot } from './entitlement-snapshot';
import { parseEntitlementsClaim } from './gideon-oidc-entitlements';
import { readSsoEntitlementRoles } from './sso-entitlement-roles';

/** Serialize with membership writes; commit role changes and audit together. */
export async function reconcileSsoMember({
  memberId,
  tenantId,
  config,
}: {
  memberId: string;
  tenantId: string;
  config: EntitlementReconciliationConfig;
}): Promise<'changed' | 'unchanged' | 'skipped'> {
  if (!config.tenantIds.includes(tenantId))
    throw new Error('Tenant is not enabled for reconciliation');
  return serviceDb.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Member" WHERE id = ${memberId} AND "organizationId" = ${tenantId} FOR UPDATE`;
      const member = await tx.member.findFirst({
        where: { id: memberId, organizationId: tenantId, roleSource: 'sso' },
        include: {
          user: { select: { gideonSub: true, gideonTenantId: true } },
        },
      });
      if (!member) return 'skipped';
      const subject = member.user.gideonSub;
      if (
        !subject ||
        (member.user.gideonTenantId && member.user.gideonTenantId !== tenantId)
      ) {
        throw new Error(
          'SSO membership has no valid tenant-linked IdP subject',
        );
      }
      // Fetch after acquiring the lock, not from a stale pre-lock inventory.
      const snapshot = await fetchEntitlementSnapshot({
        config,
        tenantId,
        subject,
      });
      const { roles, valid } = await readSsoEntitlementRoles({
        tx,
        tenantId,
        entitlements: snapshot.entitlements,
      });
      const role = roles.join(',');
      const idpAccessRevoked = roles.length === 0;
      const membershipChanged =
        role !== member.role || idpAccessRevoked !== member.idpAccessRevoked;

      // Deliberately leave deactivated, isActive, department and HR dates alone.
      if (membershipChanged)
        await tx.member.update({
          where: { id: member.id },
          data: { role, idpAccessRevoked },
        });
      const deletedSessions = idpAccessRevoked
        ? await tx.session.deleteMany({
            // Also invalidates retained Better Auth sessions in this organization.
            // Other organizations' sessions and all HR fields remain untouched.
            where: { userId: member.userId, activeOrganizationId: tenantId },
          })
        : { count: 0 };
      if (!membershipChanged && deletedSessions.count === 0) return 'unchanged';
      await tx.auditLog.create({
        data: {
          organizationId: tenantId,
          userId: member.userId,
          memberId: member.id,
          entityId: member.id,
          entityType: 'people',
          description: 'SSO membership reconciled with Gideon entitlements',
          data: {
            event: 'oidc.entitlements.reconciled',
            actor: 'service:entitlement-reconciliation',
            subject,
            clientId: config.clientId,
            observedAt: snapshot.observed_at,
            previous: {
              role: member.role,
              idpAccessRevoked: member.idpAccessRevoked,
            },
            current: { role, idpAccessRevoked },
            presented: snapshot.entitlements,
            unmatched: snapshot.entitlements.filter(
              (value) =>
                !parseEntitlementsClaim({ entitlements: [value] }).some(
                  (name) => valid.has(name),
                ),
            ),
            userStatus: snapshot.user_status,
            deletedSessions: deletedSessions.count,
          },
        },
      });
      return 'changed';
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}
