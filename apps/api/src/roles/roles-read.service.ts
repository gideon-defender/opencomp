import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '@db';
import { parsePermissions, resolveRolePermissions } from '../auth/app-access';
import {
  BUILT_IN_ROLE_NAMES,
  countHoldersExact,
  countHoldersForRoles,
} from './role-holders';
import {
  parseObligationsField,
  resolveEffectiveObligations,
} from './role-obligations';

@Injectable()
export class RolesReadService {
  /**
   * Resolve combined permissions for a set of role names (built-in + custom).
   * Single source: delegates to `resolveRolePermissions` so read paths and
   * enforcement never drift.
   */
  async resolvePermissions(
    organizationId: string,
    roleNames: string[],
  ): Promise<Record<string, string[]>> {
    return resolveRolePermissions(organizationId, roleNames);
  }

  /**
   * List all roles for an organization (built-in + custom)
   */
  async listRoles(organizationId: string) {
    // Get all organization_role rows; rows named after a built-in role are
    // obligation overrides, not custom roles.
    const allRows = await db.organizationRole.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    const overrideByName = new Map<string, (typeof allRows)[number]>();
    const customRoles = allRows.filter((role) => {
      if (BUILT_IN_ROLE_NAMES.includes(role.name)) {
        overrideByName.set(role.name, role);
        return false;
      }
      return true;
    });

    // Exact holder counts with one member query (no substring matching).
    const countMap = await countHoldersForRoles(
      organizationId,
      customRoles.map((role) => role.name),
    );

    // Include built-in roles info (with effective obligations: override or default)
    const builtInRoles = BUILT_IN_ROLE_NAMES.map((name) => {
      const override = overrideByName.get(name);
      const parsed = override
        ? parseObligationsField(override.obligations)
        : null;
      return {
        name,
        isBuiltIn: true,
        description: this.getBuiltInRoleDescription(name),
        obligations: resolveEffectiveObligations(name, parsed),
      };
    });

    return {
      builtInRoles,
      customRoles: customRoles.map((role) => ({
        id: role.id,
        name: role.name,
        permissions: parsePermissions(role.permissions),
        obligations: parseObligationsField(role.obligations),
        isBuiltIn: false,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
        _count: { members: countMap.get(role.name) ?? 0 },
      })),
    };
  }

  /**
   * Get a single role by ID
   */
  async getRole(organizationId: string, roleId: string) {
    const role = await db.organizationRole.findFirst({
      where: {
        id: roleId,
        organizationId,
      },
    });

    if (!role) {
      throw new NotFoundException(`Role not found: ${roleId}`);
    }
    // Built-in-named rows are obligation overrides, not custom roles.
    // Hide them here so Get matches List (which filters them out).
    if (BUILT_IN_ROLE_NAMES.includes(role.name)) {
      throw new NotFoundException(`Role not found: ${roleId}`);
    }

    const memberCount = await countHoldersExact(organizationId, role.name);

    return {
      id: role.id,
      name: role.name,
      permissions: parsePermissions(role.permissions),
      obligations: parseObligationsField(role.obligations),
      isBuiltIn: false,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
      _count: { members: memberCount },
    };
  }

  /**
   * Get description for built-in roles
   */
  private getBuiltInRoleDescription(name: string): string {
    const descriptions: Record<string, string> = {
      owner: 'Full access to everything including organization deletion',
      admin: 'Full access except organization deletion',
      auditor:
        'Read-only access with export capabilities for compliance audits',
      employee:
        'Limited access to assigned tasks and basic compliance activities',
      contractor: 'Limited access similar to employee for external contractors',
    };
    return descriptions[name] || '';
  }
}
