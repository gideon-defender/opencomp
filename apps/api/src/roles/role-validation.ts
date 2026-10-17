import { BadRequestException } from '@nestjs/common';
import {
  allRoles,
  statement,
  type RoleObligations,
} from '@gideon-defender/auth';

const BUILT_IN_NAMES = Object.keys(allRoles);
const BUILT_IN_LOWER = new Set(
  BUILT_IN_NAMES.map((name) => name.toLowerCase()),
);

export const ROLE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9 -]*$/;

const KNOWN_OBLIGATIONS = new Set(['compliance']);

/**
 * Normalize a role name: trim only. Matching stays case-sensitive
 * exact (aligns with built-ins: `owner` !== `Owner`). Case-only
 * variants are rejected separately to prevent `Lead` vs `lead` confusion.
 */
export function normalizeRoleName(name: string): string {
  return name.trim();
}

/** Exact built-in hit (`Admin` is not `admin` here — case check is separate). */
export function isBuiltInName(name: string): boolean {
  return BUILT_IN_NAMES.includes(name);
}

/** Case-insensitive built-in hit (`Admin` collides with `admin`). */
export function isBuiltInNameCaseInsensitive(name: string): boolean {
  return BUILT_IN_LOWER.has(name.toLowerCase());
}

/** Validate a role name, return the trimmed form. Throws 400 on violation. */
export function validateRoleName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new BadRequestException('Role name must be a string');
  }
  const trimmed = normalizeRoleName(name);
  if (trimmed.length < 2 || trimmed.length > 50) {
    throw new BadRequestException('Role name must be 2-50 characters');
  }
  if (!ROLE_NAME_PATTERN.test(trimmed)) {
    throw new BadRequestException(
      'Name must start with a letter and contain only letters, numbers, spaces, and hyphens',
    );
  }
  if (isBuiltInName(trimmed) || isBuiltInNameCaseInsensitive(trimmed)) {
    throw new BadRequestException(
      `"${trimmed}" is a built-in role and cannot be used for a custom role`,
    );
  }
  return trimmed;
}

/**
 * Case-only collision against existing org names (`Lead` vs `lead`).
 * DB `@@unique([organizationId, name])` is case-sensitive, so this
 * JS check is the guard. Matching itself stays exact — this only blocks
 * the confusing near-duplicate at write time.
 */
export function hasCaseOnlyCollision(
  candidate: string,
  existingNames: string[],
): boolean {
  const lower = candidate.toLowerCase();
  return existingNames.some(
    (name) => name.toLowerCase() === lower && name !== candidate,
  );
}

type PermissionsMap = Record<string, string[]>;

/** Validate permissions: non-empty, known resources, valid actions. */
export function validateRolePermissions(perms: unknown): PermissionsMap {
  if (!perms || typeof perms !== 'object' || Array.isArray(perms)) {
    throw new BadRequestException('Permissions must be a non-empty object');
  }
  const entries = Object.entries(perms as Record<string, unknown>);
  if (entries.length === 0) {
    throw new BadRequestException('At least one permission must be granted');
  }
  const result: PermissionsMap = {};
  for (const [resource, actions] of entries) {
    // Own-property lookup only: `statement["__proto__"]` resolves through
    // the prototype chain and would bypass the unknown-resource check.
    const allowed = Object.hasOwn(statement, resource)
      ? (statement as Record<string, readonly string[]>)[resource]
      : undefined;
    if (!allowed) {
      throw new BadRequestException(`Unknown resource: "${resource}"`);
    }
    if (!Array.isArray(actions) || actions.length === 0) {
      throw new BadRequestException(
        `Resource "${resource}" must list at least one action`,
      );
    }
    for (const action of actions) {
      if (typeof action !== 'string' || !allowed.includes(action)) {
        throw new BadRequestException(
          `Invalid action "${String(action)}" for resource "${resource}"`,
        );
      }
    }
    result[resource] = [...new Set(actions as string[])];
  }
  const hasAny = Object.values(result).some((list) => list.length > 0);
  if (!hasAny) {
    throw new BadRequestException('At least one permission must be granted');
  }
  return result;
}

/** Validate obligations: only known boolean keys. Defaults to `{}`. */
export function validateRoleObligations(value: unknown): RoleObligations {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Obligations must be an object');
  }
  const result: RoleObligations = {};
  for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
    if (!KNOWN_OBLIGATIONS.has(key)) {
      throw new BadRequestException(`Unknown obligation: "${key}"`);
    }
    if (typeof flag !== 'boolean') {
      throw new BadRequestException(`Obligation "${key}" must be a boolean`);
    }
    if (key === 'compliance') result.compliance = flag;
  }
  return result;
}
