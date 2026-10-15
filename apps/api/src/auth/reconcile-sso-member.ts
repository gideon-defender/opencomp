import { serviceDb, normalizeEmail } from '@db';
import { findLegacySharedUser } from './legacy-shared-user';
import { lookupGideonTenantIdentity } from './gideon-tenant-identity';
import type { EntitlementReconciliationConfig } from './entitlement-reconciliation-config';
import { fetchEntitlementSnapshot } from './entitlement-snapshot';
import { parseEntitlementsClaim } from './oidc-entitlements';
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
          user: { select: { gideonSub: true, tenantId: true, email: true } },
        },
      });
      if (!member) return 'skipped';
      let subject = member.user.gideonSub;
      let identityMissing = false;
      if (!subject) {
        throw new Error(
          'SSO membership has no valid tenant-linked IdP subject',
        );
      }
      if (!member.user.tenantId) {
        // Expand-window row written by old code before the tenant backfill:
        // the reconciled tenant claims ownership instead of this member
        // failing. Post-contract rows are never null. A P2002 means another
        // row already holds this tenant+email, so surface a descriptive
        // conflict for the operator instead of leaking raw Prisma.
        try {
          await tx.user.update({
            where: { id: member.userId },
            data: { tenantId },
          });
        } catch (error) {
          if ((error as { code?: string }).code !== 'P2002') throw error;
          throw new Error(
            `SSO reconciliation ownership claim for member ${memberId} conflicts within tenant ${tenantId}; merge or delete the duplicate and retry`,
          );
        }
      } else if (member.user.tenantId !== tenantId) {
        const shared = await findLegacySharedUser({
          tenantId,
          normalizedEmail: normalizeEmail(member.user.email),
          sub: subject,
          client: tx,
        });
        if (shared?.id !== member.userId) {
          throw new Error(
            'SSO membership has no valid tenant-linked IdP subject',
          );
        }
        const identity = await lookupGideonTenantIdentity({
          tenantId,
          email: member.user.email,
        });
        identityMissing = identity === null;
        if (identity) subject = identity.id;
      }
      // A complete tenant lookup with no identity revokes the old membership.
      // Transport or validation errors throw and retain the last-known state.
      const snapshot = identityMissing
        ? {
            entitlements: [],
            observed_at: new Date().toISOString(),
            user_status: 'deleted',
          }
        : await fetchEntitlementSnapshot({ config, tenantId, subject });
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
