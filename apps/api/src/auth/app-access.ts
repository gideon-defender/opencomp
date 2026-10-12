import { BUILT_IN_ROLE_PERMISSIONS } from '@gideon-defender/auth';
import { db } from '@db';

/** Safely parse a custom role's stored permissions; malformed JSON → `{}` (never throws). */
function parsePermissions(raw: unknown): Record<string, string[]> {
  if (raw && typeof raw === 'object') {
    return raw as Record<string, string[]>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, string[]>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function mergeInto(
  target: Record<string, Set<string>>,
  perms: Record<string, string[]>,
): void {
  for (const [resource, actions] of Object.entries(perms)) {
    if (!Array.isArray(actions)) continue;
    target[resource] ??= new Set<string>();
    for (const action of actions) target[resource].add(action);
  }
}

/**
 * Strip control characters so IdP-controlled values cannot forge server log
 * lines when interpolated. Does not trim — callers trim first when needed.
 */
export function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '');
}

/**
 * Every role name valid in an org: built-ins ∪ its `organization_role` rows.
 *
 * Shared by the OIDC entitlements audit and the employee sync so the two
 * never disagree on which names count as roles. `Set.has` is a value
 * lookup, so a custom role named e.g. `constructor` stays a custom role.
 */
export async function getValidRoleNames(
  organizationId: string,
): Promise<Set<string>> {
  const customRoles = await db.organizationRole.findMany({
    where: { organizationId },
    select: { name: true },
  });
  return new Set([
    ...Object.keys(BUILT_IN_ROLE_PERMISSIONS),
    ...customRoles.map((r) => r.name),
  ]);
}

/**
 * Split a comma-separated `Member.role` string into trimmed names.
 *
 * `null`/`undefined` (no membership row) stays `null` so callers can tell
 * "no membership" apart from "membership with an empty role string".
 */
export function splitRoleString(
  role: string | null | undefined,
): string[] | null {
  if (role === null || role === undefined) return null;
  return role
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Merge the effective permissions (`{ resource: actions[] }`) for a set of role
 * names in an org. Built-in roles resolve from `BUILT_IN_ROLE_PERMISSIONS`
 * (own-property lookup only, so a custom role named e.g. `constructor` is not
 * mistaken for a built-in); custom roles resolve from `organization_role` rows
 * (malformed JSON is ignored, not thrown). Comma-separated roles are a union.
 */
export async function resolveRolePermissions(
  organizationId: string,
  roles: string[],
): Promise<Record<string, string[]>> {
  const merged: Record<string, Set<string>> = {};
  const customRoleNames: string[] = [];

  for (const role of roles) {
    if (Object.prototype.hasOwnProperty.call(BUILT_IN_ROLE_PERMISSIONS, role)) {
      mergeInto(merged, BUILT_IN_ROLE_PERMISSIONS[role]);
    } else if (role) {
      customRoleNames.push(role);
    }
  }

  if (customRoleNames.length > 0) {
    const customRoles = await db.organizationRole.findMany({
      where: { organizationId, name: { in: customRoleNames } },
      select: { permissions: true },
    });
    for (const customRole of customRoles) {
      mergeInto(merged, parsePermissions(customRole.permissions));
    }
  }

  const result: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(merged)) {
    result[resource] = [...actions];
  }
  return result;
}

/** Whether resolved permissions grant `resource:action`. */
export function permissionsGrant(
  permissions: Record<string, string[]>,
  resource: string,
  action: string,
): boolean {
  return permissions[resource]?.includes(action) ?? false;
}

/**
 * Milestone 3 — native RBAC check without better-auth.
 *
 * Checks `required` (`{ resource: actions[] }`) against the union of the
 * given role names in the org (built-in + custom `organization_role` rows).
 * Replaces `auth.api.hasPermission` wherever `HybridAuthGuard` already
 * resolved `request.userRoles` from the `Member` row — the same data source
 * better-auth's organization plugin reads, so decisions are identical.
 */
export async function rolesGrantPermissions({
  organizationId,
  roles,
  required,
}: {
  organizationId: string;
  roles: string[];
  required: Record<string, string[]>;
}): Promise<boolean> {
  const perms = await resolveRolePermissions(organizationId, roles);
  return Object.entries(required).every(([resource, actions]) =>
    actions.every((action) => permissionsGrant(perms, resource, action)),
  );
}

/**
 * Whether a member's role(s) grant **app access** (`app:read`) in the given org
 * — the same gate the web app uses (owner/admin/auditor + custom roles with the
 * "App Access" toggle), excluding Portal-only roles (employee/contractor).
 */
export async function hasAppAccess(
  organizationId: string,
  roleString: string | null,
): Promise<boolean> {
  if (!roleString) return false;
  const roles = roleString
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (roles.length === 0) return false;

  const perms = await resolveRolePermissions(organizationId, roles);
  return permissionsGrant(perms, 'app', 'read');
}
