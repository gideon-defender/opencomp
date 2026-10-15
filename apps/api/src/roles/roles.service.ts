import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import {
  allRoles,
  BUILT_IN_ROLE_PERMISSIONS,
  BUILT_IN_ROLE_OBLIGATIONS,
  type RoleObligations,
} from '@gideon-defender/auth';

// Built-in roles that cannot be modified or deleted
const BUILT_IN_ROLES = Object.keys(allRoles);

function parseObligationsField(value: unknown): RoleObligations {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as RoleObligations;
    } catch {
      return {};
    }
  }
  return (value as RoleObligations) || {};
}

/**
 * Resolve the effective obligations for a single role, given an optional DB
 * override row. Centralized so every read path applies the same fallback
 * rule: a DB row only wins when it explicitly sets `compliance`, otherwise
 * we fall back to the hardcoded built-in default. Prevents the UI and the
 * enforcement layer from diverging when a row exists with `{}` obligations.
 */
function resolveEffectiveObligations(
  roleName: string,
  override: RoleObligations | null,
): RoleObligations {
  if (override && 'compliance' in override) return override;
  if (BUILT_IN_ROLES.includes(roleName)) {
    return BUILT_IN_ROLE_OBLIGATIONS[roleName] ?? {};
  }
  return override ?? {};
}

@Injectable()
export class RolesService {
  /**
   * Get combined permissions from multiple roles
   * Merges permissions from all roles (union of all permissions)
   */
  /**
   * Resolve combined permissions for a set of role names (built-in + custom).
   */
  async resolvePermissions(
    organizationId: string,
    roleNames: string[],
  ): Promise<Record<string, string[]>> {
    return this.getCombinedPermissions(roleNames, organizationId);
  }

  private async getCombinedPermissions(
    roleNames: string[],
    organizationId: string,
  ): Promise<Record<string, string[]>> {
    const combined: Record<string, string[]> = {};

    for (const roleName of roleNames) {
      const rolePermissions = await this.getEffectivePermissions(
        roleName,
        organizationId,
      );

      for (const [resource, actions] of Object.entries(rolePermissions)) {
        if (!combined[resource]) {
          combined[resource] = [];
        }
        // Add unique actions
        for (const action of actions) {
          if (!combined[resource].includes(action)) {
            combined[resource].push(action);
          }
        }
      }
    }

    return combined;
  }

  /**
   * Get effective permissions for a role
   */
  private async getEffectivePermissions(
    roleName: string,
    organizationId: string,
  ): Promise<Record<string, string[]>> {
    // Check if it's a built-in role
    if (BUILT_IN_ROLES.includes(roleName)) {
      return BUILT_IN_ROLE_PERMISSIONS[roleName] || {};
    }

    // For custom roles, look up in database
    const customRole = await db.organizationRole.findFirst({
      where: {
        organizationId,
        name: roleName,
      },
    });

    if (customRole) {
      const perms =
        typeof customRole.permissions === 'string'
          ? JSON.parse(customRole.permissions)
          : customRole.permissions;
      return perms as Record<string, string[]>;
    }

    return {};
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
    const customRoles = allRows.filter((r) => {
      if (BUILT_IN_ROLES.includes(r.name)) {
        overrideByName.set(r.name, r);
        return false;
      }
      return true;
    });

    // Get member counts for custom roles
    const memberCounts = await Promise.all(
      customRoles.map(async (role) => {
        const count = await db.member.count({
          where: { organizationId, role: { contains: role.name } },
        });
        return { roleId: role.id, count };
      }),
    );
    const countMap = new Map(memberCounts.map((mc) => [mc.roleId, mc.count]));

    // Include built-in roles info (with effective obligations: override or default)
    const builtInRoles = BUILT_IN_ROLES.map((name) => {
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
      customRoles: customRoles.map((r) => ({
        id: r.id,
        name: r.name,
        permissions:
          typeof r.permissions === 'string'
            ? JSON.parse(r.permissions)
            : r.permissions,
        obligations:
          typeof r.obligations === 'string'
            ? JSON.parse(r.obligations)
            : r.obligations || {},
        isBuiltIn: false,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        _count: { members: countMap.get(r.id) ?? 0 },
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

    const memberCount = await db.member.count({
      where: { organizationId, role: { contains: role.name } },
    });

    return {
      id: role.id,
      name: role.name,
      permissions:
        typeof role.permissions === 'string'
          ? JSON.parse(role.permissions)
          : role.permissions,
      obligations:
        typeof role.obligations === 'string'
          ? JSON.parse(role.obligations)
          : role.obligations || {},
      isBuiltIn: false,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
      _count: { members: memberCount },
    };
  }

  /**
   * Get merged permissions for a list of custom role names.
   * Used by the frontend to resolve effective permissions for custom roles.
   */
  async getPermissionsForRoles(
    organizationId: string,
    roleNames: string[],
  ): Promise<Record<string, string[]>> {
    if (roleNames.length === 0) return {};

    const customRoles = await db.organizationRole.findMany({
      where: {
        organizationId,
        name: { in: roleNames },
      },
    });

    const combined: Record<string, string[]> = {};
    for (const role of customRoles) {
      const perms =
        typeof role.permissions === 'string'
          ? JSON.parse(role.permissions)
          : role.permissions;
      for (const [resource, actions] of Object.entries(
        perms as Record<string, string[]>,
      )) {
        if (!combined[resource]) {
          combined[resource] = [];
        }
        for (const action of actions) {
          if (!combined[resource].includes(action)) {
            combined[resource].push(action);
          }
        }
      }
    }

    return combined;
  }

  /**
   * Filter a list of members down to those whose combined role permissions
   * grant the given `resource:action`. Built-in role definitions come from
   * `BUILT_IN_ROLE_PERMISSIONS`; custom roles are fetched in a single batched
   * `organizationRole.findMany` keyed by the distinct role names present in
   * the input.
   *
   * Matches better-auth's `hasPermissionFn` semantics: comma-separated roles
   * in `member.role` are treated as a union (ANY role granting the permission
   * is sufficient). Unknown role names are skipped silently.
   */
  async filterMembersWithPermission<M extends { role: string | null }>(
    organizationId: string,
    members: M[],
    resource: string,
    action: string,
  ): Promise<M[]> {
    if (members.length === 0) return [];

    const distinctRoles = new Set<string>();
    for (const m of members) {
      if (!m.role) continue;
      for (const r of m.role
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)) {
        distinctRoles.add(r);
      }
    }
    if (distinctRoles.size === 0) return [];

    const customRoleNames = [...distinctRoles].filter(
      (r) => !BUILT_IN_ROLES.includes(r),
    );

    const customRoles =
      customRoleNames.length > 0
        ? await db.organizationRole.findMany({
            where: { organizationId, name: { in: customRoleNames } },
            select: { name: true, permissions: true },
          })
        : [];

    const permsByRole = new Map<string, Record<string, string[]>>();
    for (const name of distinctRoles) {
      if (BUILT_IN_ROLES.includes(name)) {
        permsByRole.set(name, BUILT_IN_ROLE_PERMISSIONS[name] ?? {});
      } else {
        const custom = customRoles.find((c) => c.name === name);
        if (!custom) continue;
        const perms =
          typeof custom.permissions === 'string'
            ? (JSON.parse(custom.permissions) as Record<string, string[]>)
            : (custom.permissions as Record<string, string[]>);
        permsByRole.set(name, perms);
      }
    }

    return members.filter((m) => {
      if (!m.role) return false;
      const roles = m.role
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      return roles.some((r) =>
        permsByRole.get(r)?.[resource]?.includes(action),
      );
    });
  }

  /**
   * Get merged obligations for a list of role names (custom + built-in).
   *
   * Built-in roles default to `BUILT_IN_ROLE_OBLIGATIONS[name]`, but an
   * organization can override by storing an `organization_role` row with the
   * built-in name — the DB row wins when present.
   */
  async getObligationsForRoles(
    organizationId: string,
    roleNames: string[],
  ): Promise<RoleObligations> {
    if (roleNames.length === 0) return {};

    const dbRoles = await db.organizationRole.findMany({
      where: { organizationId, name: { in: roleNames } },
      select: { name: true, obligations: true },
    });
    const overrideByName = new Map<string, RoleObligations>();
    for (const role of dbRoles) {
      overrideByName.set(role.name, parseObligationsField(role.obligations));
    }

    const combined: RoleObligations = {};
    for (const name of roleNames) {
      const fromDb = overrideByName.get(name) ?? null;
      const effective = resolveEffectiveObligations(name, fromDb);
      if (effective.compliance) combined.compliance = true;
    }

    return combined;
  }

  /**
   * Read the obligations for a single built-in role for this organization —
   * DB override if present, else the hardcoded default.
   */
  async getBuiltInObligations(
    organizationId: string,
    roleName: string,
  ): Promise<RoleObligations> {
    if (!BUILT_IN_ROLES.includes(roleName)) {
      throw new BadRequestException(`Not a built-in role: ${roleName}`);
    }

    const override = await db.organizationRole.findFirst({
      where: { organizationId, name: roleName },
      select: { obligations: true },
    });
    const parsed = override
      ? parseObligationsField(override.obligations)
      : null;
    return resolveEffectiveObligations(roleName, parsed);
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
