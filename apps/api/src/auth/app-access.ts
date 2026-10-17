import { BUILT_IN_ROLE_PERMISSIONS } from '@gideon-defender/auth';
import { db, type Prisma } from '@db';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isUnsafeKey(key: string): boolean {
  return UNSAFE_KEYS.has(key);
}

/** Safely parse a custom role's stored permissions; malformed JSON → `{}` (never throws). */
export function parsePermissions(raw: unknown): Record<string, string[]> {
  const clean = (value: unknown): Record<string, string[]> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, string[]> = {};
    for (const [key, actions] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (isUnsafeKey(key)) continue;
      if (!Array.isArray(actions)) continue;
      out[key] = (actions as unknown[]).filter(
        (action): action is string => typeof action === 'string',
      );
    }
    return out;
  };
  if (raw && typeof raw === 'object') {
    return clean(raw);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return clean(parsed);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Union `perms` into the Set-based `target` merge. Shared with the roles
 * module so read paths merge built-in and custom permissions identically.
 * Skips prototype keys so a poisoned stored row cannot crash readers.
 */
export function mergeInto(
  target: Record<string, Set<string>>,
  perms: Record<string, string[]>,
): void {
  for (const [resource, actions] of Object.entries(perms)) {
    if (isUnsafeKey(resource)) continue;
    if (!Array.isArray(actions)) continue;
    // Own-property guard: plain `{}` inherits `toString`/`valueOf` etc.
    // `??=` would keep the inherited function and `.add` would throw.
    if (!Object.hasOwn(target, resource)) {
      target[resource] = new Set<string>();
    }
    for (const action of actions) {
      if (typeof action !== 'string') continue;
      target[resource].add(action);
    }
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
  client: Pick<Prisma.TransactionClient, 'organizationRole'> = db,
): Promise<Set<string>> {
  const customRoles = await client.organizationRole.findMany({
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
 * The non-null trim+filter behavior is shared with `splitRoleNames` in
 * roles/role-holders, which delegates to this function (`?? []`).
 */
export function splitRoleString(
  role: string | null | undefined,
): string[] | null {
  if (role === null || role === undefined) return null;
  return role
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
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
  client: Pick<Prisma.TransactionClient, 'organizationRole'> = db,
): Promise<Record<string, string[]>> {
  const merged: Record<string, Set<string>> = {};
  const customRoleNames: string[] = [];

  for (const rawRole of roles) {
    const role = typeof rawRole === 'string' ? rawRole.trim() : rawRole;
    if (!role) continue;
    if (Object.prototype.hasOwnProperty.call(BUILT_IN_ROLE_PERMISSIONS, role)) {
      mergeInto(merged, BUILT_IN_ROLE_PERMISSIONS[role]);
    } else {
      customRoleNames.push(role);
    }
  }

  if (customRoleNames.length > 0) {
    const customRoles = await client.organizationRole.findMany({
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
  const roles = splitRoleString(roleString);
  if (!roles || roles.length === 0) return false;

  const perms = await resolveRolePermissions(organizationId, roles);
  return permissionsGrant(perms, 'app', 'read');
}
