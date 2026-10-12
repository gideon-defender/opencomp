import type { Logger } from '@nestjs/common';
import { db } from '@db';
import type { HrIdentityResolver } from './hr-sync-idp';
import { recordHrSyncError, shouldSkipHrSync } from './hr-sync-identity';
import type { SyncResult } from './generic-employee-sync.types';

export async function deactivateAbsentEmployees({
  organizationId,
  providerName,
  providerDomains,
  protectedRoles,
  inactiveEmails,
  presenceActiveEmails,
  resolveIdentity,
  logger,
  results,
}: {
  organizationId: string;
  providerName: string;
  providerDomains: Set<string>;
  protectedRoles: string[];
  inactiveEmails: Set<string>;
  presenceActiveEmails: Set<string>;
  resolveIdentity: HrIdentityResolver;
  logger: Logger;
  results: SyncResult;
}): Promise<void> {
  const allOrgMembers = await db.member.findMany({
    where: {
      organizationId,
      deactivated: false,
    },
    include: {
      user: true,
    },
  });

  for (const member of allOrgMembers) {
    const memberEmail = member.user.email.toLowerCase();
    const memberDomain = memberEmail.split('@')[1];

    // Only check members whose email domain matches the provider's domains
    if (!memberDomain || !providerDomains.has(memberDomain)) {
      continue;
    }

    // Safety guard: never auto-deactivate privileged members
    const memberRoles = member.role
      .split(',')
      .map((role) => role.trim().toLowerCase());
    if (protectedRoles.some((pr) => memberRoles.includes(pr))) {
      continue;
    }

    // If member is not in active set AND not already accounted for, deactivate
    const isSuspended = inactiveEmails.has(memberEmail);
    const isRemoved = !presenceActiveEmails.has(memberEmail) && !isSuspended;

    if (isSuspended || isRemoved) {
      try {
        if (
          shouldSkipHrSync({
            identity: await resolveIdentity({ email: memberEmail }),
            email: memberEmail,
            organizationId,
            providerName,
            logger: logger,
            results,
          })
        )
          continue;
        await db.member.update({
          where: { id: member.id },
          data: {
            deactivated: true,
            isActive: false,
            offboardDate: member.offboardDate ?? new Date(),
          },
        });
        results.deactivated++;
        results.details.push({
          email: memberEmail,
          status: 'deactivated',
          reason: isSuspended
            ? `User is suspended in ${providerName}`
            : `User was removed from ${providerName}`,
        });
      } catch (error) {
        recordHrSyncError({
          error,
          email: memberEmail,
          organizationId,
          providerName,
          logger: logger,
          results,
        });
      }
    }
  }
}
