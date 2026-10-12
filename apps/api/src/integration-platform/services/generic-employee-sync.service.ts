import { Injectable, Logger } from '@nestjs/common';
import { db } from '@db';
import type { SyncEmployee } from '@gideon-defender/integration-platform';
import { matchesSyncFilterTerms } from '@gideon-defender/integration-platform';
import { getValidRoleNames } from '../../auth/app-access';
import { createHrIdentityResolver, getHrSyncUser } from './hr-sync-idp';
import { shouldSkipHrSync } from './hr-sync-identity';
import type {
  SyncResult,
  ProcessEmployeesOptions,
} from './generic-employee-sync.types';
import { deactivateAbsentEmployees } from './generic-employee-sync.deactivation';

const DEFAULT_PROTECTED_ROLES = ['owner', 'admin', 'auditor'];

@Injectable()
export class GenericEmployeeSyncService {
  private readonly logger = new Logger(GenericEmployeeSyncService.name);

  /**
   * Process a standardized employee list into DB operations.
   *
   * Phase 1: Import active employees confirmed in the tenant IdP (create Member if needed)
   * Phase 2: Deactivate members no longer present in the provider
   */
  async processEmployees({
    organizationId,
    employees,
    options = {},
  }: {
    organizationId: string;
    employees: SyncEmployee[];
    options?: ProcessEmployeesOptions;
  }): Promise<SyncResult> {
    const defaultRole = options.defaultRole ?? 'employee';
    const allowReactivation = options.allowReactivation ?? false;
    const protectedRoles = options.protectedRoles ?? DEFAULT_PROTECTED_ROLES;
    const providerName = options.providerName ?? 'provider';
    const isDirectorySource = options.isDirectorySource ?? false;

    const validRoleNames = await getValidRoleNames(organizationId);

    const sanitizeRole = (raw: string | undefined | null): string => {
      if (!raw) return defaultRole;
      const tokens = raw
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && validRoleNames.has(t));
      return tokens.length > 0 ? tokens.join(',') : defaultRole;
    };

    const results: SyncResult = {
      success: true,
      totalFound: employees.length,
      imported: 0,
      skipped: 0,
      deactivated: 0,
      reactivated: 0,
      errors: 0,
      details: [],
    };

    this.logger.log(
      `[GenericSync] Processing ${employees.length} employees for org="${organizationId}" provider="${providerName}"`,
    );

    const filterMode = options.syncFilter?.mode ?? 'all';
    const excludedTerms = options.syncFilter?.excludedTerms ?? [];
    const includedTerms = options.syncFilter?.includedTerms ?? [];
    const passesImportFilter = (email: string): boolean => {
      if (filterMode === 'exclude') {
        return (
          excludedTerms.length === 0 ||
          !matchesSyncFilterTerms(email, excludedTerms)
        );
      }
      if (filterMode === 'include') {
        return matchesSyncFilterTerms(email, includedTerms);
      }
      return true;
    };

    const activeEmployeesAll = employees.filter((e) => e.status === 'active');
    const activeEmployees = activeEmployeesAll.filter((e) =>
      passesImportFilter(e.email.toLowerCase()),
    );
    const inactiveEmails = new Set(
      employees
        .filter((e) => e.status !== 'active')
        .map((e) => e.email.toLowerCase()),
    );
    const allActiveEmails = new Set(
      activeEmployeesAll.map((e) => e.email.toLowerCase()),
    );
    const filteredActiveEmails = new Set(
      activeEmployees.map((e) => e.email.toLowerCase()),
    );

    const providerDomains = new Set<string>();
    for (const emp of employees) {
      const domain = emp.email.toLowerCase().split('@')[1];
      if (domain) providerDomains.add(domain);
    }

    this.logger.log(
      `[GenericSync] Employee breakdown: active=${activeEmployees.length} inactive/suspended=${inactiveEmails.size} domains=${Array.from(providerDomains).join(',')}`,
    );

    const resolveIdentity = createHrIdentityResolver({ organizationId });

    for (const employee of activeEmployees) {
      const normalizedEmail = employee.email.toLowerCase();
      try {
        const identity = await resolveIdentity({ email: normalizedEmail });
        if (
          shouldSkipHrSync({
            identity,
            email: normalizedEmail,
            organizationId,
            providerName,
            logger: this.logger,
            results,
          }) ||
          !identity
        ) {
          continue;
        }

        const existingUser = await getHrSyncUser({ identity, organizationId });

        const existingMember = await db.member.findFirst({
          where: {
            organizationId,
            userId: existingUser.id,
          },
        });

        if (existingMember) {
          // HR updates employment state; only IdP login/reconciliation may change SSO roles.
          const healedRole =
            existingMember.roleSource === 'sso' ||
            existingMember.idpAccessRevoked
              ? existingMember.role
              : sanitizeRole(existingMember.role);
          const needsHeal = healedRole !== existingMember.role;
          if (needsHeal) {
            this.logger.warn(
              `[GenericSync] Healing limbo role for ${normalizedEmail}: "${existingMember.role}" → "${healedRole}"`,
            );
          }

          const needsOnboardDate =
            !existingMember.onboardDate && employee.startDate;

          if (existingMember.deactivated && allowReactivation) {
            const parsedStartDate = employee.startDate
              ? new Date(employee.startDate)
              : null;
            await db.member.update({
              where: { id: existingMember.id },
              data: {
                deactivated: false,
                isActive: true,
                offboardDate: null,
                ...(needsHeal ? { role: healedRole } : {}),
                ...(needsOnboardDate &&
                parsedStartDate &&
                !isNaN(parsedStartDate.getTime())
                  ? { onboardDate: parsedStartDate }
                  : {}),
              },
            });
            results.reactivated++;
            results.details.push({
              email: normalizedEmail,
              status: 'reactivated',
            });
          } else {
            const parsedStartDate = employee.startDate
              ? new Date(employee.startDate)
              : null;
            const validStartDate =
              parsedStartDate && !isNaN(parsedStartDate.getTime())
                ? parsedStartDate
                : null;
            if (needsHeal || (needsOnboardDate && validStartDate)) {
              await db.member.update({
                where: { id: existingMember.id },
                data: {
                  ...(needsHeal ? { role: healedRole } : {}),
                  ...(needsOnboardDate && validStartDate
                    ? { onboardDate: validStartDate }
                    : {}),
                },
              });
            }
            results.skipped++;
            results.details.push({
              email: normalizedEmail,
              status: 'skipped',
              reason: existingMember.deactivated
                ? 'Member is deactivated'
                : 'Already a member',
            });
          }
          continue;
        }

        const sanitizedRole = sanitizeRole(employee.role);
        if (employee.role && sanitizedRole !== employee.role) {
          this.logger.warn(
            `[GenericSync] Provider "${providerName}" sent unrecognized role "${employee.role}" for ${normalizedEmail}; falling back to "${sanitizedRole}"`,
          );
        }
        const newMemberStartDate = employee.startDate
          ? new Date(employee.startDate)
          : null;
        await db.member.create({
          data: {
            organizationId,
            userId: existingUser.id,
            role: sanitizedRole,
            isActive: true,
            ...(newMemberStartDate && !isNaN(newMemberStartDate.getTime())
              ? { onboardDate: newMemberStartDate }
              : {}),
          },
        });

        results.imported++;
        results.details.push({
          email: normalizedEmail,
          status: 'imported',
        });
      } catch (error) {
        this.logger.error(
          `Error importing employee ${normalizedEmail}: ${error}`,
        );
        results.errors++;
        results.details.push({
          email: normalizedEmail,
          status: 'error',
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log(
      `[GenericSync] Phase 1 complete: imported=${results.imported} skipped=${results.skipped} reactivated=${results.reactivated} errors=${results.errors}`,
    );

    if (!isDirectorySource) {
      this.logger.log(
        `[GenericSync] Phase 2 skipped for "${providerName}": isDirectorySource=false. Members absent from the sync payload were left alone.`,
      );
      results.success = results.errors === 0;
      return results;
    }

    await deactivateAbsentEmployees({
      organizationId,
      providerName,
      providerDomains,
      protectedRoles,
      inactiveEmails,
      presenceActiveEmails:
        filterMode === 'include' ? allActiveEmails : filteredActiveEmails,
      resolveIdentity,
      logger: this.logger,
      results,
    });

    results.success = results.errors === 0;

    this.logger.log(
      `Sync complete for ${providerName}: ${results.imported} imported, ${results.reactivated} reactivated, ${results.deactivated} deactivated, ${results.skipped} skipped, ${results.errors} errors`,
    );

    return results;
  }
}
