import { BadRequestException, Injectable } from '@nestjs/common';
import { db } from '@db';
import {
  BUILT_IN_ROLE_PERMISSIONS,
  type RoleObligations,
} from '@gideon-defender/auth';
import { parsePermissions, resolveRolePermissions } from '../auth/app-access';
import { BUILT_IN_ROLE_NAMES, splitRoleNames } from './role-holders';
import {
  parseObligationsField,
  resolveEffectiveObligations,
} from './role-obligations';

@Injectable()
export class RolesResolutionService {
  /**
   * Get merged permissions for a list of role names (built-in + custom).
   * Used by the frontend to resolve effective permissions for users.
   * Single source: delegates to `resolveRolePermissions` so resolution and
   * enforcement never drift.
   */
  async getPermissionsForRoles(
    organizationId: string,
    roleNames: string[],
  ): Promise<Record<string, string[]>> {
    return resolveRolePermissions(organizationId, roleNames);
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
    for (const member of members) {
      for (const entry of splitRoleNames(member.role)) {
        distinctRoles.add(entry);
      }
    }
    if (distinctRoles.size === 0) return [];

    const customRoleNames = [...distinctRoles].filter(
      (name) => !BUILT_IN_ROLE_NAMES.includes(name),
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
      if (BUILT_IN_ROLE_NAMES.includes(name)) {
        permsByRole.set(name, BUILT_IN_ROLE_PERMISSIONS[name] ?? {});
      } else {
        const custom = customRoles.find((entry) => entry.name === name);
        if (!custom) continue;
        permsByRole.set(name, parsePermissions(custom.permissions));
      }
    }

    return members.filter((member) => {
      const roles = splitRoleNames(member.role);
      if (roles.length === 0) return false;
      return roles.some((name) =>
        permsByRole.get(name)?.[resource]?.includes(action),
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
    if (!BUILT_IN_ROLE_NAMES.includes(roleName)) {
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
}
